import { describe, expect, it } from "vitest";

import { USAGE_METRICS } from "@utility-services/contracts";
import {
  CURRENT_MONTH_USAGE_CONTROL_ROUTE,
  PRICE_SERVICE_PAGE_CROSS_CHECKS,
  PRICE_VERSIONS,
  USAGE_PRICING_TABLE_LINK_ACTIONS,
  USAGE_PRICING_TABLE_POLICY,
  USAGE_PRICING_TTL_ATTRIBUTE,
  USAGE_WATERMARK_INDEX_NAME,
  pricingVersionSortKey,
  toPriceSeedItem,
  usagePricingTableDeletionProtection,
  validateAppendOnlyPriceVersions,
} from "./usage-pricing.js";

describe("usage pricing infrastructure policy", () => {
  it("defines the owner-JWT current-month projection route", () => {
    expect(CURRENT_MONTH_USAGE_CONTROL_ROUTE).toEqual({
      name: "GetCurrentMonthUsageRoute",
      route: "GET /v1/control/projects/{projectId}/usage/current-month",
      handler: "packages/backend/src/functions/control/get-current-month-usage.handler",
    });
  });
  it("uses an independent on-demand PK/SK table with TTL and a sparse freshness index", () => {
    expect(USAGE_PRICING_TABLE_POLICY).toEqual({
      billingMode: "PAY_PER_REQUEST",
      fields: { pk: "string", sk: "string", gsi1pk: "string", gsi1sk: "string" },
      primaryIndex: { hashKey: "pk", rangeKey: "sk" },
      ttl: USAGE_PRICING_TTL_ATTRIBUTE,
      globalIndexes: {
        [USAGE_WATERMARK_INDEX_NAME]: {
          hashKey: "gsi1pk",
          rangeKey: "gsi1sk",
          projection: "all",
        },
      },
    });
    expect(USAGE_PRICING_TABLE_LINK_ACTIONS).toEqual(["dynamodb:Query"]);
    expect(JSON.stringify(USAGE_PRICING_TABLE_LINK_ACTIONS)).not.toMatch(/Scan|\*/u);
    expect(usagePricingTableDeletionProtection(false)).toBe(false);
    expect(usagePricingTableDeletionProtection(true)).toBe(true);
  });

  it("captures exactly one current il-central-1 USD rate for every approved metric", () => {
    const current = PRICE_VERSIONS.at(-1);
    expect(current?.productRegion).toBe("il-central-1");
    expect(current?.currency).toBe("USD");
    expect(current?.rates.map((rate) => rate.metric)).toEqual(USAGE_METRICS);
    expect(current?.rates.every((rate) => rate.beginRange === "0")).toBe(true);
    expect(current?.sources).toHaveLength(3);
    expect(current?.sources.every((source) => source.sha256.length === 64)).toBe(true);
    expect(PRICE_SERVICE_PAGE_CROSS_CHECKS).toHaveLength(3);
  });

  it("records the exact first-tier published values and provenance", () => {
    const rates = Object.fromEntries(
      (PRICE_VERSIONS[0]?.rates ?? []).map((rate) => [rate.metric, rate]),
    );
    expect(rates["s3-storage-byte-milliseconds"]).toMatchObject({
      sku: "RJ7BUHG2D92QSTS3",
      usdPerUnit: "0.025",
      unitQuantity: "1",
      endRange: "51200",
    });
    expect(rates["s3-upload-requests"]).toMatchObject({
      sku: "Q2RMUYRD6HY2B5CD",
      usdPerUnit: "0.0055",
      unitQuantity: "1000",
    });
    expect(rates["s3-download-requests"]).toMatchObject({
      sku: "WD988PZJAZGRGP65",
      usdPerUnit: "0.0044",
      unitQuantity: "10000",
    });
    expect(rates["s3-download-bytes-out"]).toMatchObject({
      serviceCode: "AWSDataTransfer",
      sku: "CMEYEEYC485JXPYQ",
      usdPerUnit: "0.11",
      unitQuantity: "1",
    });
    expect(rates["cloudtrail-s3-data-events"]).toMatchObject({
      sku: "BTY5KZ6BGX64ARHX",
      usdPerUnit: "0.1",
      unitQuantity: "100000",
    });
  });

  it("converts immutable versions to provider AttributeValue JSON without TTL or adjustments", () => {
    const version = PRICE_VERSIONS[0];
    if (!version) throw new Error("missing fixture");
    const item = JSON.parse(toPriceSeedItem(version)) as Record<string, unknown>;
    expect(item).toMatchObject({
      pk: { S: "PRICING" },
      sk: { S: pricingVersionSortKey(version) },
      itemType: { S: "price-version" },
    });
    expect(item).not.toHaveProperty("expiresAt");
    expect(JSON.stringify(item)).not.toMatch(/discount|credit|tax|shared.infrastructure/iu);
  });

  it("rejects reordered, duplicate, missing-metric, and mutated-shape histories", () => {
    const first = PRICE_VERSIONS[0];
    if (!first) throw new Error("missing fixture");
    expect(() =>
      validateAppendOnlyPriceVersions([
        first,
        { ...first, versionId: "later", effectiveAt: "2026-07-01T00:00:00.000Z" },
      ]),
    ).toThrow();
    expect(() => validateAppendOnlyPriceVersions([first, first])).toThrow();
    expect(() =>
      validateAppendOnlyPriceVersions([{ ...first, rates: first.rates.slice(1) }]),
    ).toThrow();
  });
});
