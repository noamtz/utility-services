import { createHash } from "node:crypto";

import {
  FileIdSchema,
  PriceRateSchema,
  PriceVersionSchema,
  UsageMetricSchema,
  UsagePeriodSchema,
} from "@utility-services/contracts";
import { z } from "zod";

import { assertDynamoInteger } from "./fixed-point.js";

export const PRICE_PARTITION_KEY = "PRICING" as const;
export const DEDUPE_SORT_KEY = "DEDUPE" as const;
export const CHECKPOINT_SORT_KEY = "CHECKPOINT" as const;
export const TOTAL_AGGREGATE_SORT_KEY = "AGGREGATE#TOTAL" as const;
export const DEDUPE_RETENTION_DAYS = 90 as const;
export const QUARANTINE_RETENTION_DAYS = 90 as const;
export const DOWNLOAD_EVIDENCE_SORT_KEY = "EVIDENCE" as const;
export const DOWNLOAD_QUARANTINE_SORT_KEY = "QUARANTINE" as const;
export const CLOUDTRAIL_DOWNLOAD_SOURCE_KIND = "cloudtrail-download" as const;
export const WATERMARK_FRESHNESS_INDEX_NAME = "UsageWatermarkFreshness" as const;

const TimestampSchema = z.iso.datetime({ offset: true });
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const InternalProjectIdSchema = z.uuid();
const SourceKindSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u);
const IdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const DynamoIntegerSchema = z
  .bigint()
  .nonnegative()
  .refine((value) => {
    try {
      assertDynamoInteger(value);
      return true;
    } catch {
      return false;
    }
  }, "DynamoDB integer exceeds 38 digits");
const ExpirySchema = DynamoIntegerSchema.positive();
const PriceVersionIdsSchema = z.set(IdentifierSchema);
const CloudTrailEventIdSchema = z.uuid();

export const PriceVersionItemSchema = PriceVersionSchema.extend({
  pk: z.literal(PRICE_PARTITION_KEY),
  sk: z.string().startsWith("VERSION#"),
  itemType: z.literal("price-version"),
}).strict();

export const UsageEventItemSchema = z
  .object({
    pk: z.string().startsWith("PROJECT#"),
    sk: z.string().startsWith("EVENT#"),
    itemType: z.literal("usage-event"),
    internalProjectId: InternalProjectIdSchema,
    period: UsagePeriodSchema,
    metric: UsageMetricSchema,
    quantityAtoms: DynamoIntegerSchema,
    occurredAt: TimestampSchema,
    sourceKind: SourceKindSchema,
    sourceDigest: DigestSchema,
    inputFingerprint: DigestSchema,
    priceVersionId: IdentifierSchema,
    priceEffectiveAt: TimestampSchema,
    rate: PriceRateSchema,
    costAtoms: DynamoIntegerSchema,
    createdAt: TimestampSchema,
    expiresAt: ExpirySchema,
  })
  .strict();

export const MetricAggregateItemSchema = z
  .object({
    pk: z.string().startsWith("PROJECT#"),
    sk: z.string().startsWith("AGGREGATE#METRIC#"),
    itemType: z.literal("usage-aggregate-metric"),
    internalProjectId: InternalProjectIdSchema,
    period: UsagePeriodSchema,
    metric: UsageMetricSchema,
    quantityAtoms: DynamoIntegerSchema,
    costAtoms: DynamoIntegerSchema,
    revision: DynamoIntegerSchema,
    priceVersionIds: PriceVersionIdsSchema,
  })
  .strict();

export const TotalAggregateItemSchema = z
  .object({
    pk: z.string().startsWith("PROJECT#"),
    sk: z.literal(TOTAL_AGGREGATE_SORT_KEY),
    itemType: z.literal("usage-aggregate-total"),
    internalProjectId: InternalProjectIdSchema,
    period: UsagePeriodSchema,
    costAtoms: DynamoIntegerSchema,
    revision: DynamoIntegerSchema,
    priceVersionIds: PriceVersionIdsSchema,
  })
  .strict();

export const DedupeItemSchema = z
  .object({
    pk: z.string().startsWith("SOURCE#"),
    sk: z.literal(DEDUPE_SORT_KEY),
    itemType: z.literal("usage-dedupe"),
    sourceDigest: DigestSchema,
    inputFingerprint: DigestSchema,
    eventPk: z.string().startsWith("PROJECT#"),
    eventSk: z.string().startsWith("EVENT#"),
    createdAt: TimestampSchema,
    expiresAt: ExpirySchema,
  })
  .strict();

export const StorageCheckpointItemSchema = z
  .object({
    pk: z.string().startsWith("STORAGE#"),
    sk: z.literal(CHECKPOINT_SORT_KEY),
    itemType: z.literal("storage-checkpoint"),
    internalProjectId: InternalProjectIdSchema,
    subjectDigest: DigestSchema,
    status: z.enum(["active", "closed"]),
    byteSize: DynamoIntegerSchema,
    openedAt: TimestampSchema,
    checkpointedThrough: TimestampSchema,
    revision: DynamoIntegerSchema,
    closedAt: TimestampSchema.optional(),
    expiresAt: ExpirySchema.optional(),
  })
  .strict()
  .superRefine((item, context) => {
    const closedFields = item.closedAt !== undefined && item.expiresAt !== undefined;
    if ((item.status === "closed") !== closedFields)
      context.addIssue({
        code: "custom",
        message: "Closed checkpoints require closedAt and expiresAt",
      });
    if (
      item.checkpointedThrough < item.openedAt ||
      (item.closedAt && item.closedAt !== item.checkpointedThrough)
    ) {
      context.addIssue({ code: "custom", message: "Checkpoint timestamps are inconsistent" });
    }
  });

export const WatermarkItemSchema = z
  .object({
    pk: z.string().startsWith("PROJECT#"),
    sk: z.string().startsWith("WATERMARK#"),
    itemType: z.literal("usage-watermark"),
    internalProjectId: InternalProjectIdSchema,
    sourceKind: SourceKindSchema,
    lastMeteredAt: TimestampSchema,
    incompleteSince: TimestampSchema.nullable(),
    gsi1pk: z.string().startsWith("WATERMARK#").optional(),
    gsi1sk: z.string().optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if ((item.gsi1pk === undefined) !== (item.gsi1sk === undefined)) {
      context.addIssue({ code: "custom", message: "Watermark index keys must be paired" });
    }
  });

export const QuarantineItemSchema = z
  .object({
    pk: z.string().startsWith("QUARANTINE#"),
    sk: z.string().startsWith("OBSERVED#"),
    itemType: z.literal("usage-quarantine"),
    quarantineId: z.uuid(),
    observedAt: TimestampSchema,
    reasonCode: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
    sourceKind: SourceKindSchema,
    evidenceHash: DigestSchema,
    internalProjectId: InternalProjectIdSchema.optional(),
    expiresAt: ExpirySchema,
  })
  .strict();

export const ProcessedDownloadEvidenceItemSchema = z
  .object({
    pk: z.string().startsWith("DOWNLOAD#"),
    sk: z.literal(DOWNLOAD_EVIDENCE_SORT_KEY),
    itemType: z.literal("processed-download-evidence"),
    eventDigest: DigestSchema,
    fingerprint: DigestSchema,
    internalProjectId: InternalProjectIdSchema,
    fileDigest: DigestSchema,
    occurredAt: TimestampSchema,
    observedAt: TimestampSchema,
    bytesTransferredOut: DynamoIntegerSchema,
    pricingStatus: z.enum(["observed-unpriced", "priced"]),
    expiresAt: ExpirySchema,
  })
  .strict();

export const DownloadMeteringQuarantineItemSchema = z
  .object({
    pk: z.string().startsWith("METERING-QUARANTINE#"),
    sk: z.literal(DOWNLOAD_QUARANTINE_SORT_KEY),
    itemType: z.literal("download-metering-quarantine"),
    evidenceHash: DigestSchema,
    reasonCode: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
    sourceKind: z.literal(CLOUDTRAIL_DOWNLOAD_SOURCE_KIND),
    observedAt: TimestampSchema,
    internalProjectId: InternalProjectIdSchema.optional(),
    expiresAt: ExpirySchema,
  })
  .strict();

export type PriceVersionItem = z.infer<typeof PriceVersionItemSchema>;
export type UsageEventItem = z.infer<typeof UsageEventItemSchema>;
export type MetricAggregateItem = z.infer<typeof MetricAggregateItemSchema>;
export type TotalAggregateItem = z.infer<typeof TotalAggregateItemSchema>;
export type DedupeItem = z.infer<typeof DedupeItemSchema>;
export type StorageCheckpointItem = z.infer<typeof StorageCheckpointItemSchema>;
export type WatermarkItem = z.infer<typeof WatermarkItemSchema>;
export type QuarantineItem = z.infer<typeof QuarantineItemSchema>;
export type ProcessedDownloadEvidenceItem = z.infer<typeof ProcessedDownloadEvidenceItemSchema>;
export type DownloadMeteringQuarantineItem = z.infer<typeof DownloadMeteringQuarantineItemSchema>;

export function sha256(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(`${Buffer.byteLength(part, "utf8")}:`).update(part);
  return hash.digest("hex");
}

export function usagePeriod(timestamp: string): string {
  return TimestampSchema.parse(timestamp).slice(0, 7);
}

export function projectMonthPartitionKey(internalProjectId: string, period: string): string {
  return `PROJECT#${InternalProjectIdSchema.parse(internalProjectId)}#MONTH#${UsagePeriodSchema.parse(period)}`;
}

export function projectPartitionKey(internalProjectId: string): string {
  return `PROJECT#${InternalProjectIdSchema.parse(internalProjectId)}`;
}

const PRICE_VERSION_UPPER_ID = "z".repeat(128);

export function priceVersionSortKey(
  effectiveAt: string,
  versionId = PRICE_VERSION_UPPER_ID,
): string {
  return `VERSION#${TimestampSchema.parse(effectiveAt)}#${IdentifierSchema.parse(versionId)}`;
}

export function metricAggregateSortKey(metric: string): string {
  return `AGGREGATE#METRIC#${UsageMetricSchema.parse(metric)}`;
}

export function sourceDigest(
  internalProjectId: string,
  sourceKind: string,
  sourceId: string,
): string {
  return sha256(
    InternalProjectIdSchema.parse(internalProjectId),
    SourceKindSchema.parse(sourceKind),
    z.string().min(1).max(2048).parse(sourceId),
  );
}

export function canonicalCloudTrailEventId(eventId: string): string {
  return CloudTrailEventIdSchema.parse(eventId).toLowerCase();
}

export function downloadEventDigest(eventId: string): string {
  return sha256("cloudtrail-event", canonicalCloudTrailEventId(eventId));
}

export function downloadEvidencePartitionKey(eventDigest: string): string {
  return `DOWNLOAD#${DigestSchema.parse(eventDigest)}`;
}

export function downloadQuarantinePartitionKey(evidenceHash: string): string {
  return `METERING-QUARANTINE#${DigestSchema.parse(evidenceHash)}`;
}

export function downloadFileDigest(internalProjectId: string, fileId: string): string {
  return sha256(InternalProjectIdSchema.parse(internalProjectId), FileIdSchema.parse(fileId));
}

export function downloadEvidenceFingerprint(input: {
  readonly eventId: string;
  readonly internalProjectId: string;
  readonly fileId: string;
  readonly occurredAt: string;
  readonly bytesTransferredOut: bigint;
  readonly accountId: string;
  readonly region: string;
  readonly rawLogDigest: string;
}): string {
  return sha256(
    downloadEventDigest(input.eventId),
    InternalProjectIdSchema.parse(input.internalProjectId),
    downloadFileDigest(input.internalProjectId, input.fileId),
    TimestampSchema.parse(input.occurredAt),
    assertDynamoInteger(input.bytesTransferredOut).toString(),
    z
      .string()
      .regex(/^\d{12}$/u)
      .parse(input.accountId),
    z
      .string()
      .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/u)
      .parse(input.region),
    z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(input.rawLogDigest),
    "AwsApiCall",
    "s3.amazonaws.com",
    "GetObject",
    "success",
  );
}

export function downloadMetricSourceDigest(
  internalProjectId: string,
  eventId: string,
  metric: string,
): string {
  return sha256(
    InternalProjectIdSchema.parse(internalProjectId),
    CLOUDTRAIL_DOWNLOAD_SOURCE_KIND,
    canonicalCloudTrailEventId(eventId),
    UsageMetricSchema.parse(metric),
  );
}

export function storageSubjectDigest(internalProjectId: string, subjectId: string): string {
  return sha256(
    InternalProjectIdSchema.parse(internalProjectId),
    z.string().min(1).max(1024).parse(subjectId),
  );
}

export function dedupePartitionKey(digest: string): string {
  return `SOURCE#${DigestSchema.parse(digest)}`;
}
export function storagePartitionKey(internalProjectId: string, digest: string): string {
  return `STORAGE#${InternalProjectIdSchema.parse(internalProjectId)}#${DigestSchema.parse(digest)}`;
}
export function watermarkSortKey(sourceKind: string): string {
  return `WATERMARK#${SourceKindSchema.parse(sourceKind)}`;
}
export function watermarkIndexPartitionKey(sourceKind: string): string {
  return `WATERMARK#${SourceKindSchema.parse(sourceKind)}`;
}
export function watermarkIndexSortKey(lastMeteredAt: string, internalProjectId: string): string {
  return `${TimestampSchema.parse(lastMeteredAt)}#${InternalProjectIdSchema.parse(internalProjectId)}`;
}
export function quarantinePartitionKey(observedAt: string): string {
  return `QUARANTINE#${usagePeriod(observedAt)}`;
}
export function quarantineSortKey(observedAt: string, quarantineId: string): string {
  return `OBSERVED#${TimestampSchema.parse(observedAt)}#${z.uuid().parse(quarantineId)}`;
}
export function usageEventSortKey(occurredAt: string, digest: string): string {
  return `EVENT#${TimestampSchema.parse(occurredAt)}#${DigestSchema.parse(digest)}`;
}

export function inputFingerprint(input: {
  internalProjectId: string;
  metric: string;
  quantityAtoms: bigint;
  sourceKind: string;
  sourceId: string;
  occurredAt: string;
}): string {
  return sha256(
    InternalProjectIdSchema.parse(input.internalProjectId),
    UsageMetricSchema.parse(input.metric),
    assertDynamoInteger(input.quantityAtoms).toString(),
    SourceKindSchema.parse(input.sourceKind),
    z.string().min(1).max(2048).parse(input.sourceId),
    TimestampSchema.parse(input.occurredAt),
  );
}

function epochSeconds(timestamp: string): bigint {
  return BigInt(Math.floor(new Date(TimestampSchema.parse(timestamp)).getTime() / 1000));
}
export function retentionExpiry(timestamp: string, days: number): bigint {
  if (!Number.isSafeInteger(days) || days <= 0)
    throw new RangeError("Retention days must be a positive integer");
  return epochSeconds(timestamp) + BigInt(days) * 86_400n;
}
export function ledgerExpiry(timestamp: string): bigint {
  const date = new Date(TimestampSchema.parse(timestamp));
  return BigInt(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 15, 1) / 1000);
}

export function parsePriceVersionItem(input: unknown): PriceVersionItem {
  const item = PriceVersionItemSchema.parse(input);
  if (item.sk !== priceVersionSortKey(item.effectiveAt, item.versionId))
    throw new Error("Price version keys are inconsistent");
  return item;
}

export function parseUsageEventItem(input: unknown): UsageEventItem {
  const item = UsageEventItemSchema.parse(input);
  if (
    item.pk !== projectMonthPartitionKey(item.internalProjectId, item.period) ||
    item.period !== usagePeriod(item.occurredAt) ||
    item.sk !== usageEventSortKey(item.occurredAt, item.sourceDigest) ||
    item.rate.metric !== item.metric
  ) {
    throw new Error("Usage event relationships are inconsistent");
  }
  return item;
}

export function parseMetricAggregateItem(input: unknown): MetricAggregateItem {
  const item = MetricAggregateItemSchema.parse(input);
  if (
    item.pk !== projectMonthPartitionKey(item.internalProjectId, item.period) ||
    item.sk !== metricAggregateSortKey(item.metric)
  )
    throw new Error("Metric aggregate keys are inconsistent");
  return item;
}

export function parseTotalAggregateItem(input: unknown): TotalAggregateItem {
  const item = TotalAggregateItemSchema.parse(input);
  if (item.pk !== projectMonthPartitionKey(item.internalProjectId, item.period))
    throw new Error("Total aggregate keys are inconsistent");
  return item;
}

export function parseDedupeItem(input: unknown, now?: string): DedupeItem | undefined {
  const item = DedupeItemSchema.parse(input);
  if (item.pk !== dedupePartitionKey(item.sourceDigest))
    throw new Error("Dedupe keys are inconsistent");
  return now && item.expiresAt <= epochSeconds(now) ? undefined : item;
}

export function parseStorageCheckpointItem(input: unknown): StorageCheckpointItem {
  const item = StorageCheckpointItemSchema.parse(input);
  if (item.pk !== storagePartitionKey(item.internalProjectId, item.subjectDigest))
    throw new Error("Storage checkpoint keys are inconsistent");
  return item;
}

export function parseWatermarkItem(input: unknown): WatermarkItem {
  const item = WatermarkItemSchema.parse(input);
  if (
    item.pk !== projectPartitionKey(item.internalProjectId) ||
    item.sk !== watermarkSortKey(item.sourceKind) ||
    (item.gsi1pk !== undefined &&
      (item.gsi1pk !== watermarkIndexPartitionKey(item.sourceKind) ||
        item.gsi1sk !== watermarkIndexSortKey(item.lastMeteredAt, item.internalProjectId)))
  )
    throw new Error("Watermark keys are inconsistent");
  return item;
}

export function parseQuarantineItem(input: unknown, now?: string): QuarantineItem | undefined {
  const item = QuarantineItemSchema.parse(input);
  if (
    item.pk !== quarantinePartitionKey(item.observedAt) ||
    item.sk !== quarantineSortKey(item.observedAt, item.quarantineId)
  )
    throw new Error("Quarantine keys are inconsistent");
  return now && item.expiresAt <= epochSeconds(now) ? undefined : item;
}

export function parseProcessedDownloadEvidenceItem(
  input: unknown,
  now?: string,
): ProcessedDownloadEvidenceItem | undefined {
  const item = ProcessedDownloadEvidenceItemSchema.parse(input);
  if (item.pk !== downloadEvidencePartitionKey(item.eventDigest)) {
    throw new Error("Processed download evidence keys are inconsistent");
  }
  return now && item.expiresAt <= epochSeconds(now) ? undefined : item;
}

export function parseDownloadMeteringQuarantineItem(
  input: unknown,
  now?: string,
): DownloadMeteringQuarantineItem | undefined {
  const item = DownloadMeteringQuarantineItemSchema.parse(input);
  if (item.pk !== downloadQuarantinePartitionKey(item.evidenceHash)) {
    throw new Error("Download metering quarantine keys are inconsistent");
  }
  return now && item.expiresAt <= epochSeconds(now) ? undefined : item;
}
