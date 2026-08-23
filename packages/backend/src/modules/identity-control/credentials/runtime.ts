import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { z } from "zod";

import { safeLogger } from "../../../core/observability/powertools.js";
import {
  createIssueProjectApiKeyHandler,
  createListProjectApiKeysHandler,
  createReplaceProjectApiKeyHandler,
  createRevokeProjectApiKeyHandler,
} from "./handlers.js";
import { createDynamoCredentialRepository } from "./repository.js";
import { createCredentialService } from "./service.js";

const tableName = z.string().trim().min(1).parse(Resource.ControlTable.name);
const dynamoClient = new DynamoDBClient({});
const documentClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const repository = createDynamoCredentialRepository({ client: documentClient, tableName });
const service = createCredentialService({ repository });

export const issueProjectApiKeyHandler = createIssueProjectApiKeyHandler(service, safeLogger);
export const listProjectApiKeysHandler = createListProjectApiKeysHandler(service, safeLogger);
export const revokeProjectApiKeyHandler = createRevokeProjectApiKeyHandler(service, safeLogger);
export const replaceProjectApiKeyHandler = createReplaceProjectApiKeyHandler(service, safeLogger);
