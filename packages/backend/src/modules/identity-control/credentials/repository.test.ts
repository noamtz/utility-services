import {
  GetCommand,
  QueryCommand,
  TransactGetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import {
  toEnabledUtilityItem,
  toProjectMetadataItem,
  type InternalProject,
} from "../projects/model.js";
import { DUMMY_SECRET_HASH } from "./credential.js";
import { toCredentialItems } from "./model.js";
import {
  CorruptCredentialRecordError,
  CredentialCollisionError,
  CredentialStateConflictError,
  createDynamoCredentialRepository,
  type CredentialDocumentClient,
} from "./repository.js";

const timestamp = "2026-08-23T08:00:00.000Z";
const project: InternalProject = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  ownerId: "owner-1",
  name: "Repository project",
  status: "active",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: timestamp,
  updatedAt: timestamp,
};
const records = toCredentialItems({
  internalProjectId: project.internalProjectId,
  publicProjectId: project.publicProjectId,
  keyId: "key_0123456789abcdefghijkl",
  secretHash: DUMMY_SECRET_HASH,
  createdAt: timestamp,
});

function clientWith(send: ReturnType<typeof vi.fn>): CredentialDocumentClient {
  return { send } as unknown as CredentialDocumentClient;
}

function repository(send: ReturnType<typeof vi.fn>) {
  return createDynamoCredentialRepository({ client: clientWith(send), tableName: "Control" });
}

describe("Dynamo credential repository", () => {
  it("inspects owned project and credential metadata with strongly consistent reads", async () => {
    const metadata = toProjectMetadataItem(project);
    const utility = toEnabledUtilityItem(
      project.publicProjectId,
      project.fileManagement,
      timestamp,
      timestamp,
    );
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Responses: [{ Item: metadata }, { Item: utility }] })
      .mockResolvedValueOnce({ Item: records.metadata });
    const repo = repository(send);

    await expect(repo.inspectProject(project.publicProjectId)).resolves.toEqual(project);
    await expect(
      repo.inspectMetadata(project.publicProjectId, records.metadata.keyId),
    ).resolves.toEqual(records.metadata);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(TransactGetCommand);
    expect((send.mock.calls[0]?.[0] as TransactGetCommand).input.TransactItems).toHaveLength(2);
    expect((send.mock.calls[1]?.[0] as GetCommand).input.ConsistentRead).toBe(true);
  });

  it("queries only the project credential prefix and reconstructs pagination", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [records.metadata],
      LastEvaluatedKey: { pk: records.metadata.pk },
    });
    const result = await repository(send).list({
      publicProjectId: project.publicProjectId,
      limit: 20,
      startAfter: { keyId: records.metadata.keyId },
    });
    const command = send.mock.calls[0]?.[0] as QueryCommand;
    expect(command.input).toMatchObject({
      KeyConditionExpression: "pk = :project AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":project": records.metadata.pk, ":prefix": "API_KEY#" },
      ConsistentRead: true,
      Limit: 20,
      ExclusiveStartKey: { pk: records.metadata.pk, sk: records.metadata.sk },
    });
    expect(result.nextCursor).toEqual({ keyId: records.metadata.keyId });
    expect(JSON.stringify(command.input)).not.toContain("Scan");
  });

  it("uses direct lookup and a four-item transactional verification snapshot", async () => {
    const projectMetadata = toProjectMetadataItem(project);
    const utility = toEnabledUtilityItem(
      project.publicProjectId,
      project.fileManagement,
      timestamp,
      timestamp,
    );
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: records.lookup })
      .mockResolvedValueOnce({
        Responses: [
          { Item: records.lookup },
          { Item: records.metadata },
          { Item: projectMetadata },
          { Item: utility },
        ],
      });
    const repo = repository(send);

    await expect(repo.getLookup(records.lookup.keyId)).resolves.toEqual(records.lookup);
    await expect(
      repo.getVerificationSnapshot(records.lookup.keyId, project.publicProjectId),
    ).resolves.toMatchObject({ project });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetCommand);
    const snapshot = send.mock.calls[1]?.[0] as TransactGetCommand;
    expect(snapshot).toBeInstanceOf(TransactGetCommand);
    expect(snapshot.input.TransactItems).toHaveLength(4);
  });

  it("issues both records atomically with stored project and utility conditions", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repository(send).issue(project, records.metadata, records.lookup);
    const command = send.mock.calls[0]?.[0] as TransactWriteCommand;
    expect(command.input.ClientRequestToken).toBe(`issue:${records.metadata.keyId}`);
    expect(command.input.TransactItems).toHaveLength(4);
    expect(command.input.TransactItems?.map((item) => Object.keys(item)[0])).toEqual([
      "ConditionCheck",
      "ConditionCheck",
      "Put",
      "Put",
    ]);
    expect(
      command.input.TransactItems?.slice(2).map((item) => item.Put?.ConditionExpression),
    ).toEqual(["attribute_not_exists(pk)", "attribute_not_exists(pk)"]);
  });

  it("classifies only confirmed new-item cancellation reasons as collisions", async () => {
    const collision = Object.assign(new Error("private AWS detail"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "None" }, { Code: "None" }, { Code: "ConditionalCheckFailed" }],
    });
    await expect(
      repository(vi.fn().mockRejectedValue(collision)).issue(
        project,
        records.metadata,
        records.lookup,
      ),
    ).rejects.toBeInstanceOf(CredentialCollisionError);
    const projectFailure = Object.assign(new Error("private AWS detail"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
    });
    await expect(
      repository(vi.fn().mockRejectedValue(projectFailure)).issue(
        project,
        records.metadata,
        records.lookup,
      ),
    ).rejects.toBeInstanceOf(CredentialStateConflictError);

    const simultaneousFailure = Object.assign(new Error("private AWS detail"), {
      name: "TransactionCanceledException",
      CancellationReasons: [
        { Code: "ConditionalCheckFailed" },
        { Code: "None" },
        { Code: "ConditionalCheckFailed" },
      ],
    });
    await expect(
      repository(vi.fn().mockRejectedValue(simultaneousFailure)).issue(
        project,
        records.metadata,
        records.lookup,
      ),
    ).rejects.toBeInstanceOf(CredentialStateConflictError);
  });

  it("updates both records atomically for revoke and all four records for replace", async () => {
    const replacement = toCredentialItems({
      ...project,
      keyId: "key_0123456789abcdefghijkm",
      secretHash: DUMMY_SECRET_HASH,
      createdAt: timestamp,
    });
    const send = vi.fn().mockResolvedValue({});
    const repo = repository(send);
    await expect(repo.revoke(records.metadata, timestamp)).resolves.toMatchObject({
      status: "revoked",
    });
    await expect(
      repo.replace(records.metadata, replacement.metadata, replacement.lookup, timestamp),
    ).resolves.toMatchObject({
      status: "replaced",
      replacementKeyId: replacement.metadata.keyId,
    });
    expect((send.mock.calls[0]?.[0] as TransactWriteCommand).input.TransactItems).toHaveLength(2);
    expect(
      (send.mock.calls[0]?.[0] as TransactWriteCommand).input.ClientRequestToken,
    ).toBeUndefined();
    expect((send.mock.calls[1]?.[0] as TransactWriteCommand).input.TransactItems).toHaveLength(4);
  });

  it("updates metadata and lookup atomically for suspension and resumption", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repo = repository(send);

    const suspended = await repo.setOperationalStatus(
      records.metadata,
      "active",
      "suspended",
      timestamp,
    );
    expect(suspended.status).toBe("suspended");

    const command = send.mock.calls[0]?.[0] as TransactWriteCommand;
    expect(command.input.TransactItems).toHaveLength(2);
    expect(command.input.TransactItems?.map((item) => item.Update?.UpdateExpression)).toEqual([
      "SET #status = :next, updatedAt = :updatedAt",
      "SET #status = :next, updatedAt = :updatedAt",
    ]);
    expect(command.input.TransactItems?.[1]?.Update?.Key).toEqual({
      pk: `API_KEY#${records.metadata.keyId}`,
      sk: "LOOKUP",
    });

    await expect(
      repo.setOperationalStatus(suspended, "suspended", "active", timestamp),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("rejects terminal or concurrently changed operational state safely", async () => {
    const repo = repository(vi.fn());
    await expect(
      repo.setOperationalStatus(
        { ...records.metadata, status: "revoked", revokedAt: timestamp },
        "active",
        "suspended",
        timestamp,
      ),
    ).rejects.toBeInstanceOf(CredentialStateConflictError);

    const conflict = Object.assign(new Error("provider detail"), {
      name: "TransactionCanceledException",
    });
    await expect(
      repository(vi.fn().mockRejectedValue(conflict)).setOperationalStatus(
        records.metadata,
        "active",
        "suspended",
        timestamp,
      ),
    ).rejects.toBeInstanceOf(CredentialStateConflictError);
  });

  it("returns terminal revoke idempotently without writing and fails closed on corrupt records", async () => {
    const send = vi.fn();
    const repo = repository(send);
    await expect(
      repo.revoke({ ...records.metadata, status: "revoked", revokedAt: timestamp }, timestamp),
    ).resolves.toMatchObject({ status: "revoked" });
    expect(send).not.toHaveBeenCalled();

    const corruptSend = vi.fn().mockResolvedValue({
      Item: { ...records.lookup, keyId: "key_0123456789abcdefghijkm" },
    });
    await expect(repository(corruptSend).getLookup(records.lookup.keyId)).rejects.toBeInstanceOf(
      CorruptCredentialRecordError,
    );
  });
});
