// @ts-nocheck -- operator inputs are runtime-validated and behavior is covered by focused tests.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { ApiKeyIdSchema, PublicProjectIdSchema } from "@utility-services/contracts";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Resource } from "sst";
import { z } from "zod";

const StatusSchema = z.enum(["active", "suspended"]);
const ActionSchema = z.enum(["suspend", "resume"]);
const TargetSchema = z.enum(["project", "key"]);

function readFlags(argv) {
  const flags = new Map();
  const booleans = new Set(["--apply"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (booleans.has(argument)) {
      flags.set(argument, true);
      continue;
    }
    if (!argument?.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`Invalid operator argument "${argument ?? ""}".`);
    }
    if (flags.has(argument)) throw new Error(`Duplicate operator argument "${argument}".`);
    flags.set(argument, argv[index + 1]);
    index += 1;
  }
  return flags;
}

export function parseSuspensionArguments(argv) {
  const flags = readFlags(argv);
  const allowed = new Set([
    "--stage-name",
    "--target",
    "--project-id",
    "--key-id",
    "--action",
    "--apply",
    "--confirm",
  ]);
  for (const key of flags.keys())
    if (!allowed.has(key)) throw new Error(`Unknown option "${key}".`);
  const stage = z
    .string()
    .regex(/^(?:dev|pr)-[a-z0-9][a-z0-9-]*$|^production$/u)
    .parse(flags.get("--stage-name"));
  const target = TargetSchema.parse(flags.get("--target"));
  const projectId = PublicProjectIdSchema.parse(flags.get("--project-id"));
  const keyId = flags.has("--key-id") ? ApiKeyIdSchema.parse(flags.get("--key-id")) : undefined;
  if (target === "key" && !keyId) throw new Error("--key-id is required for a key target.");
  if (target === "project" && keyId) throw new Error("--key-id is valid only for a key target.");
  const action = ActionSchema.parse(flags.get("--action"));
  const apply = flags.get("--apply") === true;
  const expectedConfirmation = `APPLY:${stage}:${target}:${action}`;
  if (apply && flags.get("--confirm") !== expectedConfirmation) {
    throw new Error(`Mutation requires --confirm ${expectedConfirmation}.`);
  }
  if (!apply && flags.has("--confirm")) throw new Error("--confirm is valid only with --apply.");
  return Object.freeze({ stage, target, projectId, ...(keyId ? { keyId } : {}), action, apply });
}

function desiredStatus(action) {
  return action === "suspend" ? "suspended" : "active";
}

export async function executeSuspension(
  argv,
  operations,
  write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
) {
  const input = parseSuspensionArguments(argv);
  const current =
    input.target === "project"
      ? await operations.inspectProject(input.projectId)
      : await operations.inspectKey(input.projectId, input.keyId);
  if (!current) throw new Error("Suspension target not found.");
  if (current.status !== "active" && current.status !== "suspended") {
    throw new Error("Terminal credential state cannot be changed.");
  }
  const status = desiredStatus(input.action);
  const changed = current.status !== status;
  if (input.apply && changed) {
    if (input.target === "project") {
      await operations.setProjectStatus(input.projectId, current.status, status);
    } else {
      await operations.setKeyStatus(input.projectId, input.keyId, current.status, status);
    }
  }
  const result = Object.freeze({
    stage: input.stage,
    target: input.target,
    projectId: input.projectId,
    ...(input.keyId ? { keyId: input.keyId } : {}),
    previousStatus: current.status,
    status,
    changed,
    applied: input.apply && changed,
  });
  write(result);
  return result;
}

function createOperations(tableName) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const metadataKey = (projectId) => ({ pk: `PROJECT#${projectId}`, sk: "METADATA" });
  const credentialKey = (projectId, keyId) => ({
    pk: `PROJECT#${projectId}`,
    sk: `API_KEY#${keyId}`,
  });
  async function inspect(key, expectedType) {
    const output = await client.send(
      new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }),
    );
    if (!output.Item) return undefined;
    if (output.Item["itemType"] !== expectedType)
      throw new Error("Stored operator target is invalid.");
    return {
      status:
        expectedType === "project-metadata"
          ? StatusSchema.parse(output.Item["status"] ?? "active")
          : z.enum(["active", "suspended", "revoked", "replaced"]).parse(output.Item["status"]),
    };
  }
  return {
    inspectProject: (projectId) => inspect(metadataKey(projectId), "project-metadata"),
    inspectKey: (projectId, keyId) => inspect(credentialKey(projectId, keyId), "api-key-metadata"),
    setProjectStatus: async (projectId, expected, next) => {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: metadataKey(projectId),
          UpdateExpression: "SET #status = :next, updatedAt = :updatedAt",
          ConditionExpression:
            expected === "active"
              ? "itemType = :type AND (#status = :expected OR attribute_not_exists(#status))"
              : "itemType = :type AND #status = :expected",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":type": "project-metadata",
            ":expected": expected,
            ":next": next,
            ":updatedAt": new Date().toISOString(),
          },
        }),
      );
    },
    setKeyStatus: async (projectId, keyId, expected, next) => {
      const values = {
        ":expected": expected,
        ":next": next,
        ":updatedAt": new Date().toISOString(),
        ":project": projectId,
        ":keyId": keyId,
      };
      const condition = "#status = :expected AND publicProjectId = :project AND keyId = :keyId";
      await client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName,
                Key: credentialKey(projectId, keyId),
                UpdateExpression: "SET #status = :next, updatedAt = :updatedAt",
                ConditionExpression: condition,
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: values,
              },
            },
            {
              Update: {
                TableName: tableName,
                Key: { pk: `API_KEY#${keyId}`, sk: "LOOKUP" },
                UpdateExpression: "SET #status = :next, updatedAt = :updatedAt",
                ConditionExpression: condition,
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: values,
              },
            },
          ],
        }),
      );
    },
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  executeSuspension(process.argv.slice(2), createOperations(Resource.ControlTable.name)).catch(
    (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Suspension command failed."}\n`,
      );
      process.exitCode = 1;
    },
  );
}
