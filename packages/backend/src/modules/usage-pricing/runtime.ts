import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import {
  createDynamoUsagePricingRepository,
  usageDocumentClientOptions,
  type UsageDocumentClient,
} from "./repository.js";
import { createUsagePricingService } from "./service.js";

export function createUsagePricingRuntime(options: {
  readonly tableName: string;
  readonly documentClient?: UsageDocumentClient;
}) {
  const tableName = z.string().trim().min(1).parse(options.tableName);
  const documentClient =
    options.documentClient ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), usageDocumentClientOptions());
  return createUsagePricingService({
    repository: createDynamoUsagePricingRepository({ client: documentClient, tableName }),
  });
}
