import type { QueryCommandOutput, TransactWriteCommandOutput } from "@aws-sdk/lib-dynamodb";
import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
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
  type ProjectMetadataItem,
} from "./model.js";

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
}

export interface ProjectDocumentClient {
  send(command: TransactWriteCommand): Promise<TransactWriteCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
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
}): ProjectRepository {
  const tableName = z.string().trim().min(1).parse(options.tableName);

  return {
    async create(project) {
      const metadata = toProjectMetadataItem(project);
      const utility = toEnabledUtilityItem(
        project.publicProjectId,
        project.fileManagement,
        project.createdAt,
        project.updatedAt,
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
  };
}
