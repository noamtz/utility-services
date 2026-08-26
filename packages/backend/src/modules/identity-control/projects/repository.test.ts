import { QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import {
  CorruptProjectRecordError,
  ProjectCollisionError,
  ProjectStateConflictError,
  createDynamoProjectRepository,
  type ProjectDocumentClient,
} from "./repository.js";
import { toEnabledUtilityItem, toProjectMetadataItem, type InternalProject } from "./model.js";

const project: InternalProject = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  ownerId: "owner-1",
  name: "Repository project",
  status: "active",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: "2026-08-23T08:00:00.000Z",
  updatedAt: "2026-08-23T08:00:00.000Z",
};

function clientWith(send: ReturnType<typeof vi.fn>): ProjectDocumentClient {
  return { send } as unknown as ProjectDocumentClient;
}

describe("Dynamo project repository", () => {
  it("creates metadata and utility atomically with collision conditions", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = createDynamoProjectRepository({
      client: clientWith(send),
      tableName: "Control",
    });

    await repository.create(project);

    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0] as TransactWriteCommand;
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.TransactItems).toHaveLength(2);
    expect(command.input.TransactItems?.map((item) => item.Put?.ConditionExpression)).toEqual([
      "attribute_not_exists(pk)",
      "attribute_not_exists(pk)",
    ]);
    expect(command.input.TransactItems?.[0]?.Put?.Item).toEqual(toProjectMetadataItem(project));
    expect(command.input.TransactItems?.[1]?.Put?.Item).toEqual(
      toEnabledUtilityItem(
        project.publicProjectId,
        project.fileManagement,
        project.createdAt,
        project.updatedAt,
      ),
    );
  });

  it("classifies transaction condition failures without exposing AWS details", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("table secret"), { name: "TransactionCanceledException" }),
      );
    const repository = createDynamoProjectRepository({
      client: clientWith(send),
      tableName: "Control",
    });

    await expect(repository.create(project)).rejects.toBeInstanceOf(ProjectCollisionError);
    await expect(repository.create(project)).rejects.not.toThrow("table secret");
  });

  it("queries the trusted owner index in descending order with bounded pagination", async () => {
    const metadata = toProjectMetadataItem(project);
    const send = vi
      .fn()
      .mockResolvedValue({ Items: [metadata], LastEvaluatedKey: { pk: metadata.pk } });
    const repository = createDynamoProjectRepository({
      client: clientWith(send),
      tableName: "Control",
    });

    const result = await repository.list({
      ownerId: "owner-1",
      limit: 20,
      startAfter: { projectId: project.publicProjectId, createdAt: project.createdAt },
    });

    const command = send.mock.calls[0]?.[0] as QueryCommand;
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toMatchObject({
      TableName: "Control",
      IndexName: "OwnerProjects",
      KeyConditionExpression: "gsi1pk = :owner",
      ExpressionAttributeValues: { ":owner": "OWNER#owner-1" },
      ScanIndexForward: false,
      Limit: 20,
      ExclusiveStartKey: {
        pk: `PROJECT#${project.publicProjectId}`,
        sk: "METADATA",
        gsi1pk: "OWNER#owner-1",
      },
    });
    expect(result).toEqual({
      items: [metadata],
      nextCursor: { projectId: project.publicProjectId, createdAt: project.createdAt },
    });
  });

  it("fails closed if an owner-index item claims another owner", async () => {
    const metadata = toProjectMetadataItem(project);
    const send = vi.fn().mockResolvedValue({
      Items: [{ ...metadata, ownerId: "owner-2", gsi1pk: "OWNER#owner-2" }],
    });
    const repository = createDynamoProjectRepository({
      client: clientWith(send),
      tableName: "Control",
    });

    await expect(repository.list({ ownerId: "owner-1", limit: 20 })).rejects.toBeInstanceOf(
      CorruptProjectRecordError,
    );
  });

  it("fails closed if an owner-index item has noncanonical key relationships", async () => {
    const metadata = toProjectMetadataItem(project);
    const send = vi.fn().mockResolvedValue({
      Items: [
        {
          ...metadata,
          gsi1sk: `PROJECT#${project.createdAt}#prj_0123456789abcdefghijkm`,
        },
      ],
    });
    const repository = createDynamoProjectRepository({
      client: clientWith(send),
      tableName: "Control",
    });

    await expect(repository.list({ ownerId: "owner-1", limit: 20 })).rejects.toBeInstanceOf(
      CorruptProjectRecordError,
    );
  });

  it("inspects a project partition consistently and validates both items", async () => {
    const metadata = toProjectMetadataItem(project);
    const utility = toEnabledUtilityItem(
      project.publicProjectId,
      project.fileManagement,
      project.createdAt,
      project.updatedAt,
    );
    const send = vi.fn().mockResolvedValue({ Items: [utility, metadata] });
    const repository = createDynamoProjectRepository({
      client: clientWith(send),
      tableName: "Control",
    });

    await expect(repository.inspect(project.publicProjectId)).resolves.toEqual(project);
    const command = send.mock.calls[0]?.[0] as QueryCommand;
    expect(command.input).toMatchObject({
      KeyConditionExpression: "pk = :project",
      ExpressionAttributeValues: { ":project": `PROJECT#${project.publicProjectId}` },
      ConsistentRead: true,
    });
  });

  it("returns missing only for an empty partition and rejects incomplete/corrupt records", async () => {
    const metadata = toProjectMetadataItem(project);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [metadata] })
      .mockResolvedValueOnce({
        Items: [
          { ...metadata, name: "" },
          toEnabledUtilityItem(
            project.publicProjectId,
            project.fileManagement,
            project.createdAt,
            project.updatedAt,
          ),
        ],
      })
      .mockResolvedValueOnce({
        Items: [
          {
            ...metadata,
            publicProjectId: "prj_0123456789abcdefghijkm",
          },
          toEnabledUtilityItem(
            project.publicProjectId,
            project.fileManagement,
            project.createdAt,
            project.updatedAt,
          ),
        ],
      });
    const repository = createDynamoProjectRepository({
      client: clientWith(send),
      tableName: "Control",
    });

    await expect(repository.inspect(project.publicProjectId)).resolves.toBeUndefined();
    await expect(repository.inspect(project.publicProjectId)).rejects.toBeInstanceOf(
      CorruptProjectRecordError,
    );
    await expect(repository.inspect(project.publicProjectId)).rejects.toBeInstanceOf(
      CorruptProjectRecordError,
    );
    await expect(repository.inspect(project.publicProjectId)).rejects.toBeInstanceOf(
      CorruptProjectRecordError,
    );
  });

  it("conditionally updates operational status and accepts legacy active records", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = createDynamoProjectRepository({
      client: clientWith(send),
      tableName: "Control",
    });

    await repository.setOperationalStatus(
      project.publicProjectId,
      "active",
      "suspended",
      "2026-08-25T10:00:00.000Z",
    );

    const command = send.mock.calls[0]?.[0] as UpdateCommand;
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input).toMatchObject({
      TableName: "Control",
      Key: { pk: `PROJECT#${project.publicProjectId}`, sk: "METADATA" },
      UpdateExpression: "SET #status = :next, updatedAt = :changedAt",
      ExpressionAttributeValues: { ":expected": "active", ":next": "suspended" },
    });
    expect(command.input.ConditionExpression).toContain("attribute_not_exists(#status)");
  });

  it("maps conditional operational-status races to a safe conflict", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("provider detail"), { name: "ConditionalCheckFailedException" }),
      );
    const repository = createDynamoProjectRepository({
      client: clientWith(send),
      tableName: "Control",
    });

    const update = () =>
      repository.setOperationalStatus(
        project.publicProjectId,
        "suspended",
        "active",
        "2026-08-25T10:00:00.000Z",
      );
    await expect(update()).rejects.toBeInstanceOf(ProjectStateConflictError);
    await expect(update()).rejects.not.toThrow("provider detail");
  });
});
