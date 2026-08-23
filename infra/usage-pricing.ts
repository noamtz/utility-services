import {
  PRICE_VERSIONS,
  USAGE_PRICING_TABLE_COMPONENT_NAME,
  USAGE_PRICING_TABLE_POLICY,
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
  return { table, priceItems };
}
