import { randomUUID } from "node:crypto";

import {
  MonthlyUsageProjectionSchema,
  USAGE_COST_EXCLUSIONS,
  USAGE_COST_LABEL,
  USAGE_METRICS,
  UsageMetricSchema,
  UsagePeriodSchema,
  type MonthlyUsageProjection,
  type UsageMetric,
} from "@utility-services/contracts";
import { z } from "zod";

import {
  addDynamoIntegers,
  assertDynamoInteger,
  formatAttoUsd,
  formatScaledUnsigned,
} from "./fixed-point.js";
import {
  CHECKPOINT_SORT_KEY,
  CLOUDTRAIL_DOWNLOAD_SOURCE_KIND,
  DEDUPE_RETENTION_DAYS,
  DEDUPE_SORT_KEY,
  DOWNLOAD_EVIDENCE_SORT_KEY,
  DOWNLOAD_QUARANTINE_SORT_KEY,
  QUARANTINE_RETENTION_DAYS,
  TOTAL_AGGREGATE_SORT_KEY,
  dedupePartitionKey,
  canonicalCloudTrailEventId,
  downloadEventDigest,
  downloadEvidenceFingerprint,
  downloadEvidencePartitionKey,
  downloadFileDigest,
  downloadMetricSourceDigest,
  downloadQuarantinePartitionKey,
  inputFingerprint,
  ledgerExpiry,
  metricAggregateSortKey,
  projectMonthPartitionKey,
  quarantinePartitionKey,
  quarantineSortKey,
  retentionExpiry,
  sha256,
  sourceDigest,
  storagePartitionKey,
  storageSubjectDigest,
  usageEventSortKey,
  usagePeriod,
  type DedupeItem,
  type DownloadMeteringQuarantineItem,
  type MetricAggregateItem,
  type ProcessedDownloadEvidenceItem,
  type QuarantineItem,
  type StorageCheckpointItem,
  type TotalAggregateItem,
  type UsageEventItem,
  type WatermarkItem,
} from "./model.js";
import { NoEffectivePriceVersionError, calculateUsageCharge } from "./pricing.js";
import {
  UsageCheckpointConflictError,
  UsageProjectionConflictError,
  UsageRepositoryConflictError,
  UsageSourceConflictError,
  type AggregateItem,
  type UsagePricingRepository,
} from "./repository.js";
import { splitStorageInterval } from "./storage.js";

const TimestampSchema = z.iso.datetime({ offset: true });
const InternalProjectIdSchema = z.uuid();
const SourceKindSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u);
const SourceIdSchema = z.string().min(1).max(2048);
const SubjectIdSchema = z.string().min(1).max(1024);

export interface RecordUsageInput {
  readonly internalProjectId: string;
  readonly metric: UsageMetric;
  readonly quantityAtoms: bigint;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly occurredAt: string;
}

export interface RecordUsageResult {
  readonly status: "recorded" | "duplicate";
  readonly metric: UsageMetric;
  readonly quantityAtoms: bigint;
  readonly costAtoms: bigint;
  readonly priceVersionId: string;
  readonly occurredAt: string;
}

export interface DownloadEvidenceInput {
  readonly eventId: string;
  readonly internalProjectId: string;
  readonly fileId: string;
  readonly occurredAt: string;
  readonly bytesTransferredOut: bigint;
  readonly accountId: string;
  readonly region: string;
  readonly rawLogDigest: string;
}

export interface DownloadEvidenceResult {
  readonly status: "observed" | "recorded" | "duplicate";
  readonly internalProjectId: string;
  readonly period: string;
  readonly occurredAt: string;
  readonly bytesTransferredOut: bigint;
}

export interface FreshnessPolicy {
  readonly requiredSources: Readonly<Record<string, number>>;
}

export class StorageCheckpointNotFoundError extends Error {
  public constructor() {
    super("Storage checkpoint does not exist");
    this.name = "StorageCheckpointNotFoundError";
  }
}
export class StorageEvidenceConflictError extends Error {
  public constructor() {
    super("Storage evidence conflicts with the existing checkpoint");
    this.name = "StorageEvidenceConflictError";
  }
}
export class UsageRetryExhaustedError extends Error {
  public constructor() {
    super("Usage operation could not complete after bounded retries");
    this.name = "UsageRetryExhaustedError";
  }
}

function canonicalTimestamp(value: string): string {
  return new Date(TimestampSchema.parse(value)).toISOString();
}
function milliseconds(value: string): number {
  return new Date(canonicalTimestamp(value)).getTime();
}

export function createUsagePricingService(options: {
  readonly repository: UsagePricingRepository;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly maxRetries?: number;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const maxRetries = z
    .number()
    .int()
    .min(1)
    .max(10)
    .parse(options.maxRetries ?? 3);

  async function retry<T>(
    operation: () => Promise<T>,
    retryable: (error: unknown) => boolean,
  ): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!retryable(error)) throw error;
        if (attempt === maxRetries - 1) throw new UsageRetryExhaustedError();
      }
    }
    throw new UsageRetryExhaustedError();
  }

  function validateRecording(input: RecordUsageInput): RecordUsageInput {
    return {
      internalProjectId: InternalProjectIdSchema.parse(input.internalProjectId),
      metric: UsageMetricSchema.parse(input.metric),
      quantityAtoms: assertDynamoInteger(input.quantityAtoms),
      sourceKind: SourceKindSchema.parse(input.sourceKind),
      sourceId: SourceIdSchema.parse(input.sourceId),
      occurredAt: canonicalTimestamp(input.occurredAt),
    };
  }

  function createDownloadEvidence(
    input: DownloadEvidenceInput,
    pricingStatus: "observed-unpriced" | "priced",
  ): ProcessedDownloadEvidenceItem {
    const eventId = canonicalCloudTrailEventId(input.eventId);
    const internalProjectId = InternalProjectIdSchema.parse(input.internalProjectId);
    const occurredAt = canonicalTimestamp(input.occurredAt);
    const observedAt = canonicalTimestamp(now());
    const eventDigest = downloadEventDigest(eventId);
    return {
      pk: downloadEvidencePartitionKey(eventDigest),
      sk: DOWNLOAD_EVIDENCE_SORT_KEY,
      itemType: "processed-download-evidence",
      eventDigest,
      fingerprint: downloadEvidenceFingerprint({
        ...input,
        eventId,
        internalProjectId,
        occurredAt,
      }),
      internalProjectId,
      fileDigest: downloadFileDigest(internalProjectId, input.fileId),
      occurredAt,
      observedAt,
      bytesTransferredOut: assertDynamoInteger(input.bytesTransferredOut),
      pricingStatus,
      expiresAt: retentionExpiry(observedAt, DEDUPE_RETENTION_DAYS),
    };
  }

  function downloadResult(
    status: DownloadEvidenceResult["status"],
    evidence: ProcessedDownloadEvidenceItem,
  ): DownloadEvidenceResult {
    return Object.freeze({
      status,
      internalProjectId: evidence.internalProjectId,
      period: usagePeriod(evidence.occurredAt),
      occurredAt: evidence.occurredAt,
      bytesTransferredOut: evidence.bytesTransferredOut,
    });
  }

  async function quarantine(input: {
    readonly reasonCode: string;
    readonly sourceKind: string;
    readonly evidenceHash: string;
    readonly observedAt: string;
    readonly internalProjectId?: string;
  }): Promise<void> {
    const observedAt = canonicalTimestamp(input.observedAt);
    const quarantineId = z.uuid().parse(createId());
    const item: QuarantineItem = {
      pk: quarantinePartitionKey(observedAt),
      sk: quarantineSortKey(observedAt, quarantineId),
      itemType: "usage-quarantine",
      quarantineId,
      observedAt,
      reasonCode: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,63}$/u)
        .parse(input.reasonCode),
      sourceKind: SourceKindSchema.parse(input.sourceKind),
      evidenceHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .parse(input.evidenceHash),
      ...(input.internalProjectId
        ? { internalProjectId: InternalProjectIdSchema.parse(input.internalProjectId) }
        : {}),
      expiresAt: retentionExpiry(observedAt, QUARANTINE_RETENTION_DAYS),
    };
    await options.repository.putQuarantine(item);
    if (item.internalProjectId)
      await options.repository.markWatermarkIncomplete(
        item.internalProjectId,
        item.sourceKind,
        observedAt,
      );
  }

  async function quarantineDownloadEvidence(input: {
    readonly reasonCode: string;
    readonly evidenceHash: string;
    readonly observedAt: string;
    readonly internalProjectId?: string;
  }): Promise<"recorded" | "duplicate"> {
    const observedAt = canonicalTimestamp(input.observedAt);
    const reasonCode = z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/u)
      .parse(input.reasonCode);
    const internalProjectId = input.internalProjectId
      ? InternalProjectIdSchema.parse(input.internalProjectId)
      : undefined;
    const suppliedHash = z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(input.evidenceHash);
    const evidenceHash = sha256(
      "download-quarantine",
      reasonCode,
      suppliedHash,
      internalProjectId ?? "unknown-project",
    );
    const item: DownloadMeteringQuarantineItem = {
      pk: downloadQuarantinePartitionKey(evidenceHash),
      sk: DOWNLOAD_QUARANTINE_SORT_KEY,
      itemType: "download-metering-quarantine",
      evidenceHash,
      reasonCode,
      sourceKind: CLOUDTRAIL_DOWNLOAD_SOURCE_KIND,
      observedAt,
      ...(internalProjectId ? { internalProjectId } : {}),
      expiresAt: retentionExpiry(observedAt, QUARANTINE_RETENTION_DAYS),
    };
    const putDownloadQuarantine = options.repository.putDownloadQuarantine?.bind(
      options.repository,
    );
    if (!putDownloadQuarantine) throw new Error("Download metering repository is unavailable");
    const result = await retry(
      () => putDownloadQuarantine(item, observedAt),
      (error) => error instanceof UsageRepositoryConflictError,
    );
    if (internalProjectId) {
      await retry(
        () =>
          options.repository.markWatermarkIncomplete(
            internalProjectId,
            CLOUDTRAIL_DOWNLOAD_SOURCE_KIND,
            observedAt,
          ),
        (error) => error instanceof UsageRepositoryConflictError,
      );
    }
    return result.status;
  }

  async function advanceWatermark(
    input: Pick<RecordUsageInput, "internalProjectId" | "sourceKind" | "occurredAt">,
  ): Promise<void> {
    await retry(
      () =>
        options.repository.advanceWatermark(
          input.internalProjectId,
          input.sourceKind,
          input.occurredAt,
        ),
      () => true,
    );
  }

  async function recordUsage(rawInput: RecordUsageInput): Promise<RecordUsageResult> {
    const input = validateRecording(rawInput);
    const price = await options.repository.findEffectivePrice(input.occurredAt);
    if (!price) throw new NoEffectivePriceVersionError();
    const charge = calculateUsageCharge({
      version: price,
      metric: input.metric,
      quantityAtoms: input.quantityAtoms,
      occurredAt: input.occurredAt,
    });
    const digest = sourceDigest(input.internalProjectId, input.sourceKind, input.sourceId);
    const fingerprint = inputFingerprint(input);
    const createdAt = canonicalTimestamp(now());
    const period = usagePeriod(input.occurredAt);
    const event: UsageEventItem = {
      pk: projectMonthPartitionKey(input.internalProjectId, period),
      sk: usageEventSortKey(input.occurredAt, digest),
      itemType: "usage-event",
      internalProjectId: input.internalProjectId,
      period,
      metric: input.metric,
      quantityAtoms: input.quantityAtoms,
      occurredAt: input.occurredAt,
      sourceKind: input.sourceKind,
      sourceDigest: digest,
      inputFingerprint: fingerprint,
      priceVersionId: charge.priceVersionId,
      priceEffectiveAt: charge.priceEffectiveAt,
      rate: charge.rate,
      costAtoms: charge.costAtoms,
      createdAt,
      expiresAt: ledgerExpiry(input.occurredAt),
    };
    const dedupe: DedupeItem = {
      pk: dedupePartitionKey(digest),
      sk: DEDUPE_SORT_KEY,
      itemType: "usage-dedupe",
      sourceDigest: digest,
      inputFingerprint: fingerprint,
      eventPk: event.pk,
      eventSk: event.sk,
      createdAt,
      expiresAt: retentionExpiry(createdAt, DEDUPE_RETENTION_DAYS),
    };
    let result;
    try {
      result = await retry(
        () => options.repository.recordEvent(event, dedupe, createdAt),
        (error) => error instanceof UsageRepositoryConflictError,
      );
    } catch (error) {
      if (error instanceof UsageSourceConflictError) {
        await quarantine({
          reasonCode: "divergent-source",
          sourceKind: input.sourceKind,
          evidenceHash: sha256(fingerprint),
          observedAt: createdAt,
          internalProjectId: input.internalProjectId,
        });
      }
      throw error;
    }
    await advanceWatermark(input);
    const accepted = result.status === "duplicate" ? result.event : event;
    return Object.freeze({
      status: result.status,
      metric: accepted.metric,
      quantityAtoms: accepted.quantityAtoms,
      costAtoms: accepted.costAtoms,
      priceVersionId: accepted.priceVersionId,
      occurredAt: accepted.occurredAt,
    });
  }

  async function observeDownloadEvidence(
    rawInput: DownloadEvidenceInput,
  ): Promise<DownloadEvidenceResult> {
    const evidence = createDownloadEvidence(rawInput, "observed-unpriced");
    const observe = options.repository.observeDownloadEvidence?.bind(options.repository);
    if (!observe) throw new Error("Download metering repository is unavailable");
    try {
      const result = await retry(
        () => observe(evidence, evidence.observedAt),
        (error) => error instanceof UsageRepositoryConflictError,
      );
      return downloadResult(result.status, result.evidence);
    } catch (error) {
      if (error instanceof UsageSourceConflictError) {
        await quarantineDownloadEvidence({
          reasonCode: "divergent-download-evidence",
          evidenceHash: evidence.fingerprint,
          observedAt: evidence.observedAt,
          internalProjectId: evidence.internalProjectId,
        });
      }
      throw error;
    }
  }

  async function recordDownloadEvidence(
    rawInput: DownloadEvidenceInput,
  ): Promise<DownloadEvidenceResult> {
    const evidence = createDownloadEvidence(rawInput, "priced");
    const eventId = canonicalCloudTrailEventId(rawInput.eventId);
    const price = await options.repository.findEffectivePrice(evidence.occurredAt);
    if (!price) throw new NoEffectivePriceVersionError();
    const metricQuantities = [
      ["s3-download-requests", 1n],
      ["s3-download-bytes-out", evidence.bytesTransferredOut],
      ["cloudtrail-s3-data-events", 1n],
    ] as const;
    const events = metricQuantities.map(([metric, quantityAtoms]) => {
      const charge = calculateUsageCharge({
        version: price,
        metric,
        quantityAtoms,
        occurredAt: evidence.occurredAt,
      });
      const digest = downloadMetricSourceDigest(evidence.internalProjectId, eventId, metric);
      const fingerprint = inputFingerprint({
        internalProjectId: evidence.internalProjectId,
        metric,
        quantityAtoms,
        sourceKind: CLOUDTRAIL_DOWNLOAD_SOURCE_KIND,
        sourceId: `${eventId}:${metric}`,
        occurredAt: evidence.occurredAt,
      });
      const period = usagePeriod(evidence.occurredAt);
      const event: UsageEventItem = {
        pk: projectMonthPartitionKey(evidence.internalProjectId, period),
        sk: usageEventSortKey(evidence.occurredAt, digest),
        itemType: "usage-event",
        internalProjectId: evidence.internalProjectId,
        period,
        metric,
        quantityAtoms,
        occurredAt: evidence.occurredAt,
        sourceKind: CLOUDTRAIL_DOWNLOAD_SOURCE_KIND,
        sourceDigest: digest,
        inputFingerprint: fingerprint,
        priceVersionId: charge.priceVersionId,
        priceEffectiveAt: charge.priceEffectiveAt,
        rate: charge.rate,
        costAtoms: charge.costAtoms,
        createdAt: evidence.observedAt,
        expiresAt: ledgerExpiry(evidence.occurredAt),
      };
      return event;
    }) as [UsageEventItem, UsageEventItem, UsageEventItem];
    const record = options.repository.recordDownloadEvent?.bind(options.repository);
    if (!record) throw new Error("Download metering repository is unavailable");
    try {
      const result = await retry(
        () => record(evidence, events, evidence.observedAt),
        (error) => error instanceof UsageRepositoryConflictError,
      );
      await advanceWatermark({
        internalProjectId: evidence.internalProjectId,
        sourceKind: CLOUDTRAIL_DOWNLOAD_SOURCE_KIND,
        occurredAt: evidence.occurredAt,
      });
      return downloadResult(result.status, result.evidence);
    } catch (error) {
      if (error instanceof UsageSourceConflictError) {
        await quarantineDownloadEvidence({
          reasonCode: "divergent-download-evidence",
          evidenceHash: evidence.fingerprint,
          observedAt: evidence.observedAt,
          internalProjectId: evidence.internalProjectId,
        });
      }
      throw error;
    }
  }

  async function openStorage(input: {
    internalProjectId: string;
    storageSubjectId: string;
    byteSize: bigint;
    openedAt: string;
  }): Promise<StorageCheckpointItem> {
    const internalProjectId = InternalProjectIdSchema.parse(input.internalProjectId);
    const subjectDigest = storageSubjectDigest(
      internalProjectId,
      SubjectIdSchema.parse(input.storageSubjectId),
    );
    const byteSize = assertDynamoInteger(input.byteSize);
    const openedAt = canonicalTimestamp(input.openedAt);
    const item: StorageCheckpointItem = {
      pk: storagePartitionKey(internalProjectId, subjectDigest),
      sk: CHECKPOINT_SORT_KEY,
      itemType: "storage-checkpoint",
      internalProjectId,
      subjectDigest,
      status: "active",
      byteSize,
      openedAt,
      checkpointedThrough: openedAt,
      revision: 0n,
    };
    try {
      await options.repository.createCheckpoint(item);
      return item;
    } catch (error) {
      if (!(error instanceof UsageCheckpointConflictError)) throw error;
      const existing = await options.repository.getCheckpoint(internalProjectId, subjectDigest);
      if (existing && existing.byteSize === byteSize && existing.openedAt === openedAt)
        return existing;
      throw new StorageEvidenceConflictError();
    }
  }

  async function moveStorage(
    input: {
      internalProjectId: string;
      storageSubjectId: string;
      byteSize: bigint;
      through: string;
    },
    close: boolean,
  ): Promise<StorageCheckpointItem> {
    const internalProjectId = InternalProjectIdSchema.parse(input.internalProjectId);
    const subjectDigest = storageSubjectDigest(
      internalProjectId,
      SubjectIdSchema.parse(input.storageSubjectId),
    );
    const byteSize = assertDynamoInteger(input.byteSize);
    const through = canonicalTimestamp(input.through);
    return retry(
      async () => {
        const checkpoint = await options.repository.getCheckpoint(internalProjectId, subjectDigest);
        if (!checkpoint) throw new StorageCheckpointNotFoundError();
        if (checkpoint.byteSize !== byteSize) throw new StorageEvidenceConflictError();
        if (checkpoint.status === "closed") {
          if (close && checkpoint.closedAt === through) return checkpoint;
          throw new StorageEvidenceConflictError();
        }
        if (milliseconds(through) < milliseconds(checkpoint.checkpointedThrough))
          throw new StorageEvidenceConflictError();
        if (through === checkpoint.checkpointedThrough && !close) return checkpoint;
        const versions = await options.repository.listPriceVersions();
        const segments = splitStorageInterval({
          subjectDigest,
          byteSize,
          startAt: checkpoint.checkpointedThrough,
          endAt: through,
          priceVersions: versions,
        });
        for (const segment of segments) {
          await recordUsage({
            internalProjectId,
            metric: "s3-storage-byte-milliseconds",
            quantityAtoms: segment.quantityAtoms,
            sourceKind: "storage-checkpoint",
            sourceId: segment.sourceId,
            occurredAt: segment.startAt,
          });
        }
        const next: StorageCheckpointItem = {
          ...checkpoint,
          status: close ? "closed" : "active",
          checkpointedThrough: through,
          revision: checkpoint.revision + 1n,
          ...(close ? { closedAt: through, expiresAt: ledgerExpiry(through) } : {}),
        };
        await options.repository.replaceCheckpoint(next, checkpoint.revision);
        return next;
      },
      (error) => error instanceof UsageCheckpointConflictError,
    );
  }

  function freshness(watermarks: WatermarkItem[], evaluatedAt: string, policy: FreshnessPolicy) {
    const required = Object.entries(policy.requiredSources);
    for (const [source, maxAge] of required) {
      SourceKindSchema.parse(source);
      if (!Number.isSafeInteger(maxAge) || maxAge < 0)
        throw new RangeError("Freshness ages must be non-negative integers");
    }
    const relevant = required
      .map(([source]) => watermarks.find((watermark) => watermark.sourceKind === source))
      .filter((value): value is WatermarkItem => value !== undefined);
    const lastMeteredAt =
      relevant.length === 0
        ? null
        : [...relevant].sort((left, right) =>
            left.lastMeteredAt.localeCompare(right.lastMeteredAt),
          )[0]!.lastMeteredAt;
    if (relevant.some((watermark) => watermark.incompleteSince !== null))
      return { state: "incomplete" as const, lastMeteredAt, evaluatedAt };
    const stale = required.some(([source, maxAge]) => {
      const item = watermarks.find((watermark) => watermark.sourceKind === source);
      return item ? milliseconds(evaluatedAt) - milliseconds(item.lastMeteredAt) > maxAge : false;
    });
    if (stale) return { state: "stale" as const, lastMeteredAt, evaluatedAt };
    if (required.length > 0 && relevant.length === required.length)
      return { state: "fresh" as const, lastMeteredAt, evaluatedAt };
    return { state: "not-yet-metered" as const, lastMeteredAt, evaluatedAt };
  }

  async function getMonthlyProjection(
    internalProjectIdInput: string,
    periodInput: string,
    evaluatedAtInput: string,
    policy: FreshnessPolicy,
  ): Promise<MonthlyUsageProjection> {
    const internalProjectId = InternalProjectIdSchema.parse(internalProjectIdInput);
    const period = UsagePeriodSchema.parse(periodInput);
    const evaluatedAt = canonicalTimestamp(evaluatedAtInput);
    const [aggregates, watermarks] = await Promise.all([
      options.repository.getAggregates(internalProjectId, period),
      options.repository.listWatermarks(internalProjectId),
    ]);
    const metricItems = aggregates.filter(
      (item): item is MetricAggregateItem => item.itemType === "usage-aggregate-metric",
    );
    const total = aggregates.find(
      (item): item is TotalAggregateItem => item.itemType === "usage-aggregate-total",
    );
    const summedCost = metricItems.reduce(
      (sum, item) => addDynamoIntegers(sum, item.costAtoms),
      0n,
    );
    if (total && total.costAtoms !== summedCost)
      throw new Error("Usage aggregate total is inconsistent");
    const metrics = USAGE_METRICS.map((metric) => {
      const item = metricItems.find((candidate) => candidate.metric === metric);
      return {
        metric,
        quantity: formatScaledUnsigned(item?.quantityAtoms ?? 0n, 0),
        costUsd: formatAttoUsd(item?.costAtoms ?? 0n),
        priceVersionIds: [...(item?.priceVersionIds ?? new Set<string>())].sort(),
      };
    });
    const priceVersionIds = [
      ...new Set(metricItems.flatMap((item) => [...item.priceVersionIds])),
    ].sort();
    return MonthlyUsageProjectionSchema.parse({
      label: USAGE_COST_LABEL,
      currency: "USD",
      period,
      totalCostUsd: formatAttoUsd(total?.costAtoms ?? summedCost),
      metrics,
      priceVersionIds,
      exclusions: [...USAGE_COST_EXCLUSIONS],
      freshness: freshness(watermarks, evaluatedAt, policy),
    });
  }

  function rebuildItems(
    internalProjectId: string,
    period: string,
    events: UsageEventItem[],
  ): AggregateItem[] {
    const pk = projectMonthPartitionKey(internalProjectId, period);
    const metrics: MetricAggregateItem[] = USAGE_METRICS.map((metric) => {
      const matching = events.filter((event) => event.metric === metric);
      return {
        pk,
        sk: metricAggregateSortKey(metric),
        itemType: "usage-aggregate-metric",
        internalProjectId,
        period,
        metric,
        quantityAtoms: matching.reduce(
          (total, event) => addDynamoIntegers(total, event.quantityAtoms),
          0n,
        ),
        costAtoms: matching.reduce((total, event) => addDynamoIntegers(total, event.costAtoms), 0n),
        revision: BigInt(matching.length),
        priceVersionIds: new Set(matching.map((event) => event.priceVersionId)),
      };
    });
    const total: TotalAggregateItem = {
      pk,
      sk: TOTAL_AGGREGATE_SORT_KEY,
      itemType: "usage-aggregate-total",
      internalProjectId,
      period,
      costAtoms: events.reduce((sum, event) => addDynamoIntegers(sum, event.costAtoms), 0n),
      revision: BigInt(events.length),
      priceVersionIds: new Set(events.map((event) => event.priceVersionId)),
    };
    return [...metrics, total];
  }

  async function rebuildMonthlyProjection(
    internalProjectIdInput: string,
    periodInput: string,
    evaluatedAt: string,
    policy: FreshnessPolicy,
  ): Promise<MonthlyUsageProjection> {
    const internalProjectId = InternalProjectIdSchema.parse(internalProjectIdInput);
    const period = UsagePeriodSchema.parse(periodInput);
    await retry(
      async () => {
        const previous = await options.repository.getAggregates(internalProjectId, period);
        const revisions = new Map(previous.map((item) => [item.sk, item.revision]));
        const events = await options.repository.listEvents(internalProjectId, period);
        if (
          events.some(
            (event) => event.internalProjectId !== internalProjectId || event.period !== period,
          )
        )
          throw new Error("Authoritative usage events escaped their project/month boundary");
        await options.repository.replaceAggregates(
          rebuildItems(internalProjectId, period, events),
          revisions,
        );
      },
      (error) => error instanceof UsageProjectionConflictError,
    );
    return getMonthlyProjection(internalProjectId, period, evaluatedAt, policy);
  }

  return Object.freeze({
    recordUsage,
    observeDownloadEvidence,
    recordDownloadEvidence,
    openStorage,
    checkpointStorageThrough: (input: {
      internalProjectId: string;
      storageSubjectId: string;
      byteSize: bigint;
      through: string;
    }) => moveStorage(input, false),
    closeStorage: (input: {
      internalProjectId: string;
      storageSubjectId: string;
      byteSize: bigint;
      through: string;
    }) => moveStorage(input, true),
    getMonthlyProjection,
    rebuildMonthlyProjection,
    quarantine,
    quarantineDownloadEvidence,
  });
}
