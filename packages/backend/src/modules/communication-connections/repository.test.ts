import { describe, expect, it, vi } from "vitest";

import { createDynamoConnectionRepository } from "./repository.js";
import { DuplicateProviderInstanceError, type ConnectionRecord } from "./service.js";

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
  it("atomically writes metadata and the installation-wide provider instance reservation", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = createDynamoConnectionRepository({
      client: { send },
      tableName: "connections",
    });
    await repository.reserveAndCreate(record);
    const input = send.mock.calls[0]?.[0].input as {
      TransactItems: Array<{ Put: { Item: Record<string, unknown>; ConditionExpression: string } }>;
    };
    expect(input.TransactItems).toHaveLength(2);
    expect(input.TransactItems[1]?.Put.Item.pk).toBe("PROVIDER#green-api#INSTANCE#instance-a");
    expect(
      input.TransactItems.every(
        (item) => item.Put.ConditionExpression === "attribute_not_exists(pk)",
      ),
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

  it("reads a connection by opaque id", async () => {
    const repository = createDynamoConnectionRepository({
      client: {
        send: vi
          .fn()
          .mockResolvedValue({
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
});
