import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { z } from "zod";

import { safeLogger } from "../../../core/observability/powertools.js";
import { createUsagePricingRuntime } from "../../usage-pricing/runtime.js";
import { createDynamoProjectRepository } from "../projects/repository.js";
import { createGetCurrentMonthUsageHandler } from "./handlers.js";
import { createOwnerUsageService } from "./service.js";

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const projects = createDynamoProjectRepository({
  client: documentClient,
  tableName: z.string().trim().min(1).parse(Resource.ControlTable.name),
});
const usage = createUsagePricingRuntime({
  tableName: z.string().trim().min(1).parse(Resource.UsagePricingTable.name),
});

export const getCurrentMonthUsageHandler = createGetCurrentMonthUsageHandler(
  createOwnerUsageService({ projects, usage }),
  safeLogger,
);
