import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { runFreshnessCheck } from "./freshness-monitor.js";
import { createDynamoUsagePricingRepository, usageDocumentClientOptions } from "./repository.js";

export async function checkMeteringFreshness(): Promise<void> {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), usageDocumentClientOptions());
  const repository = createDynamoUsagePricingRepository({
    client,
    tableName: z.string().trim().min(1).parse(process.env["USAGE_TABLE_NAME"]),
  });
  const sourceKinds = z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(z.string().min(1)).min(1))
    .parse(process.env["USAGE_FRESHNESS_SOURCE_KINDS"]);
  const staleAfterSeconds = z.coerce
    .number()
    .int()
    .positive()
    .parse(process.env["USAGE_FRESHNESS_STALE_AFTER_SECONDS"]);
  await runFreshnessCheck({
    repository,
    sources: sourceKinds.map((sourceKind) => ({ sourceKind, staleAfterSeconds })),
  });
}
