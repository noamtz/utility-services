import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { z } from "zod";

import { safeLogger } from "../../../core/observability/powertools.js";
import { createUpdateFileManagementPolicyHandler } from "./handlers.js";
import { createDynamoProjectRepository } from "./repository.js";
import { createProjectService } from "./service.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const repository = createDynamoProjectRepository({
  client,
  tableName: z.string().trim().min(1).parse(Resource.ControlTable.name),
  fileTableName: z.string().trim().min(1).parse(Resource.FileTable.name),
});
export const updateFileManagementPolicyHandler = createUpdateFileManagementPolicyHandler(
  createProjectService({ repository }),
  safeLogger,
);
