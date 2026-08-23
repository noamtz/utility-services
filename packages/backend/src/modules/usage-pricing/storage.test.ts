import { USAGE_METRICS, type PriceVersion } from "@utility-services/contracts";
import { describe, expect, it } from "vitest";

import { splitStorageInterval } from "./storage.js";

const subjectDigest = "a".repeat(64);
const rate = {
  metric: "s3-storage-byte-milliseconds" as const,
  serviceCode: "AmazonS3" as const,
  productFamily: "Storage",
  sku: "RJ7BUHG2D92QSTS3",
  rateCode: "RJ7BUHG2D92QSTS3.JRTCKXETXF.PGHJ3S3EYE",
  unit: "GB-Mo" as const,
  unitQuantity: "1",
  beginRange: "0",
  endRange: "51200",
  usdPerUnit: "0.025",
  sourcePricePerUnitUsd: "0.0250000000",
  effectiveAt: "2026-01-01T00:00:00.000Z",
  description: "rate",
};
function version(id: string, effectiveAt: string): PriceVersion {
  return {
    versionId: id,
    effectiveAt,
    publishedAt: effectiveAt,
    currency: "USD",
    productRegion: "il-central-1",
    rates: USAGE_METRICS.map((metric) => ({
      ...rate,
      metric,
      effectiveAt,
      unit: metric.includes("storage")
        ? "GB-Mo"
        : metric.includes("bytes")
          ? "GB"
          : metric.includes("events")
            ? "Events"
            : "Requests",
    })),
    sources: [
      {
        url: "https://example.com",
        publicationDate: effectiveAt,
        version: effectiveAt.replace(/\D/gu, "").slice(0, 14),
        sha256: "b".repeat(64),
      },
    ],
  };
}
const v1 = version("v1", "2026-01-01T00:00:00.000Z");

describe("storage interval splitter", () => {
  it("returns no segment for an empty interval and rejects reverse time", () => {
    expect(
      splitStorageInterval({
        subjectDigest,
        byteSize: 1n,
        startAt: "2026-01-01T00:00:00.000Z",
        endAt: "2026-01-01T00:00:00.000Z",
        priceVersions: [v1],
      }),
    ).toEqual([]);
    expect(() =>
      splitStorageInterval({
        subjectDigest,
        byteSize: 1n,
        startAt: "2026-01-02T00:00:00.000Z",
        endAt: "2026-01-01T00:00:00.000Z",
        priceVersions: [v1],
      }),
    ).toThrow();
  });

  it("keeps exact half-open endpoints and subsecond byte-milliseconds", () => {
    const segments = splitStorageInterval({
      subjectDigest,
      byteSize: 7n,
      startAt: "2026-01-01T00:00:00.100Z",
      endAt: "2026-01-01T00:00:00.350Z",
      priceVersions: [v1],
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      startAt: "2026-01-01T00:00:00.100Z",
      endAt: "2026-01-01T00:00:00.350Z",
      quantityAtoms: 1750n,
    });
  });

  it("splits at a rate boundary within a month", () => {
    const segments = splitStorageInterval({
      subjectDigest,
      byteSize: 1n,
      startAt: "2026-01-10T00:00:00.000Z",
      endAt: "2026-01-20T00:00:00.000Z",
      priceVersions: [v1, version("v2", "2026-01-15T00:00:00.000Z")],
    });
    expect(segments.map((segment) => [segment.startAt, segment.endAt])).toEqual([
      ["2026-01-10T00:00:00.000Z", "2026-01-15T00:00:00.000Z"],
      ["2026-01-15T00:00:00.000Z", "2026-01-20T00:00:00.000Z"],
    ]);
  });

  it("splits at UTC month boundaries including leap February", () => {
    const segments = splitStorageInterval({
      subjectDigest,
      byteSize: 1n,
      startAt: "2024-01-31T23:59:59.000Z",
      endAt: "2024-03-01T00:00:01.000Z",
      priceVersions: [version("v1", "2024-01-01T00:00:00.000Z")],
    });
    expect(segments.map((segment) => segment.period)).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(segments[1]?.quantityAtoms).toBe(29n * 86_400_000n);
  });

  it("handles simultaneous rate/month boundaries only once", () => {
    const segments = splitStorageInterval({
      subjectDigest,
      byteSize: 2n,
      startAt: "2026-01-31T23:59:59.000Z",
      endAt: "2026-02-01T00:00:01.000Z",
      priceVersions: [v1, version("v2", "2026-02-01T00:00:00.000Z")],
    });
    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.quantityAtoms)).toEqual([2000n, 2000n]);
  });

  it("is UTC-only across Jerusalem DST and deterministic across replay", () => {
    const input = {
      subjectDigest,
      byteSize: 3n,
      startAt: "2026-03-26T20:00:00.000Z",
      endAt: "2026-04-02T20:00:00.000Z",
      priceVersions: [v1],
    };
    const first = splitStorageInterval(input);
    expect(first).toEqual(splitStorageInterval(input));
    expect(first.reduce((total, segment) => total + segment.quantityAtoms, 0n)).toBe(
      3n * 7n * 86_400_000n,
    );
    expect(new Set(first.map((segment) => segment.sourceId)).size).toBe(first.length);
  });

  it("splits a long multi-month interval without gaps", () => {
    const segments = splitStorageInterval({
      subjectDigest,
      byteSize: 1n,
      startAt: "2026-01-15T00:00:00.000Z",
      endAt: "2026-06-15T00:00:00.000Z",
      priceVersions: [v1, version("v2", "2026-04-10T00:00:00.000Z")],
    });
    expect(segments[0]?.startAt).toBe("2026-01-15T00:00:00.000Z");
    expect(segments.at(-1)?.endAt).toBe("2026-06-15T00:00:00.000Z");
    for (let index = 1; index < segments.length; index += 1)
      expect(segments[index]?.startAt).toBe(segments[index - 1]?.endAt);
  });
});
