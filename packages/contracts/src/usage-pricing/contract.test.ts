import { describe, expect, it } from "vitest";

import {
  CanonicalUnsignedDecimalSchema,
  CurrentMonthlyUsageResponseSchema,
  MonthlyUsageProjectionSchema,
  PriceVersionSchema,
  USAGE_COST_EXCLUSIONS,
  USAGE_COST_LABEL,
  USAGE_METRICS,
} from "./contract.js";

const timestamp = "2026-08-01T00:00:00.000Z";

function priceVersion() {
  return {
    versionId: "aws-il-central-1-2026-08-01",
    effectiveAt: timestamp,
    publishedAt: "2026-08-18T18:11:13.000Z",
    currency: "USD",
    productRegion: "il-central-1",
    rates: USAGE_METRICS.map((metric) => ({
      metric,
      serviceCode: metric === "cloudtrail-s3-data-events" ? "AWSCloudTrail" : "AmazonS3",
      productFamily: "test family",
      sku: "ABCDEFGH",
      rateCode: "ABCDEFGH.JRTCKXETXF.6YS6EN2CT7",
      unit: metric.endsWith("requests")
        ? "Requests"
        : metric.endsWith("events")
          ? "Events"
          : metric.includes("storage")
            ? "GB-Mo"
            : "GB",
      unitQuantity: "1",
      beginRange: "0",
      endRange: "Inf",
      usdPerUnit: "0.1",
      sourcePricePerUnitUsd: "0.1",
      effectiveAt: timestamp,
      description: "published rate",
    })),
    sources: [
      {
        url: "https://pricing.us-east-1.amazonaws.com/example.json",
        publicationDate: "2026-08-18T18:11:13.000Z",
        version: "20260818181113",
        sha256: "a".repeat(64),
      },
    ],
  };
}

function projection() {
  return {
    label: USAGE_COST_LABEL,
    currency: "USD",
    period: "2026-08",
    totalCostUsd: "0.000001",
    metrics: [
      {
        metric: "s3-upload-requests",
        quantity: "2",
        costUsd: "0.000001",
        priceVersionIds: ["aws-il-central-1-2026-08-01"],
      },
    ],
    priceVersionIds: ["aws-il-central-1-2026-08-01"],
    exclusions: [...USAGE_COST_EXCLUSIONS],
    freshness: { state: "fresh", lastMeteredAt: timestamp, evaluatedAt: timestamp },
  };
}

describe("usage pricing contracts", () => {
  it("accepts a complete immutable price version and all five metrics", () => {
    expect(PriceVersionSchema.parse(priceVersion()).rates.map((rate) => rate.metric)).toEqual(
      USAGE_METRICS,
    );
  });

  it("rejects missing, duplicate, extra, wrong-region, and wrong-currency price evidence", () => {
    const base = priceVersion();
    expect(() => PriceVersionSchema.parse({ ...base, rates: base.rates.slice(1) })).toThrow();
    expect(() =>
      PriceVersionSchema.parse({ ...base, rates: base.rates.map(() => base.rates[0]) }),
    ).toThrow();
    expect(() => PriceVersionSchema.parse({ ...base, productRegion: "us-east-1" })).toThrow();
    expect(() => PriceVersionSchema.parse({ ...base, currency: "ILS" })).toThrow();
    expect(() => PriceVersionSchema.parse({ ...base, mutable: true })).toThrow();
  });

  it("uses canonical non-exponent decimal strings", () => {
    for (const accepted of ["0", "1", "0.1", "123.0004"]) {
      expect(CanonicalUnsignedDecimalSchema.parse(accepted)).toBe(accepted);
    }
    for (const rejected of ["-1", "+1", "01", "1.0", "1e-6", "", 1]) {
      expect(() => CanonicalUnsignedDecimalSchema.parse(rejected)).toThrow();
    }
  });

  it("returns the exact AWS-equivalent label, USD, exclusions, and freshness", () => {
    expect(MonthlyUsageProjectionSchema.parse(projection())).toEqual(projection());
    expect(
      CurrentMonthlyUsageResponseSchema.parse({ data: projection(), requestId: "request-1" }),
    ).toEqual({ data: projection(), requestId: "request-1" });
  });

  it("rejects unsorted versions and every internal or AWS implementation field", () => {
    const base = projection();
    expect(() =>
      MonthlyUsageProjectionSchema.parse({ ...base, priceVersionIds: ["z", "a"] }),
    ).toThrow();
    for (const field of [
      "internalProjectId",
      "pk",
      "sourceId",
      "costAtoms",
      "checkpoint",
      "tableName",
      "bucketName",
    ]) {
      expect(() => MonthlyUsageProjectionSchema.parse({ ...base, [field]: "private" })).toThrow();
    }
  });
});
