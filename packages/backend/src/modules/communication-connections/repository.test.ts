import { describe, expect, it, vi } from "vitest";
import { QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { createDynamoConnectionRepository } from "./repository.js";
import {
  DuplicateProviderInstanceError,
  ProjectCommunicationAlreadyBoundError,
  type ConnectionRecord,
} from "./service.js";

const record: ConnectionRecord = {
  connectionId: "con_1234567890123456789012",
  projectId: "prj_1234567890123456789012",
  provider: "green-api",
  instanceId: "instance-a",
  status: "active",
  ownerId: "owner-a",
  secretReference: "/utility-services/dev/communication/con_1234567890123456789012",
  secretVersion: 1,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
};

describe("Dynamo communication connection repository", () => {
  it("atomically writes metadata, provider, and one-connection-per-project reservations", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = createDynamoConnectionRepository({
      client: { send },
      tableName: "connections",
    });
    await repository.reserveAndCreate(record);
    const command: unknown = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand)) throw new Error("Expected transaction command");
    const items = command.input.TransactItems;
    expect(items).toHaveLength(3);
    expect(items?.[1]?.Put?.Item?.pk).toBe("PROJECT#prj_1234567890123456789012#COMMUNICATION");
    expect(items?.[2]?.Put?.Item?.pk).toBe("PROVIDER#green-api#INSTANCE#instance-a");
    expect(
      items?.every((item) => item.Put?.ConditionExpression === "attribute_not_exists(pk)"),
    ).toBe(true);
  });

  it("maps a conditional failure to the safe duplicate-instance result", async () => {
    const repository = createDynamoConnectionRepository({
      client: { send: vi.fn().mockRejectedValue({ name: "TransactionCanceledException" }) },
      tableName: "connections",
    });
    await expect(repository.reserveAndCreate(record)).rejects.toBeInstanceOf(
      DuplicateProviderInstanceError,
    );
  });

  it("maps the project reservation conditional failure to the MVP one-connection conflict", async () => {
    const repository = createDynamoConnectionRepository({
      client: {
        send: vi.fn().mockRejectedValue({
          name: "TransactionCanceledException",
          CancellationReasons: [
            { Code: "None" },
            { Code: "ConditionalCheckFailed" },
            { Code: "None" },
          ],
        }),
      },
      tableName: "connections",
    });
    await expect(repository.reserveAndCreate(record)).rejects.toBeInstanceOf(
      ProjectCommunicationAlreadyBoundError,
    );
  });

  it("reads a connection by opaque id", async () => {
    const repository = createDynamoConnectionRepository({
      client: {
        send: vi.fn().mockResolvedValue({
          Item: {
            ...record,
            pk: "CONNECTION#con_1234567890123456789012",
            sk: "METADATA",
            itemType: "communication-connection",
          },
        }),
      },
      tableName: "connections",
    });
    await expect(repository.inspect(record.connectionId)).resolves.toMatchObject({
      connectionId: record.connectionId,
      secretReference: record.secretReference,
    });
  });

  it("uses the project index to discover the bounded project connection set", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        {
          ...record,
          pk: "CONNECTION#con_1234567890123456789012",
          sk: "METADATA",
          itemType: "communication-connection",
        },
      ],
    });
    const repository = createDynamoConnectionRepository({
      client: { send },
      tableName: "connections",
    });
    await expect(repository.listForProject(record.projectId)).resolves.toHaveLength(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(QueryCommand);
    expect((send.mock.calls[0]?.[0] as QueryCommand).input).toMatchObject({
      IndexName: "projectId-index",
      KeyConditionExpression: "projectId = :projectId",
    });
  });

  it("atomically replaces the secret reference only when the expected metadata version matches", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = createDynamoConnectionRepository({
      client: { send },
      tableName: "connections",
    });
    await repository.updateLifecycle(record.connectionId, 1, {
      secretReference: "ref-v2",
      secretVersion: 2,
      status: "active",
      updatedAt: record.updatedAt,
    });
    const command: unknown = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    if (!(command instanceof UpdateCommand)) throw new Error("Expected update command");
    expect(command.input.ConditionExpression).toBe(
      "attribute_exists(pk) AND secretVersion = :expectedVersion",
    );
    expect(command.input.ExpressionAttributeValues?.[":secretReference"]).toBe("ref-v2");
  });
});
