import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { IncomingTextMessage } from "@utility-services/contracts";
import type { ConnectionRecord } from "../communication-connections/service.js";
import type { MessageRepository } from "./service.js";
import { HttpError } from "../../core/http/handler.js";

const messagePk = (project: string, connection: string, conversation: string) =>
  `PROJECT#${project}#CONNECTION#${connection}#CONVERSATION#${conversation}`;
const sourcePk = (connection: string, source: string) =>
  `CONNECTION#${connection}#SOURCE#${source}`;
function cursorKey(
  cursor: string | undefined,
  expectedPk: string,
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const key = parsed as Record<string, unknown>;
    if (
      key["pk"] !== expectedPk ||
      typeof key["sk"] !== "string" ||
      !key["sk"].startsWith("MESSAGE#")
    )
      throw new Error();
    return key;
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Request validation failed");
  }
}
function isSourceDuplicate(error: unknown): boolean {
  if (
    !error ||
    typeof error !== "object" ||
    !("name" in error) ||
    error.name !== "TransactionCanceledException" ||
    !("CancellationReasons" in error) ||
    !Array.isArray(error.CancellationReasons)
  )
    return false;
  const reason: unknown = error.CancellationReasons[1];
  return (
    !!reason &&
    typeof reason === "object" &&
    "Code" in reason &&
    reason.Code === "ConditionalCheckFailed"
  );
}
export function createDynamoMessageRepository(options: {
  client: { send(command: QueryCommand | TransactWriteCommand): Promise<unknown> };
  tableName: string;
}): MessageRepository {
  return {
    async persist(message: IncomingTextMessage, connection: ConnectionRecord) {
      const pk = messagePk(connection.projectId, message.connectionId, message.conversationId);
      const item = {
        ...message,
        pk,
        sk: `MESSAGE#${message.receivedAt}#${message.providerMessageId}`,
        itemType: "communication-message",
      };
      try {
        await options.client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: options.tableName,
                  Item: item,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Put: {
                  TableName: options.tableName,
                  Item: {
                    pk: sourcePk(message.connectionId, message.providerMessageId),
                    sk: "DEDUP",
                    itemType: "communication-message-dedup",
                  },
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Update: {
                  TableName: options.tableName,
                  Key: { pk, sk: "OBSERVATION" },
                  UpdateExpression:
                    "SET itemType = :itemType, knownRecordStartedAt = if_not_exists(knownRecordStartedAt, :receivedAt)",
                  ExpressionAttributeValues: {
                    ":itemType": "communication-observation",
                    ":receivedAt": message.receiptAt,
                  },
                },
              },
            ],
          }),
        );
        return "created";
      } catch (error) {
        if (isSourceDuplicate(error)) return "duplicate";
        throw error;
      }
    },
    async list(input) {
      const partitionKey = messagePk(
        input.internalProjectId,
        input.connectionId,
        input.conversationId,
      );
      const startKey = cursorKey(input.cursor, partitionKey);
      const output = await options.client.send(
        new QueryCommand({
          TableName: options.tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: {
            ":pk": partitionKey,
            ":prefix": "MESSAGE#",
          },
          ScanIndexForward: false,
          Limit: input.limit,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }),
      );
      const result = output as { Items?: IncomingTextMessage[]; LastEvaluatedKey?: unknown };
      const observation = await options.client.send(
        new QueryCommand({
          TableName: options.tableName,
          KeyConditionExpression: "pk = :pk AND sk = :sk",
          ExpressionAttributeValues: {
            ":pk": partitionKey,
            ":sk": "OBSERVATION",
          },
          Limit: 1,
        }),
      );
      const observationItem = (observation as { Items?: Array<{ knownRecordStartedAt?: unknown }> })
        .Items?.[0];
      const watermark = result.Items?.[0]?.receiptAt;
      return {
        items: result.Items ?? [],
        ...(result.LastEvaluatedKey
          ? {
              nextCursor: Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString(
                "base64url",
              ),
            }
          : {}),
        ...(typeof observationItem?.knownRecordStartedAt === "string"
          ? { knownRecordStartedAt: observationItem.knownRecordStartedAt }
          : {}),
        ...(watermark ? { watermark } : {}),
      };
    },
  };
}
