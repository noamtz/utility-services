import type {
  GetCommandOutput,
  QueryCommandOutput,
  TransactGetCommandOutput,
  TransactWriteCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  QueryCommand,
  TransactGetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import {
  FILE_MANAGEMENT_SORT_KEY,
  PROJECT_METADATA_SORT_KEY,
  assembleProject,
  projectPartitionKey,
  type InternalProject,
} from "../projects/model.js";
import { createProjectApiKeyStartKey, type ApiKeyCursorPayload } from "./cursor.js";
import {
  API_KEY_LOOKUP_SORT_KEY,
  API_KEY_SORT_PREFIX,
  apiKeyLookupPartitionKey,
  assertCredentialRecordsMatch,
  parseApiKeyLookupItem,
  parseProjectApiKeyMetadataItem,
  projectApiKeySortKey,
  withReplacedStatus,
  withRevokedStatus,
  type ApiKeyLookupItem,
  type ProjectApiKeyMetadataItem,
} from "./model.js";

export interface ListApiKeysInput {
  readonly publicProjectId: string;
  readonly limit: number;
  readonly startAfter?: ApiKeyCursorPayload;
}

export interface ListApiKeysResult {
  readonly items: ProjectApiKeyMetadataItem[];
  readonly nextCursor?: ApiKeyCursorPayload;
}

export interface CredentialVerificationSnapshot {
  readonly lookup: ApiKeyLookupItem;
  readonly metadata: ProjectApiKeyMetadataItem;
  readonly project: InternalProject;
}

export interface CredentialRepository {
  inspectProject(publicProjectId: string): Promise<InternalProject | undefined>;
  inspectMetadata(
    publicProjectId: string,
    keyId: string,
  ): Promise<ProjectApiKeyMetadataItem | undefined>;
  list(input: ListApiKeysInput): Promise<ListApiKeysResult>;
  getLookup(keyId: string): Promise<ApiKeyLookupItem | undefined>;
  getVerificationSnapshot(
    keyId: string,
    publicProjectId: string,
  ): Promise<CredentialVerificationSnapshot | undefined>;
  issue(
    project: InternalProject,
    metadata: ProjectApiKeyMetadataItem,
    lookup: ApiKeyLookupItem,
  ): Promise<void>;
  revoke(
    metadata: ProjectApiKeyMetadataItem,
    timestamp: string,
  ): Promise<ProjectApiKeyMetadataItem>;
  replace(
    metadata: ProjectApiKeyMetadataItem,
    newMetadata: ProjectApiKeyMetadataItem,
    newLookup: ApiKeyLookupItem,
    timestamp: string,
  ): Promise<ProjectApiKeyMetadataItem>;
}

export interface CredentialDocumentClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: TransactGetCommand): Promise<TransactGetCommandOutput>;
  send(command: TransactWriteCommand): Promise<TransactWriteCommandOutput>;
}

export class CredentialCollisionError extends Error {
  public constructor() {
    super("Credential identifier collision");
    this.name = "CredentialCollisionError";
  }
}

export class CredentialStateConflictError extends Error {
  public constructor() {
    super("Credential state changed");
    this.name = "CredentialStateConflictError";
  }
}

export class CorruptCredentialRecordError extends Error {
  public constructor() {
    super("Stored credential record is incomplete or invalid");
    this.name = "CorruptCredentialRecordError";
  }
}

function cancellationReasons(error: unknown): ReadonlyArray<{ Code?: string }> | undefined {
  if (error === null || typeof error !== "object") return undefined;
  if (!("name" in error) || error.name !== "TransactionCanceledException") return undefined;
  if (!("CancellationReasons" in error) || !Array.isArray(error.CancellationReasons))
    return undefined;
  return error.CancellationReasons as ReadonlyArray<{ Code?: string }>;
}

function isConditionalFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const name = "name" in error ? error.name : undefined;
  return name === "TransactionCanceledException" || name === "ConditionalCheckFailedException";
}

function parseMetadataList(input: unknown, publicProjectId: string): ProjectApiKeyMetadataItem[] {
  try {
    return z
      .array(z.unknown())
      .parse(input ?? [])
      .map((item) => {
        const parsed = parseProjectApiKeyMetadataItem(item);
        if (parsed.publicProjectId !== publicProjectId) throw new CorruptCredentialRecordError();
        return parsed;
      });
  } catch (error) {
    if (error instanceof CorruptCredentialRecordError) throw error;
    throw new CorruptCredentialRecordError();
  }
}

function parseProjectPartition(itemsInput: unknown): InternalProject | undefined {
  const items = z.array(z.unknown()).parse(itemsInput ?? []);
  if (items.length === 0) return undefined;
  const metadata = items.find(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "sk" in item &&
      item.sk === PROJECT_METADATA_SORT_KEY,
  );
  const utility = items.find(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "sk" in item &&
      item.sk === FILE_MANAGEMENT_SORT_KEY,
  );
  if (!metadata || !utility) throw new CorruptCredentialRecordError();
  try {
    return assembleProject(metadata, utility);
  } catch {
    throw new CorruptCredentialRecordError();
  }
}

function updateStatusExpression(status: "revoked" | "replaced") {
  if (status === "revoked") {
    return "SET #status = :next, updatedAt = :updatedAt, revokedAt = :updatedAt";
  }
  return "SET #status = :next, updatedAt = :updatedAt, replacedAt = :updatedAt, replacementKeyId = :replacementKeyId";
}

export function createDynamoCredentialRepository(options: {
  readonly client: CredentialDocumentClient;
  readonly tableName: string;
}): CredentialRepository {
  const tableName = z.string().trim().min(1).parse(options.tableName);

  return {
    async inspectProject(publicProjectId) {
      const output = await options.client.send(
        new TransactGetCommand({
          TransactItems: [
            {
              Get: {
                TableName: tableName,
                Key: {
                  pk: projectPartitionKey(publicProjectId),
                  sk: PROJECT_METADATA_SORT_KEY,
                },
              },
            },
            {
              Get: {
                TableName: tableName,
                Key: {
                  pk: projectPartitionKey(publicProjectId),
                  sk: FILE_MANAGEMENT_SORT_KEY,
                },
              },
            },
          ],
        }),
      );
      return parseProjectPartition(output.Responses?.map((response) => response.Item));
    },

    async inspectMetadata(publicProjectId, keyId) {
      const output = await options.client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: projectPartitionKey(publicProjectId), sk: projectApiKeySortKey(keyId) },
          ConsistentRead: true,
        }),
      );
      if (!output.Item) return undefined;
      try {
        const item = parseProjectApiKeyMetadataItem(output.Item);
        if (item.publicProjectId !== publicProjectId || item.keyId !== keyId) {
          throw new CorruptCredentialRecordError();
        }
        return item;
      } catch (error) {
        if (error instanceof CorruptCredentialRecordError) throw error;
        throw new CorruptCredentialRecordError();
      }
    },

    async list(input) {
      const limit = z.number().int().min(1).max(50).parse(input.limit);
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :project AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: {
            ":project": projectPartitionKey(input.publicProjectId),
            ":prefix": API_KEY_SORT_PREFIX,
          },
          ConsistentRead: true,
          Limit: limit,
          ...(input.startAfter
            ? {
                ExclusiveStartKey: createProjectApiKeyStartKey(
                  input.publicProjectId,
                  input.startAfter,
                ),
              }
            : {}),
        }),
      );
      const items = parseMetadataList(output.Items, input.publicProjectId);
      if (output.LastEvaluatedKey && items.length === 0) throw new CorruptCredentialRecordError();
      const last = output.LastEvaluatedKey ? items.at(-1) : undefined;
      return { items, ...(last ? { nextCursor: { keyId: last.keyId } } : {}) };
    },

    async getLookup(keyId) {
      const output = await options.client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: apiKeyLookupPartitionKey(keyId), sk: API_KEY_LOOKUP_SORT_KEY },
          ConsistentRead: true,
        }),
      );
      if (!output.Item) return undefined;
      try {
        const item = parseApiKeyLookupItem(output.Item);
        if (item.keyId !== keyId) throw new CorruptCredentialRecordError();
        return item;
      } catch (error) {
        if (error instanceof CorruptCredentialRecordError) throw error;
        throw new CorruptCredentialRecordError();
      }
    },

    async getVerificationSnapshot(keyId, publicProjectId) {
      const output = await options.client.send(
        new TransactGetCommand({
          TransactItems: [
            {
              Get: {
                TableName: tableName,
                Key: { pk: apiKeyLookupPartitionKey(keyId), sk: API_KEY_LOOKUP_SORT_KEY },
              },
            },
            {
              Get: {
                TableName: tableName,
                Key: { pk: projectPartitionKey(publicProjectId), sk: projectApiKeySortKey(keyId) },
              },
            },
            {
              Get: {
                TableName: tableName,
                Key: { pk: projectPartitionKey(publicProjectId), sk: PROJECT_METADATA_SORT_KEY },
              },
            },
            {
              Get: {
                TableName: tableName,
                Key: { pk: projectPartitionKey(publicProjectId), sk: FILE_MANAGEMENT_SORT_KEY },
              },
            },
          ],
        }),
      );
      const items = output.Responses?.map((response) => response.Item) ?? [];
      if (items.length !== 4 || items.some((item) => item === undefined)) return undefined;
      try {
        const records = assertCredentialRecordsMatch(items[1], items[0]);
        const project = assembleProject(items[2], items[3]);
        if (
          records.lookup.keyId !== keyId ||
          records.lookup.publicProjectId !== publicProjectId ||
          records.lookup.internalProjectId !== project.internalProjectId ||
          records.lookup.publicProjectId !== project.publicProjectId
        ) {
          throw new CorruptCredentialRecordError();
        }
        return Object.freeze({ ...records, project });
      } catch (error) {
        if (error instanceof CorruptCredentialRecordError) throw error;
        throw new CorruptCredentialRecordError();
      }
    },

    async issue(project, metadata, lookup) {
      assertCredentialRecordsMatch(metadata, lookup);
      if (
        metadata.internalProjectId !== project.internalProjectId ||
        metadata.publicProjectId !== project.publicProjectId ||
        project.ownerId.length === 0
      ) {
        throw new CredentialStateConflictError();
      }
      try {
        await options.client.send(
          new TransactWriteCommand({
            ClientRequestToken: `issue:${metadata.keyId}`,
            TransactItems: [
              {
                ConditionCheck: {
                  TableName: tableName,
                  Key: {
                    pk: projectPartitionKey(project.publicProjectId),
                    sk: PROJECT_METADATA_SORT_KEY,
                  },
                  ConditionExpression: "internalProjectId = :internal AND ownerId = :owner",
                  ExpressionAttributeValues: {
                    ":internal": project.internalProjectId,
                    ":owner": project.ownerId,
                  },
                },
              },
              {
                ConditionCheck: {
                  TableName: tableName,
                  Key: {
                    pk: projectPartitionKey(project.publicProjectId),
                    sk: FILE_MANAGEMENT_SORT_KEY,
                  },
                  ConditionExpression: "attribute_exists(pk) AND utility = :utility",
                  ExpressionAttributeValues: { ":utility": "file-management" },
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: metadata,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: lookup,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
            ],
          }),
        );
      } catch (error) {
        const reasons = cancellationReasons(error);
        const projectConditionFailed = reasons
          ?.slice(0, 2)
          .some((reason) => reason.Code === "ConditionalCheckFailed");
        if (
          !projectConditionFailed &&
          reasons?.slice(2).some((reason) => reason.Code === "ConditionalCheckFailed")
        ) {
          throw new CredentialCollisionError();
        }
        if (isConditionalFailure(error)) throw new CredentialStateConflictError();
        throw error;
      }
    },

    async revoke(metadata, timestamp) {
      if (metadata.status === "revoked" || metadata.status === "replaced") return metadata;
      const updated = withRevokedStatus(metadata, timestamp);
      const values = {
        ":active": "active",
        ":suspended": "suspended",
        ":next": "revoked",
        ":updatedAt": timestamp,
        ":internal": metadata.internalProjectId,
        ":project": metadata.publicProjectId,
      };
      try {
        await options.client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: metadata.pk, sk: metadata.sk },
                  UpdateExpression: updateStatusExpression("revoked"),
                  ConditionExpression:
                    "(#status = :active OR #status = :suspended) AND internalProjectId = :internal AND publicProjectId = :project",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: values,
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: {
                    pk: apiKeyLookupPartitionKey(metadata.keyId),
                    sk: API_KEY_LOOKUP_SORT_KEY,
                  },
                  UpdateExpression: updateStatusExpression("revoked"),
                  ConditionExpression:
                    "(#status = :active OR #status = :suspended) AND internalProjectId = :internal AND publicProjectId = :project",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: values,
                },
              },
            ],
          }),
        );
        return updated;
      } catch (error) {
        if (isConditionalFailure(error)) throw new CredentialStateConflictError();
        throw error;
      }
    },

    async replace(metadata, newMetadata, newLookup, timestamp) {
      assertCredentialRecordsMatch(newMetadata, newLookup);
      if (
        newMetadata.publicProjectId !== metadata.publicProjectId ||
        newMetadata.internalProjectId !== metadata.internalProjectId
      ) {
        throw new CredentialStateConflictError();
      }
      const updated = withReplacedStatus(metadata, timestamp, newMetadata.keyId);
      const values = {
        ":active": "active",
        ":suspended": "suspended",
        ":next": "replaced",
        ":updatedAt": timestamp,
        ":replacementKeyId": newMetadata.keyId,
        ":internal": metadata.internalProjectId,
        ":project": metadata.publicProjectId,
      };
      try {
        await options.client.send(
          new TransactWriteCommand({
            ClientRequestToken: `repl:${newMetadata.keyId}`,
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: metadata.pk, sk: metadata.sk },
                  UpdateExpression: updateStatusExpression("replaced"),
                  ConditionExpression:
                    "(#status = :active OR #status = :suspended) AND internalProjectId = :internal AND publicProjectId = :project",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: values,
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: {
                    pk: apiKeyLookupPartitionKey(metadata.keyId),
                    sk: API_KEY_LOOKUP_SORT_KEY,
                  },
                  UpdateExpression: updateStatusExpression("replaced"),
                  ConditionExpression:
                    "(#status = :active OR #status = :suspended) AND internalProjectId = :internal AND publicProjectId = :project",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: values,
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: newMetadata,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: newLookup,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
            ],
          }),
        );
        return updated;
      } catch (error) {
        const reasons = cancellationReasons(error);
        const currentConditionFailed = reasons
          ?.slice(0, 2)
          .some((reason) => reason.Code === "ConditionalCheckFailed");
        if (
          !currentConditionFailed &&
          reasons?.slice(2).some((reason) => reason.Code === "ConditionalCheckFailed")
        ) {
          throw new CredentialCollisionError();
        }
        if (isConditionalFailure(error)) throw new CredentialStateConflictError();
        throw error;
      }
    },
  };
}
