import { USAGE_METRICS, type PriceVersion, type UsageMetric } from "@utility-services/contracts";
import { describe, expect, it } from "vitest";

import { ATTO_USD_PER_USD, BINARY_GIB_BYTES } from "./fixed-point.js";
import {
  NoEffectivePriceVersionError,
  calculateUsageCharge,
  millisecondsInUtcMonth,
  selectEffectivePriceVersion,
  validatePriceVersionHistory,
} from "./pricing.js";

function version(versionId: string, effectiveAt: string, price = "0.1"): PriceVersion {
  return {
    versionId,
    effectiveAt,
    publishedAt: effectiveAt,
    currency: "USD",
    productRegion: "il-central-1",
    rates: USAGE_METRICS.map((metric) => ({
      metric,
      serviceCode:
        metric === "cloudtrail-s3-data-events"
          ? "AWSCloudTrail"
          : metric === "s3-download-bytes-out"
            ? "AWSDataTransfer"
            : "AmazonS3",
      productFamily: "published family",
      sku: "ABCDEFGH",
      rateCode: "ABCDEFGH.JRTCKXETXF.6YS6EN2CT7",
      unit:
        metric === "s3-storage-byte-milliseconds"
          ? "GB-Mo"
          : metric === "s3-download-bytes-out"
            ? "GB"
            : metric === "cloudtrail-s3-data-events"
              ? "Events"
              : "Requests",
      unitQuantity: "1",
      beginRange: "0",
      endRange: "Inf",
      usdPerUnit: price,
      sourcePricePerUnitUsd: price,
      effectiveAt,
      description: "test rate",
    })),
    sources: [
      {
        url: "https://example.com/rates.json",
        publicationDate: effectiveAt,
        version: effectiveAt.replace(/\D/gu, "").slice(0, 14),
        sha256: "a".repeat(64),
      },
    ],
  };
}

function charge(metric: UsageMetric, quantityAtoms: bigint, occurredAt: string, price = "0.1") {
  return calculateUsageCharge({
    version: version("v1", "2020-01-01T00:00:00.000Z", price),
    metric,
    quantityAtoms,
    occurredAt,
  });
}

describe("usage pricing", () => {
  it("selects the greatest inclusive occurrence-time boundary", () => {
    const versions = [
      version("v1", "2026-01-01T00:00:00.000Z"),
      version("v2", "2026-02-01T00:00:00.000Z"),
    ];
    expect(selectEffectivePriceVersion(versions, "2026-01-31T23:59:59.999Z").versionId).toBe("v1");
    expect(selectEffectivePriceVersion(versions, "2026-02-01T00:00:00.000Z").versionId).toBe("v2");
    expect(selectEffectivePriceVersion(versions, "2026-02-01T00:00:00.001Z").versionId).toBe("v2");
    expect(() => selectEffectivePriceVersion(versions, "2025-12-31T23:59:59.999Z")).toThrow(
      NoEffectivePriceVersionError,
    );
  });

  it("rejects duplicate, reused, and non-ascending price identities", () => {
    expect(() =>
      validatePriceVersionHistory([
        version("v1", "2026-02-01T00:00:00.000Z"),
        version("v2", "2026-01-01T00:00:00.000Z"),
      ]),
    ).toThrow();
    expect(() =>
      validatePriceVersionHistory([
        version("v1", "2026-01-01T00:00:00.000Z"),
        version("v1", "2026-02-01T00:00:00.000Z"),
      ]),
    ).toThrow();
  });

  it("uses the exact UTC calendar-month duration for storage", () => {
    expect(millisecondsInUtcMonth("2024-02-15T12:00:00.000Z")).toBe(29n * 86_400_000n);
    expect(millisecondsInUtcMonth("2026-02-15T12:00:00.000Z")).toBe(28n * 86_400_000n);
    expect(millisecondsInUtcMonth("2026-01-15T12:00:00.000Z")).toBe(31n * 86_400_000n);
    const month = millisecondsInUtcMonth("2024-02-01T00:00:00.000Z");
    expect(
      charge(
        "s3-storage-byte-milliseconds",
        BINARY_GIB_BYTES * month,
        "2024-02-01T00:00:00.000Z",
        "0.025",
      ).costAtoms,
    ).toBe(25_000_000_000_000_000n);
  });

  it("normalizes requests, events, and binary outbound bytes with half-up rounding", () => {
    expect(charge("s3-upload-requests", 2n, "2026-01-01T00:00:00.000Z", "0.1").costAtoms).toBe(
      ATTO_USD_PER_USD / 5n,
    );
    expect(
      charge("s3-download-bytes-out", BINARY_GIB_BYTES, "2026-01-01T00:00:00.000Z", "0.11")
        .costAtoms,
    ).toBe(110_000_000_000_000_000n);
    const tied = version("v1", "2026-01-01T00:00:00.000Z", "0.000000000000000001");
    const cloudTrailRate = tied.rates.find((rate) => rate.metric === "cloudtrail-s3-data-events");
    if (!cloudTrailRate) throw new Error("test fixture is incomplete");
    cloudTrailRate.unitQuantity = "2";
    expect(
      calculateUsageCharge({
        version: tied,
        metric: "cloudtrail-s3-data-events",
        quantityAtoms: 1n,
        occurredAt: "2026-01-01T00:00:00.000Z",
      }).costAtoms,
    ).toBe(1n);
  });

  it("keeps historical charges immutable and guards DynamoDB overflow", () => {
    const first = calculateUsageCharge({
      version: version("v1", "2026-01-01T00:00:00.000Z", "0.1"),
      metric: "s3-upload-requests",
      quantityAtoms: 1n,
      occurredAt: "2026-01-15T00:00:00.000Z",
    });
    const later = version("v2", "2026-02-01T00:00:00.000Z", "0.2");
    expect(first.costAtoms).toBe(100_000_000_000_000_000n);
    expect(first.priceVersionId).toBe("v1");
    expect(later.rates[1]?.usdPerUnit).toBe("0.2");
    expect(() =>
      charge(
        "s3-upload-requests",
        10n ** 38n - 1n,
        "2026-01-01T00:00:00.000Z",
        "99999999999999999999",
      ),
    ).toThrow();
  });
});
