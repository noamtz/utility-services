import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { z } from "zod";

import { safeLogger } from "../../core/observability/powertools.js";
import {
  createDisableCommunicationConnectionHandler,
  createInspectCommunicationConnectionHandler,
  createListCommunicationConnectionsHandler,
  createRegisterCommunicationConnectionHandler,
  createRotateCommunicationConnectionHandler,
} from "./handlers.js";
import { createDynamoProjectRepository } from "../identity-control/projects/repository.js";
import { createDynamoConnectionRepository } from "./repository.js";
import { createCommunicationConnectionService } from "./service.js";
import { createSsmConnectionSecretStore } from "./ssm-secret-store.js";

const resources = Resource as {
  CommunicationConnectionsTable: { name: unknown };
  ControlTable: { name: unknown };
};
const tableName = z.string().min(1).parse(resources.CommunicationConnectionsTable.name);
const controlTableName = z.string().min(1).parse(resources.ControlTable.name);
const stage = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/)
  .parse(process.env.SST_STAGE);
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const service = createCommunicationConnectionService({
  repository: createDynamoConnectionRepository({ client, tableName }),
  secretStore: createSsmConnectionSecretStore({ stage }),
});
const projects = createDynamoProjectRepository({ client, tableName: controlTableName });
export const registerCommunicationConnectionHandler = createRegisterCommunicationConnectionHandler(
  service,
  projects,
  safeLogger,
);
export const listCommunicationConnectionsHandler = createListCommunicationConnectionsHandler(
  service,
  projects,
  safeLogger,
);
export const inspectCommunicationConnectionHandler = createInspectCommunicationConnectionHandler(
  service,
  projects,
  safeLogger,
);
export const rotateCommunicationConnectionHandler = createRotateCommunicationConnectionHandler(
  service,
  projects,
  safeLogger,
);
export const disableCommunicationConnectionHandler = createDisableCommunicationConnectionHandler(
  service,
  projects,
  safeLogger,
);
