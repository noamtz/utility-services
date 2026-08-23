/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- overloaded Dynamo client test doubles */
import { describe, expect, it, vi } from "vitest";

import {
  createPendingFile,
  parseFileItem,
  trashPurgeSortKey,
  TRASH_PURGE_INDEX_PARTITION,
  TRASH_RETENTION_MILLISECONDS,
  type FileItem,
} from "./model.js";
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

function ready(): FileItem {
  const source = pending();
  const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...base } = source;
  void _pendingPk;
  void _pendingSk;
  return parseFileItem({
    ...base,
    status: "ready",
    completionEvidence: {
      completedAt: timestamp,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    },
    readyAt: timestamp,
  });
}

function publicReady(): FileItem {
  const source = publicPending();
  const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...base } = source;
  void _pendingPk;
  void _pendingSk;
  return parseFileItem({
    ...base,
    status: "ready",
    completionEvidence: {
      completedAt: timestamp,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    },
    readyAt: timestamp,
  });
}

function publicTrashed(): FileItem {
  const source = publicReady();
  const trashedAt = "2026-08-23T10:00:00.000Z";
  const purgeAt = new Date(
    new Date(trashedAt).getTime() + TRASH_RETENTION_MILLISECONDS,
  ).toISOString();
  return parseFileItem({
    ...source,
    status: "trashed",
    trashedAt,
    purgeAt,
    gsi2pk: TRASH_PURGE_INDEX_PARTITION,
    gsi2sk: trashPurgeSortKey(purgeAt, project, source.fileId),
  });
}

function trashed(claimed = false, removed = false): FileItem {
  const source = ready();
  const trashedAt = "2026-08-23T10:00:00.000Z";
  const purgeAt = new Date(
    new Date(trashedAt).getTime() + TRASH_RETENTION_MILLISECONDS,
  ).toISOString();
  const purgeStartedAt = "2026-09-06T10:00:00.000Z";
  const objectRemovedAt = "2026-09-06T10:00:01.000Z";
  return parseFileItem({
    ...source,
    status: "trashed",
    trashedAt,
    purgeAt,
    gsi2pk: TRASH_PURGE_INDEX_PARTITION,
    gsi2sk: trashPurgeSortKey(purgeAt, project, source.fileId),
    ...(claimed ? { purgeStartedAt } : {}),
    ...(removed ? { objectRemovedAt } : {}),
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
    send
      .mockResolvedValueOnce({ Items: [publicPending()] })
      .mockResolvedValueOnce({ Item: publicPending() });

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
    const primaryRead = send.mock.calls[1]?.[0] as { input: Record<string, unknown> };
    expect(primaryRead.constructor.name).toBe("GetCommand");
    expect(primaryRead.input).toMatchObject({
      TableName: "FileTable",
      ConsistentRead: true,
    });
  });

  it("returns the strongly consistent primary state when the public index is stale", async () => {
    const { send, repository } = fixture();
    send
      .mockResolvedValueOnce({ Items: [publicReady()] })
      .mockResolvedValueOnce({ Item: publicTrashed() });

    await expect(repository.getPublic(publicProject, publicFileId)).resolves.toEqual(
      publicTrashed(),
    );
    expect(send).toHaveBeenCalledTimes(2);

    const purged = fixture();
    purged.send
      .mockResolvedValueOnce({ Items: [publicReady()] })
      .mockResolvedValueOnce({ Item: undefined });
    await expect(purged.repository.getPublic(publicProject, publicFileId)).resolves.toBeUndefined();
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

  it("trashes and restores metadata without changing quota or identities", async () => {
    const source = ready();
    const trashedFile = trashed();
    const trashFixture = fixture();
    trashFixture.send.mockResolvedValueOnce({ Attributes: trashedFile });
    await expect(
      trashFixture.repository.trash(source, trashedFile.trashedAt!, trashedFile.purgeAt!),
    ).resolves.toEqual(trashedFile);
    const trashCommand = trashFixture.send.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(trashCommand.constructor.name).toBe("UpdateCommand");
    expect(JSON.stringify(trashCommand.input, serializeBigInt)).not.toMatch(
      /retainedBytes|accountedBytes/u,
    );

    const restoreFixture = fixture();
    const restored = { ...source, revision: trashedFile.revision + 1n };
    restoreFixture.send.mockResolvedValueOnce({ Attributes: restored });
    await expect(
      restoreFixture.repository.restore(trashedFile, "2026-08-24T10:00:00.000Z"),
    ).resolves.toEqual(restored);
    const restoreCommand = restoreFixture.send.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(JSON.stringify(restoreCommand.input, serializeBigInt)).not.toMatch(
      /retainedBytes|accountedBytes/u,
    );
    expect(JSON.stringify(restoreCommand.input, serializeBigInt)).toContain("REMOVE gsi2pk");
  });

  it("claims, records physical removal, and atomically releases retained quota", async () => {
    const source = trashed();
    const claimed = trashed(true);
    const removed = trashed(true, true);
    const { send, repository } = fixture();
    send
      .mockResolvedValueOnce({ Attributes: claimed })
      .mockResolvedValueOnce({ Attributes: removed })
      .mockResolvedValueOnce({});

    const claim = await repository.claimPermanentRemoval(source, claimed.purgeStartedAt!, false);
    const removal = await repository.recordObjectRemoved(claim, removed.objectRemovedAt!);
    await expect(
      repository.finalizePermanentRemoval(removal, removed.objectRemovedAt!),
    ).resolves.toBeUndefined();

    const transaction = (send.mock.calls[2]?.[0] as { input: { TransactItems: unknown[] } }).input
      .TransactItems;
    expect(transaction).toHaveLength(2);
    expect(transaction[0]).toHaveProperty("Delete");
    expect(JSON.stringify(transaction, serializeBigInt)).toMatch(/retainedBytes.*accountedBytes/u);
    expect(JSON.stringify(transaction, serializeBigInt)).not.toContain("reservedBytes");
  });

  it("forces ready files into the same claimed purge path and resumes claims", async () => {
    const source = ready();
    const forceAt = "2026-08-23T10:00:00.000Z";
    const claimed = parseFileItem({
      ...source,
      status: "trashed",
      trashedAt: forceAt,
      purgeAt: forceAt,
      purgeStartedAt: forceAt,
      gsi2pk: TRASH_PURGE_INDEX_PARTITION,
      gsi2sk: trashPurgeSortKey(forceAt, project, source.fileId),
      revision: source.revision + 1n,
      updatedAt: forceAt,
    });
    const { send, repository } = fixture();
    send.mockResolvedValueOnce({ Attributes: claimed });
    await expect(repository.claimPermanentRemoval(source, forceAt, true)).resolves.toEqual(claimed);
    await expect(repository.claimPermanentRemoval(claimed, forceAt, true)).resolves.toEqual(
      claimed,
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("defers a force claim until the upload capability plus skew has expired", async () => {
    const forceAt = "2026-08-23T10:00:00.000Z";
    const source = parseFileItem({
      ...ready(),
      uploadExpiresAt: "2026-08-23T10:30:00.000Z",
      failureEligibleAt: "2026-08-23T11:30:00.000Z",
    });
    const removalDueAt = "2026-08-23T10:35:00.000Z";
    const claimed = parseFileItem({
      ...source,
      status: "trashed",
      trashedAt: forceAt,
      purgeAt: removalDueAt,
      purgeStartedAt: forceAt,
      gsi2pk: TRASH_PURGE_INDEX_PARTITION,
      gsi2sk: trashPurgeSortKey(removalDueAt, project, source.fileId),
      revision: source.revision + 1n,
      updatedAt: forceAt,
    });
    const { send, repository } = fixture();
    send.mockResolvedValueOnce({ Attributes: claimed });

    await expect(repository.claimPermanentRemoval(source, forceAt, true)).resolves.toEqual(claimed);
    const command = send.mock.calls[0]?.[0] as {
      input: { ExpressionAttributeValues: Record<string, unknown> };
    };
    expect(command.input.ExpressionAttributeValues[":purgeAt"]).toBe(removalDueAt);
    expect(command.input.ExpressionAttributeValues[":lifecycleSk"]).toBe(
      trashPurgeSortKey(removalDueAt, project, source.fileId),
    );
  });

  it("queries due trash separately and treats an absent finalized row as idempotent", async () => {
    const dueFile = trashed();
    const due = fixture();
    due.send.mockResolvedValueOnce({
      Items: [dueFile],
      LastEvaluatedKey: { pk: dueFile.pk, sk: dueFile.sk },
    });
    const page = await due.repository.listDuePurge(dueFile.purgeAt!, 10);
    expect(page.items).toEqual([dueFile]);
    const query = due.send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(query.input).toMatchObject({
      IndexName: FILE_LIFECYCLE_INDEX_NAME,
    });
    const expressionValues = query.input["ExpressionAttributeValues"] as Record<string, unknown>;
    expect(expressionValues[":trash"]).toBe(TRASH_PURGE_INDEX_PARTITION);

    const finalized = fixture();
    finalized.send.mockRejectedValueOnce(
      Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }),
    );
    finalized.send.mockResolvedValueOnce({});
    await expect(
      finalized.repository.finalizePermanentRemoval(
        trashed(true, true),
        "2026-09-06T10:00:02.000Z",
      ),
    ).resolves.toBeUndefined();
  });
});
