import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GroupDirectoryEntrySchema, GroupEventSchema } from "@utility-services/contracts";
import { z } from "zod";
import type { GroupDirectoryRepository } from "./service.js";

const groupPk = (connectionId: string) => `GROUP#${connectionId}`;
const groupProjectKey = (projectId: string) => `PROJECT#${projectId}`;
const eventPk = (projectId: string, groupId: string) => `GROUPPROJECT#${projectId}#${groupId}`;
const entryFromItem = (item: unknown) => {
  const record = z.record(z.string(), z.unknown()).parse(item);
  return GroupDirectoryEntrySchema.parse({
    groupId: record["groupId"],
    presence: record["presence"],
    observedAt: record["observedAt"],
    sourceObservedAt: record["sourceObservedAt"],
    scanComplete: record["scanComplete"],
    knownRecordStartAt: record["knownRecordStartAt"],
  });
};
const eventFromItem = (item: unknown) => {
  const record = z.record(z.string(), z.unknown()).parse(item);
  return GroupEventSchema.parse({
    ...entryFromItem(record),
    eventId: record["eventId"],
    reason: record["reason"],
  });
};
const cursor = (key: unknown) => Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
const cursorKey = (value: string | undefined): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  return z.record(z.string(), z.unknown()).parse(decoded);
};

export function createDynamoGroupDirectoryRepository(options: {
  client: { send(command: PutCommand | QueryCommand): Promise<unknown> };
  tableName: string;
}): GroupDirectoryRepository {
  const tableName = z.string().min(1).parse(options.tableName);
  return {
    async applySnapshot(snapshot) {
      // The event identity is scanId/groupId, so retrying a scan overwrites identical evidence rather than duplicating it.
      for (const observation of snapshot.groups) {
        const presence = observation.confirmed ? "present" : "unknown";
        const entry = GroupDirectoryEntrySchema.parse({
          groupId: observation.groupId,
          presence,
          observedAt: snapshot.observedAt,
          sourceObservedAt: null,
          scanComplete: snapshot.complete,
          knownRecordStartAt: snapshot.observedAt,
        });
        const event = GroupEventSchema.parse({
          ...entry,
          eventId: `${snapshot.scanId}:${observation.groupId}`,
          reason: observation.reason,
        });
        await options.client.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              pk: groupPk(snapshot.connectionId),
              sk: `METADATA#${observation.groupId}`,
              itemType: "communication-group",
              projectId: snapshot.projectId,
              groupProjectId: groupProjectKey(snapshot.projectId),
              sourceSequence: snapshot.sequence,
              ...entry,
            },
            ConditionExpression:
              "attribute_not_exists(sourceSequence) OR sourceSequence <= :sequence",
            ExpressionAttributeValues: { ":sequence": snapshot.sequence },
          }),
        );
        await options.client.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              pk: eventPk(snapshot.projectId, observation.groupId),
              sk: `EVENT#${snapshot.sequence.toString().padStart(16, "0")}#${observation.groupId}`,
              itemType: "communication-group-event",
              projectId: snapshot.projectId,
              ...event,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
      }
    },
    async list(projectId, query) {
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "groupProjectId-index",
          KeyConditionExpression: "groupProjectId = :project",
          ExpressionAttributeValues: { ":project": groupProjectKey(projectId) },
          Limit: query.limit,
          ExclusiveStartKey: cursorKey(query.cursor),
        }),
      );
      const response = output as { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> };
      return {
        items: (response.Items ?? []).map(entryFromItem),
        ...(response.LastEvaluatedKey ? { cursor: cursor(response.LastEvaluatedKey) } : {}),
      };
    },
    async listEvents(projectId, groupId, query) {
      // Event records are queried from the group partition then project-filtered, so one project's API key cannot reveal another project's history.
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :event)",
          ExpressionAttributeValues: { ":pk": eventPk(projectId, groupId), ":event": "EVENT#" },
          Limit: query.limit,
          ExclusiveStartKey: cursorKey(query.cursor),
        }),
      );
      const response = output as { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> };
      const items = response.Items ?? [];
      return {
        items: items.map(eventFromItem),
        ...(response.LastEvaluatedKey ? { cursor: cursor(response.LastEvaluatedKey) } : {}),
      };
    },
  };
}
