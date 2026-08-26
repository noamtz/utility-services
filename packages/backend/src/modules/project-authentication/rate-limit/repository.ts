import type { UpdateCommandOutput } from "@aws-sdk/lib-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { PROJECT_CONTROL_REQUEST_LIMIT, type ProjectRateLimitWindow } from "./model.js";

export interface RateLimitDocumentClient {
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
}

export interface ProjectRateLimitRepository {
  admit(window: ProjectRateLimitWindow): Promise<"admitted" | "limited">;
}

function isConditionalFailure(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ConditionalCheckFailedException"
  );
}

export function createDynamoProjectRateLimitRepository(options: {
  readonly client: RateLimitDocumentClient;
  readonly tableName: string;
}): ProjectRateLimitRepository {
  const tableName = z.string().trim().min(1).parse(options.tableName);
  const repository: ProjectRateLimitRepository = Object.freeze({
    async admit(window: ProjectRateLimitWindow) {
      try {
        await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: window.pk, sk: window.sk },
            UpdateExpression:
              "SET itemType = if_not_exists(itemType, :type), internalProjectId = if_not_exists(internalProjectId, :project), windowMinute = if_not_exists(windowMinute, :minute), expiresAt = :expiresAt, requestCount = if_not_exists(requestCount, :zero) + :one",
            ConditionExpression:
              "(attribute_not_exists(requestCount) OR requestCount < :limit) AND (attribute_not_exists(internalProjectId) OR internalProjectId = :project)",
            ExpressionAttributeValues: {
              ":type": "project-rate-limit",
              ":project": window.internalProjectId,
              ":minute": window.windowMinute,
              ":expiresAt": window.expiresAt,
              ":zero": 0,
              ":one": 1,
              ":limit": PROJECT_CONTROL_REQUEST_LIMIT,
            },
          }),
        );
        return "admitted";
      } catch (error) {
        if (isConditionalFailure(error)) return "limited";
        throw error;
      }
    },
  });
  return repository;
}
