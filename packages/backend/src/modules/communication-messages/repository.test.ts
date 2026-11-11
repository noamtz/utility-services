import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { createDynamoMessageRepository } from "./repository.js";

const message = {
  connectionId: "con_abcdefghijklmnopqrstuv",
  instanceId: "1",
  providerMessageId: "m1",
  conversationId: "1@g.us",
  senderId: "1@g.us",
  receivedAt: "2026-01-01T00:00:00.000Z",
  receiptAt: "2026-01-01T00:00:01.000Z",
  text: "hello",
};
const connection = {
  ...message,
  projectId: "prj_abcdefghijklmnopqrstuv",
  provider: "green-api" as const,
  status: "active" as const,
  createdAt: message.receivedAt,
  updatedAt: message.receivedAt,
  ownerId: "o",
  secretReference: "r",
  secretVersion: 1,
};
describe("message repository", () => {
  it("writes source deduplication and keeps the first observation atomically", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = createDynamoMessageRepository({ client: { send }, tableName: "messages" });
    await expect(repository.persist(message, connection)).resolves.toBe("created");
    const command = send.mock.calls[0]?.[0] as TransactWriteCommand;
    expect(command.input.TransactItems).toHaveLength(3);
    expect(JSON.stringify(command.input)).toContain("if_not_exists");
  });
  it("treats conditional replay as a successful duplicate", async () => {
    const repository = createDynamoMessageRepository({
      client: {
        send: vi.fn().mockRejectedValue({
          name: "TransactionCanceledException",
          CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
        }),
      },
      tableName: "messages",
    });
    await expect(repository.persist(message, connection)).resolves.toBe("duplicate");
  });
  it("rejects malformed cursors before Dynamo and returns watermark metadata", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [message] })
      .mockResolvedValueOnce({ Items: [{ knownRecordStartedAt: message.receiptAt }] });
    const repository = createDynamoMessageRepository({ client: { send }, tableName: "messages" });
    await expect(
      repository.list({
        internalProjectId: connection.projectId,
        connectionId: message.connectionId,
        conversationId: message.conversationId,
        limit: 5,
        cursor: "%%%",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      repository.list({
        internalProjectId: connection.projectId,
        connectionId: message.connectionId,
        conversationId: message.conversationId,
        limit: 5,
      }),
    ).resolves.toMatchObject({
      watermark: message.receiptAt,
      knownRecordStartedAt: message.receiptAt,
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(QueryCommand);
  });
  it("preserves non-conditional persistence failures and serializes a next cursor", async () => {
    const failing = createDynamoMessageRepository({
      client: { send: vi.fn().mockRejectedValue(new Error("dynamo unavailable")) },
      tableName: "messages",
    });
    await expect(failing.persist(message, connection)).rejects.toThrow("dynamo unavailable");
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [message], LastEvaluatedKey: { pk: "p", sk: "s" } })
      .mockResolvedValueOnce({ Items: [] });
    const repository = createDynamoMessageRepository({ client: { send }, tableName: "messages" });
    const page = await repository.list({
      internalProjectId: connection.projectId,
      connectionId: message.connectionId,
      conversationId: message.conversationId,
      limit: 5,
    });
    expect(page.nextCursor).toBeDefined();
  });
  it("rethrows transaction cancellations that are not source deduplication", async () => {
    const repository = createDynamoMessageRepository({
      client: {
        send: vi.fn().mockRejectedValue({
          name: "TransactionCanceledException",
          CancellationReasons: [{ Code: "TransactionConflict" }, { Code: "None" }],
        }),
      },
      tableName: "messages",
    });
    await expect(repository.persist(message, connection)).rejects.toMatchObject({
      name: "TransactionCanceledException",
    });
  });
  it("rejects a cursor from a different conversation partition", async () => {
    const repository = createDynamoMessageRepository({
      client: { send: vi.fn() },
      tableName: "messages",
    });
    const cursor = Buffer.from(JSON.stringify({ pk: "PROJECT#other", sk: "MESSAGE#x" })).toString(
      "base64url",
    );
    await expect(
      repository.list({
        internalProjectId: connection.projectId,
        connectionId: message.connectionId,
        conversationId: message.conversationId,
        limit: 5,
        cursor,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
