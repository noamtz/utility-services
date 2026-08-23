/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- overloaded Dynamo client test doubles */
import { describe, expect, it, vi } from "vitest";

import { createPendingFile, parseFileItem, type FileItem } from "./model.js";
import {
  CorruptFileRecordError,
  createDynamoFileRepository,
  FileCollisionError,
  FileStateConflictError,
  StorageQuotaExceededError,
} from "./repository.js";

const project = "11111111-1111-4111-8111-111111111111";
const publicProject = "prj_0123456789abcdefghijkl";
const timestamp = "2026-08-23T08:00:00.000Z";
const FILE_LIFECYCLE_INDEX_NAME = "FileLifecycle";
const PUBLIC_FILE_INDEX_NAME = "PublicFiles";
const publicFileId = "pfil_0123456789abcdefghijkl";
const MAX_RETAINED_STORAGE_BYTES = 5n * 2n ** 30n;

function pending(fileId = "fil_0123456789abcdefghijkl"): FileItem {
  return createPendingFile({
    internalProjectId: project,
    publicProjectId: publicProject,
    fileId,
    name: "file.txt",
    mediaType: "text/plain",
    sizeBytes: 12n,
    visibility: "private",
    uploadExpiresAt: "2026-08-23T08:15:00.000Z",
    failureEligibleAt: "2026-08-23T09:15:00.000Z",
    createdAt: timestamp,
  });
}

function publicPending(): FileItem {
  return createPendingFile({
    internalProjectId: project,
    publicProjectId: publicProject,
    fileId: "fil_0123456789abcdefghijkl",
    publicFileId,
    name: "file.txt",
    mediaType: "text/plain",
    sizeBytes: 12n,
    visibility: "public",
    uploadExpiresAt: "2026-08-23T08:15:00.000Z",
    failureEligibleAt: "2026-08-23T09:15:00.000Z",
    createdAt: timestamp,
  });
}

function fixture() {
  const send = vi.fn();
  return {
    send,
    repository: createDynamoFileRepository({
      client: { send } as never,
      tableName: "FileTable",
      publicIndexName: PUBLIC_FILE_INDEX_NAME,
      lifecycleIndexName: FILE_LIFECYCLE_INDEX_NAME,
    }),
  };
}

function serializeBigInt(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

describe("Dynamo file repository", () => {
  it("reserves pending metadata and quota in one bounded transaction", async () => {
    const { send, repository } = fixture();
    send.mockResolvedValue({});
    const file = pending();
    await repository.reservePending(file, MAX_RETAINED_STORAGE_BYTES);
    const command = send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    const transaction = command.input["TransactItems"] as Array<Record<string, unknown>>;
    expect(transaction).toHaveLength(2);
    expect(transaction[0]).toHaveProperty("Update");
    expect(transaction[1]).toHaveProperty("Put");
    expect(JSON.stringify(command.input, serializeBigInt)).not.toContain("Scan");
  });

  it("classifies quota and identifier conditional failures independently", async () => {
    const quota = fixture();
    quota.send.mockRejectedValue(
      Object.assign(new Error("cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
      }),
    );
    await expect(
      quota.repository.reservePending(pending(), MAX_RETAINED_STORAGE_BYTES),
    ).rejects.toBeInstanceOf(StorageQuotaExceededError);
    const collision = fixture();
    collision.send.mockRejectedValue(
      Object.assign(new Error("cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
      }),
    );
    await expect(
      collision.repository.reservePending(pending(), MAX_RETAINED_STORAGE_BYTES),
    ).rejects.toBeInstanceOf(FileCollisionError);
  });

  it("queries only the trusted project partition and rejects cross-project records", async () => {
    const { send, repository } = fixture();
    send.mockResolvedValue({ Items: [pending()] });
    expect((await repository.list({ internalProjectId: project, limit: 20 })).items).toHaveLength(
      1,
    );
    const input = (send.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
    expect(input["KeyConditionExpression"]).toContain("pk = :project");
    expect(input).not.toHaveProperty("IndexName");

    const other = fixture();
    other.send.mockResolvedValue({
      Item: createPendingFile({
        internalProjectId: "22222222-2222-4222-8222-222222222222",
        publicProjectId: publicProject,
        fileId: pending().fileId,
        name: "file.txt",
        mediaType: "text/plain",
        sizeBytes: 12n,
        visibility: "private",
        uploadExpiresAt: "2026-08-23T08:15:00.000Z",
        failureEligibleAt: "2026-08-23T09:15:00.000Z",
        createdAt: timestamp,
      }),
    });
    await expect(other.repository.get(project, pending().fileId)).rejects.toBeInstanceOf(
      CorruptFileRecordError,
    );
  });

  it("queries the exact public project/file pair through the sparse index", async () => {
    const { send, repository } = fixture();
    send.mockResolvedValue({ Items: [publicPending()] });

    await expect(repository.getPublic(publicProject, publicFileId)).resolves.toEqual(
      publicPending(),
    );
    const command = send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.constructor.name).toBe("QueryCommand");
    expect(command.input).toEqual({
      TableName: "FileTable",
      IndexName: PUBLIC_FILE_INDEX_NAME,
      KeyConditionExpression: "gsi1pk = :project AND gsi1sk = :file",
      ExpressionAttributeValues: {
        ":project": `PUBLIC_PROJECT#${publicProject}`,
        ":file": `PUBLIC_FILE#${publicFileId}`,
      },
      Limit: 2,
    });
    expect(command.input).not.toHaveProperty("ConsistentRead");
    expect(JSON.stringify(command.input)).not.toContain("Scan");
  });

  it("returns missing public pairs and rejects duplicate public index records", async () => {
    const missing = fixture();
    missing.send.mockResolvedValue({ Items: [] });
    await expect(
      missing.repository.getPublic(publicProject, publicFileId),
    ).resolves.toBeUndefined();

    const duplicate = fixture();
    duplicate.send.mockResolvedValue({ Items: [publicPending(), publicPending()] });
    await expect(
      duplicate.repository.getPublic(publicProject, publicFileId),
    ).rejects.toBeInstanceOf(CorruptFileRecordError);

    const malformedItems = fixture();
    malformedItems.send.mockResolvedValue({ Items: { unexpected: true } });
    await expect(
      malformedItems.repository.getPublic(publicProject, publicFileId),
    ).rejects.toBeInstanceOf(CorruptFileRecordError);
  });

  it.each([
    ["malformed", { ...publicPending(), objectKey: "caller/key" }],
    ["private", pending()],
    ["wrong project", { ...publicPending(), publicProjectId: "prj_abcdefghijkl0123456789" }],
    ["wrong file", { ...publicPending(), publicFileId: "pfil_abcdefghijkl0123456789" }],
    ["wrong partition key", { ...publicPending(), gsi1pk: "PUBLIC_PROJECT#prj_wrong" }],
    ["wrong sort key", { ...publicPending(), gsi1sk: "PUBLIC_FILE#pfil_wrong" }],
  ])("rejects a %s public index record", async (_name, item) => {
    const { send, repository } = fixture();
    send.mockResolvedValue({ Items: [item] });
    await expect(repository.getPublic(publicProject, publicFileId)).rejects.toBeInstanceOf(
      CorruptFileRecordError,
    );
  });

  it("claims stable completion evidence and queries the lifecycle index without a scan", async () => {
    const { send, repository } = fixture();
    const file = pending();
    const evidence = {
      completedAt: timestamp,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    };
    send.mockResolvedValueOnce({
      Attributes: { ...file, completionEvidence: evidence, revision: 1n },
    });
    expect(
      (await repository.claimCompletion(file, evidence, timestamp)).completionEvidence,
    ).toEqual(evidence);
    send.mockResolvedValueOnce({ Items: [file], LastEvaluatedKey: { pk: file.pk, sk: file.sk } });
    const due = await repository.listDuePending("2026-08-23T10:00:00.000Z", 20);
    expect(due.items).toHaveLength(1);
    const command = send.mock.calls[1]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({ IndexName: FILE_LIFECYCLE_INDEX_NAME });
    expect(command.constructor.name).toBe("QueryCommand");
  });

  it("finalizes ready only after evidence and performs the quota movement atomically", async () => {
    const { send, repository } = fixture();
    const evidence = {
      completedAt: timestamp,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    };
    const claimed = { ...pending(), completionEvidence: evidence, revision: 1n };
    const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...withoutPendingIndex } = claimed;
    void _pendingPk;
    void _pendingSk;
    const ready = {
      ...withoutPendingIndex,
      status: "ready",
      readyAt: timestamp,
      updatedAt: timestamp,
      revision: 2n,
    };
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: ready });
    expect((await repository.finalizeReady(claimed, timestamp)).status).toBe("ready");
    const transaction = (send.mock.calls[0]?.[0] as { input: { TransactItems: unknown[] } }).input
      .TransactItems;
    expect(transaction).toHaveLength(2);
    expect(JSON.stringify(transaction, serializeBigInt)).toMatch(/reservedBytes.*retainedBytes/u);
  });

  it("handles empty and paginated project queries without trusting Dynamo keys", async () => {
    const empty = fixture();
    empty.send.mockResolvedValueOnce({});
    await expect(empty.repository.get(project, pending().fileId)).resolves.toBeUndefined();

    const paged = fixture();
    paged.send.mockResolvedValueOnce({
      Items: [pending()],
      LastEvaluatedKey: { pk: pending().pk, sk: pending().sk },
    });
    await expect(
      paged.repository.list({ internalProjectId: project, limit: 1 }),
    ).resolves.toMatchObject({ nextFileId: pending().fileId });

    const corrupt = fixture();
    corrupt.send.mockResolvedValueOnce({ LastEvaluatedKey: { pk: "unexpected" } });
    await expect(
      corrupt.repository.list({ internalProjectId: project, limit: 1 }),
    ).rejects.toBeInstanceOf(CorruptFileRecordError);
  });

  it("resumes completion claims and rejects conflicting evidence", async () => {
    const evidence = {
      completedAt: timestamp,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    };
    const source = { ...pending(), completionEvidence: evidence, revision: 1n };
    const duplicate = fixture();
    duplicate.send.mockRejectedValueOnce(
      Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }),
    );
    duplicate.send.mockResolvedValueOnce({ Item: source });
    await expect(
      duplicate.repository.claimCompletion(pending(), evidence, timestamp),
    ).resolves.toEqual(source);

    const conflict = fixture();
    conflict.send.mockRejectedValueOnce(
      Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }),
    );
    conflict.send.mockResolvedValueOnce({ Item: source });
    await expect(
      conflict.repository.claimCompletion(pending(), { ...evidence, eTag: "changed" }, timestamp),
    ).rejects.toBeInstanceOf(FileStateConflictError);
  });

  it("persists failure cleanup before atomically releasing reserved quota", async () => {
    const source = pending();
    const claimed = {
      ...source,
      failureCode: "object-mismatch",
      cleanupRequired: true,
      revision: 1n,
    };
    const cleaned = { ...claimed, cleanupRequired: false, revision: 2n };
    const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...terminal } = cleaned;
    void _pendingPk;
    void _pendingSk;
    const failed = {
      ...terminal,
      status: "failed",
      failedAt: timestamp,
      updatedAt: timestamp,
      revision: 3n,
    };
    const { send, repository } = fixture();
    send
      .mockResolvedValueOnce({ Attributes: claimed })
      .mockResolvedValueOnce({ Attributes: cleaned })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: failed });
    const failureClaim = await repository.claimFailure(source, "object-mismatch", true, timestamp);
    const cleanupComplete = await repository.completeFailureCleanup(failureClaim, timestamp);
    await expect(repository.finalizeFailed(cleanupComplete, timestamp)).resolves.toMatchObject({
      status: "failed",
      failureCode: "object-mismatch",
    });
    const transaction = (send.mock.calls[2]?.[0] as { input: { TransactItems: unknown[] } }).input
      .TransactItems;
    expect(JSON.stringify(transaction, serializeBigInt)).toMatch(/accountedBytes.*reservedBytes/u);
  });

  it("treats terminal failure/ready replays as idempotent and invalid transitions as conflicts", async () => {
    const evidence = {
      completedAt: timestamp,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    };
    const source = pending();
    const { gsi2pk: _readyPk, gsi2sk: _readySk, ...readyBase } = source;
    void _readyPk;
    void _readySk;
    const ready = parseFileItem({
      ...readyBase,
      status: "ready",
      completionEvidence: evidence,
      readyAt: timestamp,
    });
    const replay = fixture();
    await expect(replay.repository.finalizeReady(ready, timestamp)).resolves.toEqual(ready);

    const { gsi2pk: _failedPk, gsi2sk: _failedSk, ...failedBase } = source;
    void _failedPk;
    void _failedSk;
    const failed = parseFileItem({
      ...failedBase,
      status: "failed",
      failureCode: "upload-expired",
      cleanupRequired: false,
      failedAt: timestamp,
    });
    await expect(replay.repository.finalizeFailed(failed, timestamp)).resolves.toEqual(failed);
    await expect(replay.repository.finalizeReady(source, timestamp)).rejects.toBeInstanceOf(
      FileStateConflictError,
    );
    await expect(replay.repository.finalizeFailed(source, timestamp)).rejects.toBeInstanceOf(
      FileStateConflictError,
    );
    await expect(
      replay.repository.completeFailureCleanup(source, timestamp),
    ).rejects.toBeInstanceOf(FileStateConflictError);
  });

  it("preserves non-conditional Dynamo failures and bounds due-page cursors", async () => {
    const infrastructure = fixture();
    const failure = new Error("network unavailable");
    infrastructure.send.mockRejectedValueOnce(failure);
    await expect(
      infrastructure.repository.reservePending(pending(), MAX_RETAINED_STORAGE_BYTES),
    ).rejects.toBe(failure);

    const due = fixture();
    due.send.mockResolvedValueOnce({ Items: [] });
    await due.repository.listDuePending("2026-08-23T10:00:00.000Z", 10, {
      pk: pending().pk,
      sk: pending().sk,
    });
    expect(
      (due.send.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input,
    ).toHaveProperty("ExclusiveStartKey");
  });
});
