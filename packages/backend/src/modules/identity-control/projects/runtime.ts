import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { z } from "zod";

import { safeLogger } from "../../../core/observability/powertools.js";
import {
  createCreateProjectHandler,
  createInspectProjectHandler,
  createListProjectsHandler,
} from "./handlers.js";
import { createDynamoProjectRepository } from "./repository.js";
import { createProjectService } from "./service.js";

const tableName = z.string().trim().min(1).parse(Resource.ControlTable.name);
const dynamoClient = new DynamoDBClient({});
const documentClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const repository = createDynamoProjectRepository({ client: documentClient, tableName });
const service = createProjectService({ repository });

export const createProjectHandler = createCreateProjectHandler(service, safeLogger);
export const listProjectsHandler = createListProjectsHandler(service, safeLogger);
export const inspectProjectHandler = createInspectProjectHandler(service, safeLogger);
