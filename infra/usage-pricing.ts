import {
  PRICE_VERSIONS,
  USAGE_PRICING_TABLE_COMPONENT_NAME,
  USAGE_PRICING_TABLE_POLICY,
  USAGE_FRESHNESS_MONITOR_COMPONENT_NAME,
  USAGE_FRESHNESS_MONITOR_SCHEDULE,
  USAGE_FRESHNESS_SOURCE_KINDS,
  USAGE_FRESHNESS_STALE_AFTER_SECONDS,
  USAGE_WATERMARK_INDEX_NAME,
  toPriceSeedItem,
  usagePricingTableDeletionProtection,
} from "./config/usage-pricing.js";
import type { PriceVersion } from "@utility-services/contracts";
import { configureLeastPrivilegeDynamoLink } from "./dynamo-link.js";

export function priceSeedResourceName(version: PriceVersion): string {
  const identity = version.versionId
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
  return `UsagePrice${identity}`;
}

export function createUsagePricingResources(options: { production: boolean }) {
  configureLeastPrivilegeDynamoLink();
  const table = new sst.aws.Dynamo(USAGE_PRICING_TABLE_COMPONENT_NAME, {
    fields: USAGE_PRICING_TABLE_POLICY.fields,
    primaryIndex: USAGE_PRICING_TABLE_POLICY.primaryIndex,
    globalIndexes: USAGE_PRICING_TABLE_POLICY.globalIndexes,
    ttl: USAGE_PRICING_TABLE_POLICY.ttl,
    deletionProtection: usagePricingTableDeletionProtection(options.production),
  });
  const priceItems = PRICE_VERSIONS.map(
    (version) =>
      new aws.dynamodb.TableItem(
        priceSeedResourceName(version),
        {
          tableName: table.name,
          hashKey: "pk",
          rangeKey: "sk",
          item: toPriceSeedItem(version),
        },
        { retainOnDelete: true, ignoreChanges: ["item"] },
      ),
  );
  const freshnessMonitor = new sst.aws.Cron(USAGE_FRESHNESS_MONITOR_COMPONENT_NAME, {
    schedule: USAGE_FRESHNESS_MONITOR_SCHEDULE,
    function: {
      handler: "packages/backend/src/functions/usage-pricing/check-metering-freshness.handler",
      runtime: "nodejs24.x",
      environment: {
        USAGE_TABLE_NAME: table.name,
        USAGE_FRESHNESS_SOURCE_KINDS: USAGE_FRESHNESS_SOURCE_KINDS.join(","),
        USAGE_FRESHNESS_STALE_AFTER_SECONDS: String(USAGE_FRESHNESS_STALE_AFTER_SECONDS),
      },
      permissions: [
        {
          actions: ["dynamodb:Query"],
          resources: [$interpolate`${table.arn}/index/${USAGE_WATERMARK_INDEX_NAME}`],
        },
      ],
      transform: { function: { tracingConfig: { mode: "Active" } } },
    },
  });
  return { table, priceItems, freshnessMonitor };
}
