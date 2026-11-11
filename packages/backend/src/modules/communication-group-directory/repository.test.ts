import { describe, expect, it } from "vitest";
import { createDynamoGroupDirectoryRepository } from "./repository.js";

const entry = {
  pk: "GROUP#con_1234567890123456789012",
  sk: "METADATA#group-1",
  groupId: "group-1",
  presence: "present",
  observedAt: "2026-11-11T12:00:00.000Z",
  sourceObservedAt: null,
  scanComplete: true,
  knownRecordStartAt: "2026-11-11T12:00:00.000Z",
  projectId: "11111111-1111-4111-8111-111111111111",
  groupProjectId: "PROJECT#11111111-1111-4111-8111-111111111111",
  itemType: "communication-group",
};

describe("group directory repository", () => {
  it("projects Dynamo records into secret-free public directory entries", async () => {
    const repository = createDynamoGroupDirectoryRepository({
      tableName: "communication",
      client: { send: () => Promise.resolve({ Items: [entry] }) },
    });
    await expect(
      repository.list("11111111-1111-4111-8111-111111111111", { limit: 10 }),
    ).resolves.toEqual({
      items: [
        {
          groupId: "group-1",
          presence: "present",
          observedAt: "2026-11-11T12:00:00.000Z",
          sourceObservedAt: null,
          scanComplete: true,
          knownRecordStartAt: "2026-11-11T12:00:00.000Z",
        },
      ],
    });
  });

  it("keeps a project query partitioned even when its cursor is malformed", async () => {
    const sent: unknown[] = [];
    const repository = createDynamoGroupDirectoryRepository({
      tableName: "communication",
      client: {
        send: (command) => {
          sent.push(command);
          return Promise.resolve({ Items: [] });
        },
      },
    });
    await expect(
      repository.list("11111111-1111-4111-8111-111111111111", { limit: 10 }),
    ).resolves.toEqual({ items: [] });
    expect(sent).toHaveLength(1);
    await expect(
      repository.list("11111111-1111-4111-8111-111111111111", { limit: 10, cursor: "not-base64" }),
    ).rejects.toThrow();
  });

  it("writes unknown outage evidence idempotently and projects group events", async () => {
    const sent: unknown[] = [];
    const repository = createDynamoGroupDirectoryRepository({
      tableName: "communication",
      client: {
        send: (command) => {
          sent.push(command);
          return Promise.resolve({
            Items: [
              {
                ...entry,
                pk: "GROUPPROJECT#11111111-1111-4111-8111-111111111111#group-1",
                sk: "EVENT#0000000000000001#group-1",
                eventId: "scan-1:group-1",
                reason: "provider-error",
              },
            ],
          });
        },
      },
    });
    await repository.applySnapshot({
      connectionId: "con_1234567890123456789012",
      projectId: "11111111-1111-4111-8111-111111111111",
      scanId: "scan-1",
      sequence: 1,
      observedAt: "2026-11-11T12:00:00.000Z",
      complete: false,
      groups: [{ groupId: "group-1", confirmed: false, reason: "provider-error" }],
    });
    expect(sent).toHaveLength(2);
    await expect(
      repository.listEvents("11111111-1111-4111-8111-111111111111", "group-1", { limit: 10 }),
    ).resolves.toMatchObject({ items: [{ eventId: "scan-1:group-1", reason: "provider-error" }] });
    await repository.applySnapshot({
      connectionId: "con_1234567890123456789012",
      projectId: "11111111-1111-4111-8111-111111111111",
      scanId: "scan-2",
      sequence: 2,
      observedAt: "2026-11-11T12:01:00.000Z",
      complete: true,
      groups: [{ groupId: "group-1", confirmed: true, reason: "confirmed-by-group-data" }],
    });
    expect(sent).toHaveLength(5);
  });

  it("returns opaque continuation cursors for independently scoped directory and event pages", async () => {
    const pageKey = { pk: "GROUP#next", sk: "METADATA#next" };
    const repository = createDynamoGroupDirectoryRepository({
      tableName: "communication",
      client: {
        send: (command) => {
          const keyCondition = (command as { input?: { KeyConditionExpression?: string } }).input
            ?.KeyConditionExpression;
          return Promise.resolve({
            Items: [
              keyCondition?.includes("begins_with")
                ? { ...entry, eventId: "scan-1:group-1", reason: "confirmed-by-group-data" }
                : entry,
            ],
            LastEvaluatedKey: pageKey,
          });
        },
      },
    });
    const projectId = "11111111-1111-4111-8111-111111111111";
    const groups = await repository.list(projectId, { limit: 1 });
    expect(groups.cursor).toBeTypeOf("string");
    await expect(
      repository.list(projectId, { limit: 1, cursor: groups.cursor! }),
    ).resolves.toMatchObject({
      items: [{ groupId: "group-1" }],
    });
    const events = await repository.listEvents(projectId, "group-1", { limit: 1 });
    expect(events.cursor).toBeTypeOf("string");
  });
});
