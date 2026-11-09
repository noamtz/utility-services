import type {
  QueryCommandOutput,
  TransactWriteCommandOutput,
  UpdateCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { createOwnerIndexStartKey, type ProjectCursorPayload } from "./cursor.js";
import {
  FILE_MANAGEMENT_SORT_KEY,
  OWNER_INDEX_NAME,
  PROJECT_METADATA_SORT_KEY,
  assembleProject,
  ownerPartitionKey,
  parseProjectMetadataItem,
  projectPartitionKey,
  toEnabledUtilityItem,
  toProjectMetadataItem,
  type InternalProject,
  ProjectOperationalStatusSchema,
  type ProjectMetadataItem,
} from "./model.js";

type ProjectOperationalStatus = z.infer<typeof ProjectOperationalStatusSchema>;

export interface ListProjectsInput {
  readonly ownerId: string;
  readonly limit: number;
  readonly startAfter?: ProjectCursorPayload;
}

export interface ListProjectsResult {
  readonly items: ProjectMetadataItem[];
  readonly nextCursor?: ProjectCursorPayload;
}

export interface ProjectRepository {
  create(project: InternalProject): Promise<void>;
  list(input: ListProjectsInput): Promise<ListProjectsResult>;
  inspect(publicProjectId: string): Promise<InternalProject | undefined>;
  updateFileManagementPolicy(
    project: InternalProject,
    settings: { storageQuotaBytes: number; trashRetentionDays: number },
    changedAt: string,
  ): Promise<void>;
  setOperationalStatus(
    publicProjectId: string,
    expectedStatus: ProjectOperationalStatus,
    nextStatus: ProjectOperationalStatus,
    changedAt: string,
  ): Promise<void>;
}

export interface ProjectDocumentClient {
  send(command: TransactWriteCommand): Promise<TransactWriteCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
}

export class ProjectCollisionError extends Error {
  public constructor() {
    super("Project identifier collision");
    this.name = "ProjectCollisionError";
  }
}

export class CorruptProjectRecordError extends Error {
  public constructor() {
    super("Stored project record is incomplete or invalid");
    this.name = "CorruptProjectRecordError";
  }
}

export class ProjectStateConflictError extends Error {
  public constructor() {
    super("Project operational state changed concurrently");
    this.name = "ProjectStateConflictError";
  }
}

export class StorageQuotaBelowAccountedError extends Error {
  public constructor() {
    super("Storage quota is below accounted bytes");
    this.name = "StorageQuotaBelowAccountedError";
  }
}

function isConditionalFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? error.name : undefined;
  return name === "TransactionCanceledException" || name === "ConditionalCheckFailedException";
}

function parseMetadataItems(items: unknown, expectedOwnerId: string): ProjectMetadataItem[] {
  const array = z.array(z.unknown()).parse(items ?? []);
  try {
    return array.map((item) => {
      const parsed = parseProjectMetadataItem(item);
      if (
        parsed.ownerId !== expectedOwnerId ||
        parsed.gsi1pk !== ownerPartitionKey(expectedOwnerId)
      ) {
        throw new CorruptProjectRecordError();
      }
      return parsed;
    });
  } catch (error) {
    if (error instanceof CorruptProjectRecordError) {
      throw error;
    }
    throw new CorruptProjectRecordError();
  }
}

export function createDynamoProjectRepository(options: {
  readonly client: ProjectDocumentClient;
  readonly tableName: string;
  readonly fileTableName?: string;
}): ProjectRepository {
  const tableName = z.string().trim().min(1).parse(options.tableName);
  const fileTableName = options.fileTableName
    ? z.string().trim().min(1).parse(options.fileTableName)
    : undefined;

  return {
    async create(project) {
      const metadata = toProjectMetadataItem(project);
      const utility = toEnabledUtilityItem(
        project.publicProjectId,
        project.fileManagement,
        project.createdAt,
        project.updatedAt,
        project.fileManagementPolicyVersion,
      );

      try {
        await options.client.send(
          new TransactWriteCommand({
            TransactItems: [
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
                  Item: utility,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (isConditionalFailure(error)) {
          throw new ProjectCollisionError();
        }
        throw error;
      }
    },

    async list(input) {
      const limit = z.number().int().min(1).max(50).parse(input.limit);
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: OWNER_INDEX_NAME,
          KeyConditionExpression: "gsi1pk = :owner",
          ExpressionAttributeValues: { ":owner": ownerPartitionKey(input.ownerId) },
          ScanIndexForward: false,
          Limit: limit,
          ...(input.startAfter
            ? { ExclusiveStartKey: createOwnerIndexStartKey(input.ownerId, input.startAfter) }
            : {}),
        }),
      );

      const items = parseMetadataItems(output.Items, input.ownerId);
      if (output.LastEvaluatedKey && items.length === 0) {
        throw new CorruptProjectRecordError();
      }
      const last = output.LastEvaluatedKey ? items.at(-1) : undefined;
      return {
        items,
        ...(last
          ? { nextCursor: { projectId: last.publicProjectId, createdAt: last.createdAt } }
          : {}),
      };
    },

    async inspect(publicProjectId) {
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :project",
          ExpressionAttributeValues: { ":project": projectPartitionKey(publicProjectId) },
          ConsistentRead: true,
        }),
      );

      const items = z.array(z.unknown()).parse(output.Items ?? []);
      if (items.length === 0) {
        return undefined;
      }

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
      if (!metadata || !utility) {
        throw new CorruptProjectRecordError();
      }

      try {
        return assembleProject(metadata, utility);
      } catch {
        throw new CorruptProjectRecordError();
      }
    },

    async updateFileManagementPolicy(project, settings, changedAt) {
      if (!fileTableName) {
        throw new Error("File table is required for policy updates");
      }
      const timestamp = z.iso.datetime({ offset: true }).parse(changedAt);
      const quota = z.number().int().positive().safe().parse(settings.storageQuotaBytes);
      const days = z.number().int().positive().safe().parse(settings.trashRetentionDays);
      try {
        await options.client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                ConditionCheck: {
                  TableName: fileTableName,
                  Key: { pk: `PROJECT#${project.internalProjectId}`, sk: "QUOTA" },
                  ConditionExpression:
                    "attribute_not_exists(pk) OR (itemType = :quotaType AND internalProjectId = :internal AND accountedBytes <= :limit)",
                  ExpressionAttributeValues: {
                    ":quotaType": "file-quota",
                    ":internal": project.internalProjectId,
                    ":limit": BigInt(quota),
                  },
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: {
                    pk: projectPartitionKey(project.publicProjectId),
                    sk: FILE_MANAGEMENT_SORT_KEY,
                  },
                  UpdateExpression:
                    "SET storageQuotaBytes = :limit, trashRetentionDays = :days, fileManagementPolicyVersion = :nextVersion, updatedAt = :changedAt",
                  ConditionExpression:
                    "attribute_exists(pk) AND itemType = :utilityType AND utility = :utility AND (attribute_not_exists(fileManagementPolicyVersion) OR fileManagementPolicyVersion = :expectedVersion)",
                  ExpressionAttributeValues: {
                    ":limit": quota,
                    ":days": days,
                    ":nextVersion": project.fileManagementPolicyVersion + 1,
                    ":expectedVersion": project.fileManagementPolicyVersion,
                    ":utilityType": "enabled-utility",
                    ":utility": "file-management",
                    ":changedAt": timestamp,
                  },
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (isConditionalFailure(error)) {
          const reasons =
            error && typeof error === "object" && "CancellationReasons" in error
              ? error.CancellationReasons
              : undefined;
          if (
            Array.isArray(reasons) &&
            (reasons as ReadonlyArray<{ Code?: string }>)[0]?.Code === "ConditionalCheckFailed"
          ) {
            throw new StorageQuotaBelowAccountedError();
          }
          throw new ProjectStateConflictError();
        }
        throw error;
      }
    },

    async setOperationalStatus(publicProjectId, expectedStatus, nextStatus, changedAt) {
      const parsedExpected = ProjectOperationalStatusSchema.parse(expectedStatus);
      const parsedNext = ProjectOperationalStatusSchema.parse(nextStatus);
      const timestamp = z.iso.datetime({ offset: true }).parse(changedAt);
      const legacyActiveCondition =
        parsedExpected === "active" ? " OR attribute_not_exists(#status)" : "";

      try {
        await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: {
              pk: projectPartitionKey(publicProjectId),
              sk: PROJECT_METADATA_SORT_KEY,
            },
            UpdateExpression: "SET #status = :next, updatedAt = :changedAt",
            ConditionExpression: `attribute_exists(pk) AND itemType = :type AND (#status = :expected${legacyActiveCondition})`,
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":type": "project-metadata",
              ":expected": parsedExpected,
              ":next": parsedNext,
              ":changedAt": timestamp,
            },
          }),
        );
      } catch (error) {
        if (isConditionalFailure(error)) {
          throw new ProjectStateConflictError();
        }
        throw error;
      }
    },
  };
}
