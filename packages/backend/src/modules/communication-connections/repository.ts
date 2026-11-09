import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { ConnectionIdSchema, CommunicationConnectionSchema, ProviderInstanceIdSchema } from "@utility-services/contracts";

import { DuplicateProviderInstanceError, type ConnectionRecord, type ConnectionRepository } from "./service.js";

const metadataKey = (connectionId: string) => `CONNECTION#${ConnectionIdSchema.parse(connectionId)}`;
const instanceKey = (instanceId: string) => `PROVIDER#green-api#INSTANCE#${ProviderInstanceIdSchema.parse(instanceId)}`;

const StoredConnectionSchema = CommunicationConnectionSchema.extend({
  pk: z.string().startsWith("CONNECTION#"),
  sk: z.literal("METADATA"),
  itemType: z.literal("communication-connection"),
  ownerId: z.string().min(1),
  secretReference: z.string().min(1),
  secretVersion: z.number().int().positive(),
}).strict();

function isConditionalFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error.name === "TransactionCanceledException" || error.name === "ConditionalCheckFailedException");
}

export function createDynamoConnectionRepository(options: {
  readonly client: { send(command: TransactWriteCommand | GetCommand): Promise<unknown> };
  readonly tableName: string;
}): ConnectionRepository {
  const tableName = z.string().min(1).parse(options.tableName);
  return {
    async reserveAndCreate(record) {
      const stored = StoredConnectionSchema.parse({ ...record, pk: metadataKey(record.connectionId), sk: "METADATA", itemType: "communication-connection" });
      try {
        await options.client.send(new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: tableName, Item: stored, ConditionExpression: "attribute_not_exists(pk)" } },
            { Put: { TableName: tableName, Item: { pk: instanceKey(record.instanceId), sk: "RESERVATION", itemType: "provider-instance-reservation", connectionId: record.connectionId }, ConditionExpression: "attribute_not_exists(pk)" } },
          ],
        }));
      } catch (error) {
        if (isConditionalFailure(error)) throw new DuplicateProviderInstanceError();
        throw error;
      }
    },
    async inspect(connectionId) {
      const output = await options.client.send(
        new GetCommand({ TableName: tableName, Key: { pk: metadataKey(connectionId), sk: "METADATA" } }),
      );
      const item = (output as { Item?: unknown }).Item;
      return item === undefined ? undefined : StoredConnectionSchema.parse(item);
    },
  };
}
