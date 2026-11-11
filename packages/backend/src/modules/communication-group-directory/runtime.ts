import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Resource } from "sst";
import { z } from "zod";
import { safeLogger } from "../../core/observability/powertools.js";
import { createProjectAuthenticationRuntime } from "../project-authentication/runtime.js";
import { createListGroupEventsHandler, createListGroupsHandler } from "./handlers.js";
import { discoverGroups } from "./provider.js";
import { createDynamoGroupDirectoryRepository } from "./repository.js";
import { createGroupDirectoryService } from "./service.js";

const resources = Resource as unknown as {
  CommunicationConnectionsTable: { name: unknown };
  ControlTable: { name: unknown };
};
const communicationTableName = z
  .string()
  .min(1)
  .parse(resources.CommunicationConnectionsTable.name);
const controlTableName = z.string().min(1).parse(resources.ControlTable.name);
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const repository = createDynamoGroupDirectoryRepository({
  client,
  tableName: communicationTableName,
});
const authentication = createProjectAuthenticationRuntime({
  tableName: controlTableName,
  documentClient: client,
});
const service = createGroupDirectoryService(repository);
export const listGroupsHandler = createListGroupsHandler(service, authentication, safeLogger);
export const listGroupEventsHandler = createListGroupEventsHandler(
  service,
  authentication,
  safeLogger,
);

function greenProvider(instanceId: string, credential: string) {
  const request = async (path: string) => {
    const response = await fetch(
      `https://api.green-api.com/waInstance${encodeURIComponent(instanceId)}/${path}/${encodeURIComponent(credential)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw new Error("GREEN_API_REQUEST_FAILED");
    return response.json();
  };
  return {
    getChats: () => request("getChats"),
    getGroupData: (groupId: string) => request(`getGroupData/${encodeURIComponent(groupId)}`),
  };
}

export async function refreshGroupDirectory(): Promise<void> {
  const active = await client.send(
    new QueryCommand({
      TableName: communicationTableName,
      IndexName: "activeConnection-index",
      KeyConditionExpression: "activeConnection = :active",
      ExpressionAttributeValues: { ":active": "ACTIVE" },
    }),
  );
  const connections = z
    .array(
      z.object({
        connectionId: z.string(),
        projectId: z.string().uuid(),
        instanceId: z.string(),
        secretReference: z.string(),
        status: z.literal("active"),
      }),
    )
    .parse((active as { Items?: unknown }).Items ?? []);
  const ssm = new SSMClient({});
  for (const connection of connections) {
    if (!repository.allocateScan) throw new Error("Directory scan allocator is unavailable");
    const sequence = await repository.allocateScan(connection.connectionId);
    const secret = await ssm.send(
      new GetParameterCommand({ Name: connection.secretReference, WithDecryption: true }),
    );
    const credential = z.string().min(16).parse(secret.Parameter?.Value);
    const scan = await discoverGroups(greenProvider(connection.instanceId, credential));
    await service.applySnapshot({
      connectionId: connection.connectionId,
      projectId: connection.projectId,
      scanId: crypto.randomUUID(),
      sequence,
      observedAt: new Date().toISOString(),
      complete: scan.complete,
      groups: scan.groups,
    });
  }
}
