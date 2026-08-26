import { USAGE_METRICS } from "@utility-services/contracts";
import { describe, expect, it } from "vitest";

import {
  DEDUPE_SORT_KEY,
  DOWNLOAD_EVIDENCE_SORT_KEY,
  DOWNLOAD_QUARANTINE_SORT_KEY,
  PRICE_PARTITION_KEY,
  TOTAL_AGGREGATE_SORT_KEY,
  canonicalCloudTrailEventId,
  downloadEventDigest,
  downloadEvidenceFingerprint,
  downloadEvidencePartitionKey,
  downloadFileDigest,
  downloadMetricSourceDigest,
  downloadQuarantinePartitionKey,
  inputFingerprint,
  ledgerExpiry,
  parseDedupeItem,
  parseDownloadMeteringQuarantineItem,
  parseMetricAggregateItem,
  parsePriceVersionItem,
  parseProcessedDownloadEvidenceItem,
  parseQuarantineItem,
  parseStorageCheckpointItem,
  parseTotalAggregateItem,
  parseUsageEventItem,
  parseWatermarkItem,
  priceVersionSortKey,
  projectMonthPartitionKey,
  projectPartitionKey,
  quarantinePartitionKey,
  quarantineSortKey,
  retentionExpiry,
  sha256,
  sourceDigest,
  storagePartitionKey,
  storageSubjectDigest,
  usageEventSortKey,
  usagePeriod,
  watermarkSortKey,
  watermarkIndexPartitionKey,
  watermarkIndexSortKey,
} from "./model.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const occurredAt = "2026-08-15T12:34:56.789Z";
const digest = sourceDigest(projectId, "s3-event", "raw/source/id?secret=no");
const rate = {
  metric: "s3-upload-requests" as const,
  serviceCode: "AmazonS3" as const,
  productFamily: "API Request",
  sku: "Q2RMUYRD6HY2B5CD",
  rateCode: "Q2RMUYRD6HY2B5CD.JRTCKXETXF.6YS6EN2CT7",
  unit: "Requests" as const,
  unitQuantity: "1000",
  beginRange: "0",
  endRange: "Inf" as const,
  usdPerUnit: "0.0055",
  sourcePricePerUnitUsd: "0.0000055000",
  effectiveAt: "2026-08-01T00:00:00.000Z",
  description: "published rate",
};

function event() {
  return {
    pk: projectMonthPartitionKey(projectId, "2026-08"),
    sk: usageEventSortKey(occurredAt, digest),
    itemType: "usage-event",
    internalProjectId: projectId,
    period: "2026-08",
    metric: "s3-upload-requests",
    quantityAtoms: 1n,
    occurredAt,
    sourceKind: "s3-event",
    sourceDigest: digest,
    inputFingerprint: inputFingerprint({
      internalProjectId: projectId,
      metric: "s3-upload-requests",
      quantityAtoms: 1n,
      sourceKind: "s3-event",
      sourceId: "raw/source/id?secret=no",
      occurredAt,
    }),
    priceVersionId: "v1",
    priceEffectiveAt: "2026-08-01T00:00:00.000Z",
    rate,
    costAtoms: 5_500_000_000_000n,
    createdAt: occurredAt,
    expiresAt: ledgerExpiry(occurredAt),
  };
}

describe("usage pricing persisted model", () => {
  it("builds safe global download evidence and metric-specific identities", () => {
    const eventId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const fileId = "fil_0123456789abcdefghijkl";
    expect(canonicalCloudTrailEventId(eventId)).toBe(eventId.toLowerCase());
    const eventDigest = downloadEventDigest(eventId);
    expect(downloadEvidencePartitionKey(eventDigest)).toBe(`DOWNLOAD#${eventDigest}`);
    expect(downloadMetricSourceDigest(projectId, eventId, "s3-download-requests")).not.toBe(
      downloadMetricSourceDigest(projectId, eventId, "s3-download-bytes-out"),
    );
    expect(downloadFileDigest(projectId, fileId)).toHaveLength(64);
    const fingerprint = downloadEvidenceFingerprint({
      eventId,
      internalProjectId: projectId,
      fileId,
      occurredAt,
      bytesTransferredOut: 0n,
      accountId: "162067902192",
      region: "il-central-1",
      rawLogDigest: "c".repeat(64),
    });
    expect(fingerprint).toBe(
      downloadEvidenceFingerprint({
        eventId: eventId.toLowerCase(),
        internalProjectId: projectId,
        fileId,
        occurredAt,
        bytesTransferredOut: 0n,
        accountId: "162067902192",
        region: "il-central-1",
        rawLogDigest: "c".repeat(64),
      }),
    );
    expect(
      downloadEvidenceFingerprint({
        eventId,
        internalProjectId: projectId,
        fileId,
        occurredAt,
        bytesTransferredOut: 1n,
        accountId: "162067902192",
        region: "il-central-1",
        rawLogDigest: "c".repeat(64),
      }),
    ).not.toBe(fingerprint);
  });

  it("parses strict 90-day evidence and deterministic quarantine without raw identifiers", () => {
    const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fileId = "fil_0123456789abcdefghijkl";
    const eventDigest = downloadEventDigest(eventId);
    const fingerprint = downloadEvidenceFingerprint({
      eventId,
      internalProjectId: projectId,
      fileId,
      occurredAt,
      bytesTransferredOut: 2n ** 100n,
      accountId: "162067902192",
      region: "il-central-1",
      rawLogDigest: "c".repeat(64),
    });
    const evidence = {
      pk: downloadEvidencePartitionKey(eventDigest),
      sk: DOWNLOAD_EVIDENCE_SORT_KEY,
      itemType: "processed-download-evidence",
      eventDigest,
      fingerprint,
      internalProjectId: projectId,
      fileDigest: downloadFileDigest(projectId, fileId),
      occurredAt,
      observedAt: occurredAt,
      bytesTransferredOut: 2n ** 100n,
      pricingStatus: "observed-unpriced",
      expiresAt: retentionExpiry(occurredAt, 90),
    } as const;
    expect(parseProcessedDownloadEvidenceItem(evidence, "2026-08-16T00:00:00.000Z")).toEqual(
      evidence,
    );
    expect(
      parseProcessedDownloadEvidenceItem(evidence, "2027-01-01T00:00:00.000Z"),
    ).toBeUndefined();
    expect(() =>
      parseProcessedDownloadEvidenceItem({ ...evidence, objectKey: "secret" }),
    ).toThrow();
    expect(() =>
      parseProcessedDownloadEvidenceItem({ ...evidence, bytesTransferredOut: -1n }),
    ).toThrow();

    const evidenceHash = "d".repeat(64);
    const quarantine = {
      pk: downloadQuarantinePartitionKey(evidenceHash),
      sk: DOWNLOAD_QUARANTINE_SORT_KEY,
      itemType: "download-metering-quarantine",
      evidenceHash,
      reasonCode: "missing-bytes",
      sourceKind: "cloudtrail-download",
      observedAt: occurredAt,
      internalProjectId: projectId,
      expiresAt: retentionExpiry(occurredAt, 90),
    } as const;
    expect(parseDownloadMeteringQuarantineItem(quarantine)).toEqual(quarantine);
    expect(downloadQuarantinePartitionKey(evidenceHash)).toBe(
      `METERING-QUARANTINE#${evidenceHash}`,
    );
    expect(
      JSON.stringify({ evidence, quarantine }, (_key: string, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toMatch(/aaaaaaaa-aaaa|fil_012345|objectKey|bucket|arn:|url/u);
  });

  it("derives bounded deterministic hashes without exposing raw source identifiers", () => {
    expect(digest).toHaveLength(64);
    expect(digest).toBe(sourceDigest(projectId, "s3-event", "raw/source/id?secret=no"));
    expect(digest).not.toContain("secret");
    expect(sourceDigest(projectId, "s3-event", "x".repeat(2048))).toHaveLength(64);
    expect(() => sourceDigest(projectId, "s3-event", "x".repeat(2049))).toThrow();
    expect(sha256("ab", "c")).not.toBe(sha256("a", "bc"));
  });

  it("creates UTC periods and lexical keys at exact month boundaries", () => {
    expect(usagePeriod("2026-01-31T23:59:59.999Z")).toBe("2026-01");
    expect(usagePeriod("2026-02-01T00:00:00.000Z")).toBe("2026-02");
    expect(projectMonthPartitionKey(projectId, "2026-08")).toContain("#MONTH#2026-08");
    expect(
      usageEventSortKey("2026-08-01T00:00:00.000Z", "a".repeat(64)) <
        usageEventSortKey("2026-08-01T00:00:00.001Z", "a".repeat(64)),
    ).toBe(true);
    expect(priceVersionSortKey(occurredAt, "z".repeat(128))).toBe(priceVersionSortKey(occurredAt));
  });

  it("retains dedupe for 90 days and ledger detail through fourteen following months", () => {
    expect(retentionExpiry("2026-08-01T00:00:00.000Z", 90)).toBe(1_793_318_400n);
    expect(new Date(Number(ledgerExpiry("2026-08-31T23:59:59.999Z")) * 1000).toISOString()).toBe(
      "2027-11-01T00:00:00.000Z",
    );
    expect(new Date(Number(ledgerExpiry("2024-02-29T00:00:00.000Z")) * 1000).toISOString()).toBe(
      "2025-05-01T00:00:00.000Z",
    );
  });

  it("parses consistent price, event, aggregate, and total families fail-closed", () => {
    const parsed = parseUsageEventItem(event());
    expect(parsed.sourceDigest).toBe(digest);
    expect(() => parseUsageEventItem({ ...event(), period: "2026-07" })).toThrow();
    expect(() => parseUsageEventItem({ ...event(), extra: true })).toThrow();
    const aggregate = {
      pk: event().pk,
      sk: "AGGREGATE#METRIC#s3-upload-requests",
      itemType: "usage-aggregate-metric",
      internalProjectId: projectId,
      period: "2026-08",
      metric: "s3-upload-requests",
      quantityAtoms: 1n,
      costAtoms: 2n,
      revision: 1n,
      priceVersionIds: new Set(["v1"]),
    };
    expect(parseMetricAggregateItem(aggregate).revision).toBe(1n);
    expect(
      parseTotalAggregateItem({
        pk: event().pk,
        sk: TOTAL_AGGREGATE_SORT_KEY,
        itemType: "usage-aggregate-total",
        internalProjectId: projectId,
        period: "2026-08",
        costAtoms: 2n,
        revision: 1n,
        priceVersionIds: new Set(["v1"]),
      }).costAtoms,
    ).toBe(2n);
    expect(() =>
      parseMetricAggregateItem({ ...aggregate, sk: "AGGREGATE#METRIC#s3-download-requests" }),
    ).toThrow();
  });

  it("parses price versions with deterministic immutable keys", () => {
    const version = {
      versionId: "v1",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      publishedAt: "2026-08-18T18:11:13.000Z",
      currency: "USD",
      productRegion: "il-central-1",
      rates: USAGE_METRICS.map((metric) => ({
        ...rate,
        metric,
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
          publicationDate: "2026-08-18T18:11:13.000Z",
          version: "20260818181113",
          sha256: "a".repeat(64),
        },
      ],
    };
    expect(
      parsePriceVersionItem({
        ...version,
        pk: PRICE_PARTITION_KEY,
        sk: priceVersionSortKey(version.effectiveAt, version.versionId),
        itemType: "price-version",
      }).versionId,
    ).toBe("v1");
  });

  it("validates dedupe logical expiry and cross-record event linkage", () => {
    const value = event();
    const dedupe = {
      pk: `SOURCE#${digest}`,
      sk: DEDUPE_SORT_KEY,
      itemType: "usage-dedupe",
      sourceDigest: digest,
      inputFingerprint: value.inputFingerprint,
      eventPk: value.pk,
      eventSk: value.sk,
      createdAt: occurredAt,
      expiresAt: retentionExpiry(occurredAt, 90),
    };
    expect(parseDedupeItem(dedupe, "2026-08-16T00:00:00.000Z")).toBeDefined();
    expect(parseDedupeItem(dedupe, "2027-01-01T00:00:00.000Z")).toBeUndefined();
    expect(() => parseDedupeItem({ ...dedupe, pk: `SOURCE#${"b".repeat(64)}` })).toThrow();
  });

  it("validates active/closed checkpoints, watermarks, and safe quarantine", () => {
    const subjectDigest = storageSubjectDigest(projectId, "file-1");
    const checkpoint = {
      pk: storagePartitionKey(projectId, subjectDigest),
      sk: "CHECKPOINT",
      itemType: "storage-checkpoint",
      internalProjectId: projectId,
      subjectDigest,
      status: "active",
      byteSize: 10n,
      openedAt: occurredAt,
      checkpointedThrough: occurredAt,
      revision: 0n,
    };
    expect(parseStorageCheckpointItem(checkpoint).status).toBe("active");
    expect(() => parseStorageCheckpointItem({ ...checkpoint, status: "closed" })).toThrow();
    const watermark = {
      pk: projectPartitionKey(projectId),
      sk: watermarkSortKey("cloudtrail"),
      itemType: "usage-watermark",
      internalProjectId: projectId,
      sourceKind: "cloudtrail",
      lastMeteredAt: occurredAt,
      incompleteSince: null,
      gsi1pk: watermarkIndexPartitionKey("cloudtrail"),
      gsi1sk: watermarkIndexSortKey(occurredAt, projectId),
    };
    expect(parseWatermarkItem(watermark).sourceKind).toBe("cloudtrail");
    expect(
      parseWatermarkItem({ ...watermark, gsi1pk: undefined, gsi1sk: undefined }),
    ).toBeDefined();
    expect(() => parseWatermarkItem({ ...watermark, gsi1sk: `${occurredAt}#invalid` })).toThrow();
    const quarantineId = "22222222-2222-4222-8222-222222222222";
    const quarantine = {
      pk: quarantinePartitionKey(occurredAt),
      sk: quarantineSortKey(occurredAt, quarantineId),
      itemType: "usage-quarantine",
      quarantineId,
      observedAt: occurredAt,
      reasonCode: "ambiguous-source",
      sourceKind: "cloudtrail",
      evidenceHash: "b".repeat(64),
      expiresAt: retentionExpiry(occurredAt, 90),
    };
    expect(parseQuarantineItem(quarantine, "2026-08-16T00:00:00.000Z")).toBeDefined();
    expect(parseQuarantineItem(quarantine, "2027-01-01T00:00:00.000Z")).toBeUndefined();
    expect(
      JSON.stringify(quarantine, (_key: string, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toMatch(/raw|objectKey|stack|token/u);
  });
});
