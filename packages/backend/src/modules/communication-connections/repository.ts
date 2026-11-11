import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import {
  ConnectionIdSchema,
  CommunicationConnectionSchema,
  PublicProjectIdSchema,
  ProviderInstanceIdSchema,
} from "@utility-services/contracts";

import {
  DuplicateProviderInstanceError,
  ProjectCommunicationAlreadyBoundError,
  type ConnectionRepository,
} from "./service.js";

const metadataKey = (connectionId: string) =>
  `CONNECTION#${ConnectionIdSchema.parse(connectionId)}`;
const instanceKey = (instanceId: string) =>
  `PROVIDER#green-api#INSTANCE#${ProviderInstanceIdSchema.parse(instanceId)}`;
/** Isolated MVP policy record; future multi-connection support can replace this reservation only. */
const projectConnectionKey = (projectId: string) =>
  `PROJECT#${PublicProjectIdSchema.parse(projectId)}#COMMUNICATION`;

const StoredConnectionSchema = CommunicationConnectionSchema.extend({
  pk: z.string().startsWith("CONNECTION#"),
  sk: z.literal("METADATA"),
  itemType: z.literal("communication-connection"),
  ownerId: z.string().min(1),
  secretReference: z.string().min(1),
  secretVersion: z.number().int().positive(),
  webhookSecretHash: z.string().min(1).optional(),
}).strict();

function isConditionalFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "TransactionCanceledException" ||
      error.name === "ConditionalCheckFailedException")
  );
}

function projectReservationFailed(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("CancellationReasons" in error))
    return false;
  const reasons: unknown = error.CancellationReasons;
  if (!Array.isArray(reasons)) return false;
  const projectReason: unknown = reasons[1];
  if (typeof projectReason !== "object" || projectReason === null || !("Code" in projectReason))
    return false;
  return projectReason.Code === "ConditionalCheckFailed";
}

export function createDynamoConnectionRepository(options: {
  readonly client: {
    send(
      command: TransactWriteCommand | GetCommand | QueryCommand | UpdateCommand,
    ): Promise<unknown>;
  };
  readonly tableName: string;
}): ConnectionRepository {
  const tableName = z.string().min(1).parse(options.tableName);
  return {
    async reserveAndCreate(record) {
      const stored = StoredConnectionSchema.parse({
        ...record,
        projectId: record.projectId,
        pk: metadataKey(record.connectionId),
        sk: "METADATA",
        itemType: "communication-connection",
      });
      try {
        await options.client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tableName,
                  Item: stored,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: {
                    pk: projectConnectionKey(record.projectId),
                    sk: "RESERVATION",
                    itemType: "project-communication-connection-reservation",
                    connectionId: record.connectionId,
                  },
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: {
                    pk: instanceKey(record.instanceId),
                    sk: "RESERVATION",
                    itemType: "provider-instance-reservation",
                    connectionId: record.connectionId,
                  },
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (projectReservationFailed(error)) throw new ProjectCommunicationAlreadyBoundError();
        if (isConditionalFailure(error)) throw new DuplicateProviderInstanceError();
        throw error;
      }
    },
    async inspect(connectionId) {
      const output = await options.client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: metadataKey(connectionId), sk: "METADATA" },
        }),
      );
      const item = (output as { Item?: unknown }).Item;
      return item === undefined ? undefined : StoredConnectionSchema.parse(item);
    },
    async updateLifecycle(connectionId, expectedVersion, patch) {
      try {
        await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: metadataKey(connectionId), sk: "METADATA" },
            UpdateExpression:
              "SET secretReference = :secretReference, secretVersion = :secretVersion, #status = :status, updatedAt = :updatedAt",
            ConditionExpression: "attribute_exists(pk) AND secretVersion = :expectedVersion",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":secretReference": patch.secretReference,
              ":secretVersion": patch.secretVersion,
              ":status": patch.status,
              ":updatedAt": patch.updatedAt,
              ":expectedVersion": expectedVersion,
            },
          }),
        );
      } catch (error) {
        if (isConditionalFailure(error)) throw new DuplicateProviderInstanceError();
        throw error;
      }
    },
    async updateWebhookSecret(connectionId, webhookSecretHash, updatedAt) {
      await options.client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: metadataKey(connectionId), sk: "METADATA" },
          UpdateExpression: "SET webhookSecretHash = :webhookSecretHash, updatedAt = :updatedAt",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: {
            ":webhookSecretHash": webhookSecretHash,
            ":updatedAt": updatedAt,
          },
        }),
      );
    },
    async listForProject(projectId) {
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "projectId-index",
          KeyConditionExpression: "projectId = :projectId",
          ExpressionAttributeValues: { ":projectId": projectId },
        }),
      );
      return z.array(StoredConnectionSchema).parse((output as { Items?: unknown }).Items ?? []);
    },
  };
}
