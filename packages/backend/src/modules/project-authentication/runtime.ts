import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import {
  createDynamoCredentialRepository,
  type CredentialDocumentClient,
} from "../identity-control/credentials/repository.js";
import { createProjectAuthenticationService } from "./service.js";
import {
  createDynamoProjectRateLimitRepository,
  type RateLimitDocumentClient,
} from "./rate-limit/repository.js";
import { createProjectRequestLimiter } from "./rate-limit/service.js";

export function createProjectAuthenticationRuntime(options: {
  readonly tableName: string;
  readonly documentClient?: CredentialDocumentClient & RateLimitDocumentClient;
}) {
  const tableName = z.string().trim().min(1).parse(options.tableName);
  const documentClient =
    options.documentClient ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  return createProjectAuthenticationService({
    repository: createDynamoCredentialRepository({ client: documentClient, tableName }),
    limiter: createProjectRequestLimiter({
      repository: createDynamoProjectRateLimitRepository({ client: documentClient, tableName }),
    }),
  });
}
