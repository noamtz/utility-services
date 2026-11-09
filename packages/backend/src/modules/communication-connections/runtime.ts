import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { z } from "zod";

import { safeLogger } from "../../core/observability/powertools.js";
import { createInspectCommunicationConnectionHandler, createRegisterCommunicationConnectionHandler } from "./handlers.js";
import { createDynamoConnectionRepository } from "./repository.js";
import { createCommunicationConnectionService } from "./service.js";
import { createSsmConnectionSecretStore } from "./ssm-secret-store.js";

const tableName = z.string().min(1).parse(Resource.CommunicationConnectionsTable.name);
const stage = z.string().regex(/^[a-z0-9-]{1,64}$/).parse(process.env.SST_STAGE);
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const service = createCommunicationConnectionService({
  repository: createDynamoConnectionRepository({ client, tableName }),
  secretStore: createSsmConnectionSecretStore({ stage }),
});
export const registerCommunicationConnectionHandler = createRegisterCommunicationConnectionHandler(service, safeLogger);
export const inspectCommunicationConnectionHandler = createInspectCommunicationConnectionHandler(service, safeLogger);
