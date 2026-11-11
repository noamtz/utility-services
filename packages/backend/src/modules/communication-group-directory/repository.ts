import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GroupDirectoryEntrySchema, GroupEventSchema } from "@utility-services/contracts";
import { z } from "zod";
import type { GroupDirectoryRepository } from "./service.js";

const groupPk = (connectionId: string) => `GROUP#${connectionId}`;
const groupProjectKey = (projectId: string) => `PROJECT#${projectId}`;
const eventPk = (projectId: string, groupId: string) => `GROUPPROJECT#${projectId}#${groupId}`;
const directoryPk = (connectionId: string) => `CONNECTION#${connectionId}`;
function isConditionalFailure(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "ConditionalCheckFailedException"
  );
}
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
const CursorSchema = z
  .object({
    version: z.literal(1),
    projectId: z.uuid(),
    groupId: z.string().optional(),
    sortKey: z.string().optional(),
  })
  .strict();
function encodeCursor(projectId: string, payload: { groupId?: string; sortKey?: string }) {
  return Buffer.from(
    JSON.stringify(CursorSchema.parse({ version: 1, projectId, ...payload })),
    "utf8",
  ).toString("base64url");
}
function decodeCursor(value: string | undefined, projectId: string, groupId?: string) {
  if (!value) return undefined;
  try {
    const parsed = CursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (
      parsed.projectId !== z.uuid().parse(projectId) ||
      (groupId !== undefined && parsed.groupId !== groupId)
    )
      throw new Error("mismatch");
    return parsed;
  } catch {
    throw new Error("GROUP_CURSOR_INVALID");
  }
}

export function createDynamoGroupDirectoryRepository(options: {
  client: { send(command: PutCommand | QueryCommand | UpdateCommand): Promise<unknown> };
  tableName: string;
}): GroupDirectoryRepository {
  const tableName = z.string().min(1).parse(options.tableName);
  return {
    async allocateScan(connectionId) {
      const output = await options.client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: directoryPk(connectionId), sk: "DIRECTORY#METADATA" },
          UpdateExpression: "ADD scanSequence :one",
          ExpressionAttributeValues: { ":one": 1 },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      return z
        .number()
        .int()
        .positive()
        .parse((output as { Attributes?: { scanSequence?: unknown } }).Attributes?.scanSequence);
    },
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
        try {
          await options.client.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { pk: groupPk(snapshot.connectionId), sk: `METADATA#${observation.groupId}` },
              UpdateExpression:
                "SET itemType = :type, projectId = :projectId, groupProjectId = :groupProjectId, sourceSequence = :sequence, scanId = :scanId, groupId = :groupId, presence = :presence, observedAt = :observedAt, sourceObservedAt = :sourceObservedAt, scanComplete = :scanComplete, knownRecordStartAt = if_not_exists(knownRecordStartAt, :knownRecordStartAt)",
              ConditionExpression:
                "attribute_not_exists(sourceSequence) OR sourceSequence < :sequence OR (sourceSequence = :sequence AND scanId = :scanId)",
              ExpressionAttributeValues: {
                ":type": "communication-group",
                ":projectId": snapshot.projectId,
                ":groupProjectId": groupProjectKey(snapshot.projectId),
                ":sequence": snapshot.sequence,
                ":scanId": snapshot.scanId,
                ":groupId": entry.groupId,
                ":presence": entry.presence,
                ":observedAt": entry.observedAt,
                ":sourceObservedAt": entry.sourceObservedAt,
                ":scanComplete": entry.scanComplete,
                ":knownRecordStartAt": entry.knownRecordStartAt,
              },
            }),
          );
        } catch (error) {
          // A newer allocated scan has already won. Do not append stale evidence.
          if (isConditionalFailure(error)) continue;
          throw error;
        }
        try {
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
              ConditionExpression: "attribute_not_exists(sk)",
            }),
          );
        } catch (error) {
          // The scan/group event key is stable across retries.
          if (!isConditionalFailure(error)) throw error;
        }
      }
    },
    async listKnownForConnection(connectionId) {
      const items = [];
      let startKey: Record<string, unknown> | undefined;
      do {
        const output = (await options.client.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :metadata)",
            ExpressionAttributeValues: { ":pk": groupPk(connectionId), ":metadata": "METADATA#" },
            ...(startKey ? { ExclusiveStartKey: startKey } : {}),
          }),
        )) as { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> };
        items.push(...(output.Items ?? []).map(entryFromItem));
        startKey = output.LastEvaluatedKey;
      } while (startKey);
      return items;
    },
    async list(projectId, query) {
      const parsedCursor = decodeCursor(query.cursor, projectId);
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "groupProjectId-index",
          KeyConditionExpression: parsedCursor?.sortKey
            ? "groupProjectId = :project AND sk > :start"
            : "groupProjectId = :project",
          ExpressionAttributeValues: {
            ":project": groupProjectKey(projectId),
            ...(parsedCursor?.sortKey ? { ":start": parsedCursor.sortKey } : {}),
          },
          Limit: query.limit,
        }),
      );
      const response = output as { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> };
      return {
        items: (response.Items ?? []).map(entryFromItem),
        ...(response.LastEvaluatedKey
          ? {
              cursor: encodeCursor(projectId, {
                sortKey: z.string().parse(response.LastEvaluatedKey["sk"]),
              }),
            }
          : {}),
      };
    },
    async listEvents(projectId, groupId, query) {
      // Event records are queried from the group partition then project-filtered, so one project's API key cannot reveal another project's history.
      const parsedCursor = decodeCursor(query.cursor, projectId, groupId);
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: parsedCursor?.sortKey
            ? "pk = :pk AND sk > :start"
            : "pk = :pk AND begins_with(sk, :event)",
          ExpressionAttributeValues: {
            ":pk": eventPk(projectId, groupId),
            ...(parsedCursor?.sortKey
              ? { ":start": parsedCursor.sortKey }
              : { ":event": "EVENT#" }),
          },
          Limit: query.limit,
        }),
      );
      const response = output as { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> };
      const items = response.Items ?? [];
      return {
        items: items.map(eventFromItem),
        ...(response.LastEvaluatedKey
          ? {
              cursor: encodeCursor(projectId, {
                groupId,
                sortKey: z.string().parse(response.LastEvaluatedKey["sk"]),
              }),
            }
          : {}),
      };
    },
  };
}
