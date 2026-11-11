import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createCommunicationMessageService } from "./service.js";
import type { ConnectionRepository } from "../communication-connections/service.js";

const token = "a".repeat(43);
const message = {
  connectionId: "con_abcdefghijklmnopqrstuv",
  instanceId: "123",
  providerMessageId: "id-1",
  conversationId: "123@g.us",
  senderId: "123@g.us",
  receivedAt: "2026-01-01T00:00:00.000Z",
  receiptAt: "2026-01-01T00:00:01.000Z",
  text: "hello",
};
const connection = {
  connectionId: message.connectionId,
  projectId: "prj_abcdefghijklmnopqrstuv",
  provider: "green-api" as const,
  instanceId: "123",
  status: "active" as const,
  createdAt: message.receivedAt,
  updatedAt: message.receivedAt,
  ownerId: "owner",
  secretReference: "ref",
  secretVersion: 1,
  webhookSecretHash: createHash("sha256").update(token).digest("base64url"),
};
function subject() {
  const connections = { inspect: vi.fn().mockResolvedValue(connection) };
  const messages = {
    persist: vi.fn().mockResolvedValue("created"),
    list: vi.fn().mockResolvedValue({ items: [] }),
  };
  const queue = { send: vi.fn().mockResolvedValue(undefined) };
  return {
    service: createCommunicationMessageService({
      connections: connections as unknown as ConnectionRepository,
      messages,
      queue,
    }),
    connections,
    messages,
    queue,
  };
}
describe("communication message service", () => {
  it("accepts only a matching callback token after queue acceptance", async () => {
    const { service, queue } = subject();
    await service.receive({ connectionId: message.connectionId, bearer: token, message });
    expect(queue.send).toHaveBeenCalledWith(message);
  });
  it("rejects an untrusted callback without enqueuing", async () => {
    const { service, queue } = subject();
    await expect(
      service.receive({ connectionId: message.connectionId, bearer: "bad", message }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(queue.send).not.toHaveBeenCalled();
  });
  it("rejects a callback without a bearer before comparing a secret", async () => {
    const { service, queue } = subject();
    await expect(
      service.receive({ connectionId: message.connectionId, bearer: undefined, message }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(queue.send).not.toHaveBeenCalled();
  });
  it("makes duplicate worker processing safe through the repository", async () => {
    const { service, messages } = subject();
    await service.process(message);
    await service.process(message);
    expect(messages.persist).toHaveBeenCalledTimes(2);
  });
  it("rejects inactive, instance-mismatched, and missing connections before the queue", async () => {
    const { service, connections, queue } = subject();
    connections.inspect.mockResolvedValueOnce({ ...connection, status: "disabled" });
    await expect(
      service.receive({ connectionId: message.connectionId, bearer: token, message }),
    ).rejects.toMatchObject({ statusCode: 401 });
    connections.inspect.mockResolvedValueOnce({ ...connection, instanceId: "other" });
    await expect(
      service.receive({ connectionId: message.connectionId, bearer: token, message }),
    ).rejects.toMatchObject({ statusCode: 404 });
    connections.inspect.mockResolvedValueOnce(undefined);
    await expect(
      service.receive({ connectionId: message.connectionId, bearer: token, message }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(queue.send).not.toHaveBeenCalled();
  });
  it("rejects an active connection that has not completed webhook setup", async () => {
    const { service, connections } = subject();
    connections.inspect.mockResolvedValueOnce({ ...connection, webhookSecretHash: undefined });
    await expect(
      service.receive({ connectionId: message.connectionId, bearer: token, message }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
  it("propagates a queue failure so the provider can retry", async () => {
    const { service, queue } = subject();
    queue.send.mockRejectedValueOnce(new Error("unavailable"));
    await expect(
      service.receive({ connectionId: message.connectionId, bearer: token, message }),
    ).rejects.toThrow("unavailable");
  });
  it("does not persist an inactive or mismatched worker event", async () => {
    const { service, connections, messages } = subject();
    connections.inspect.mockResolvedValueOnce({ ...connection, status: "disabled" });
    await service.process(message);
    connections.inspect.mockResolvedValueOnce({ ...connection, instanceId: "other" });
    await service.process(message);
    expect(messages.persist).not.toHaveBeenCalled();
  });
  it("scopes history to the verified project and hides another project's connection", async () => {
    const { service, messages, connections } = subject();
    const context = {
      internalProjectId: "00000000-0000-4000-8000-000000000001",
      publicProjectId: connection.projectId,
      keyId: "key_abcdefghijklmnopqrstuv",
      enabledUtilities: ["communication"] as "communication"[],
      fileManagement: {
        uploadUrlLifetimeMinutes: 15,
        downloadUrlLifetimeMinutes: 5,
        storageQuotaBytes: 1,
        trashRetentionDays: 1,
      },
      fileManagementPolicyVersion: 1,
    };
    await service.history(context, {
      connectionId: message.connectionId,
      conversationId: message.conversationId,
      limit: 5,
    });
    expect(messages.list).toHaveBeenCalledWith(
      expect.objectContaining({ internalProjectId: connection.projectId }),
    );
    connections.inspect.mockResolvedValueOnce({
      ...connection,
      projectId: "prj_zyxwvutsrqponmlkjihgfe",
    });
    await expect(
      service.history(context, {
        connectionId: message.connectionId,
        conversationId: message.conversationId,
        limit: 5,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
