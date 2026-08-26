/* eslint-disable @typescript-eslint/require-await -- in-memory integration repository */
import { gzipSync } from "node:zlib";

import { USAGE_METRICS, type PriceVersion } from "@utility-services/contracts";
import { describe, expect, it } from "vitest";

import { createCloudTrailLogReader } from "../../packages/backend/src/modules/usage-pricing/cloudtrail-log.js";
import { createDownloadMeteringService } from "../../packages/backend/src/modules/usage-pricing/download-metering.js";
import {
  DOWNLOAD_EVIDENCE_SORT_KEY,
  TOTAL_AGGREGATE_SORT_KEY,
  metricAggregateSortKey,
  type DownloadMeteringQuarantineItem,
  type MetricAggregateItem,
  type ProcessedDownloadEvidenceItem,
  type StorageCheckpointItem,
  type TotalAggregateItem,
  type UsageEventItem,
  type WatermarkItem,
} from "../../packages/backend/src/modules/usage-pricing/model.js";
import { selectEffectivePriceVersion } from "../../packages/backend/src/modules/usage-pricing/pricing.js";
import {
  UsageProjectionConflictError,
  UsageSourceConflictError,
  type AggregateItem,
  type RecordDownloadEventResult,
  type RecordEventResult,
  type UsagePricingRepository,
} from "../../packages/backend/src/modules/usage-pricing/repository.js";
import { createUsagePricingService } from "../../packages/backend/src/modules/usage-pricing/service.js";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";
const fileA = "fil_0123456789abcdefghijkl";
const fileB = "fil_mnopqrstuvwxyz01234567";
const fileBucket = "stage-private-file-bucket";
const logBucket = "stage-download-metering-logs";
const logPrefix = "AWSLogs/162067902192/CloudTrail/il-central-1/";
const logKey = `${logPrefix}2026/08/24/integration.json.gz`;
const observedAt = "2026-08-24T10:00:00.000Z";

function priceVersion(): PriceVersion {
  const effectiveAt = "2026-01-01T00:00:00.000Z";
  return {
    versionId: "integration-v1",
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
      productFamily: "integration",
      sku: "ABCDEFGH",
      rateCode: "ABCDEFGH.JRTCKXETXF.6YS6EN2CT7",
      unit: metric.includes("storage")
        ? "GB-Mo"
        : metric.includes("bytes")
          ? "GB"
          : metric.includes("events")
            ? "Events"
            : "Requests",
      unitQuantity: "1",
      beginRange: "0",
      endRange: "Inf",
      usdPerUnit: "1",
      sourcePricePerUnitUsd: "1",
      effectiveAt,
      description: "integration rate",
    })),
    sources: [
      {
        url: "https://example.com/prices",
        publicationDate: effectiveAt,
        version: "20260101000000",
        sha256: "a".repeat(64),
      },
    ],
  };
}

class IntegrationRepository implements UsagePricingRepository {
  public readonly events = new Map<string, UsageEventItem>();
  public readonly evidence = new Map<string, ProcessedDownloadEvidenceItem>();
  public readonly aggregates = new Map<string, AggregateItem>();
  public readonly watermarks = new Map<string, WatermarkItem>();
  public readonly quarantines = new Map<string, DownloadMeteringQuarantineItem>();
  public failDownloadOnce = false;
  public projectionConflictOnce = false;
  private readonly price = priceVersion();

  public async listPriceVersions() {
    return [this.price];
  }
  public async findEffectivePrice(occurredAt: string) {
    try {
      return selectEffectivePriceVersion([this.price], occurredAt);
    } catch {
      return undefined;
    }
  }
  public async recordEvent(): Promise<RecordEventResult> {
    throw new Error("generic recordEvent is outside this integration path");
  }
  public async getDownloadEvidence(eventDigest: string) {
    return this.evidence.get(eventDigest);
  }
  public async observeDownloadEvidence(item: ProcessedDownloadEvidenceItem) {
    const existing = this.evidence.get(item.eventDigest);
    if (existing && existing.fingerprint !== item.fingerprint) throw new UsageSourceConflictError();
    if (existing) return { status: "duplicate" as const, evidence: existing };
    this.evidence.set(item.eventDigest, item);
    return { status: "observed" as const, evidence: item };
  }
  public async recordDownloadEvent(
    item: ProcessedDownloadEvidenceItem,
    events: readonly [UsageEventItem, UsageEventItem, UsageEventItem],
  ): Promise<RecordDownloadEventResult> {
    if (this.failDownloadOnce) {
      this.failDownloadOnce = false;
      throw new Error("transient Dynamo failure");
    }
    const existing = this.evidence.get(item.eventDigest);
    if (existing && existing.fingerprint !== item.fingerprint) throw new UsageSourceConflictError();
    if (existing?.pricingStatus === "priced")
      return { status: "duplicate", evidence: existing, events };
    if (
      events.some((event) => {
        const stored = this.events.get(`${event.pk}|${event.sk}`);
        return stored && stored.inputFingerprint !== event.inputFingerprint;
      })
    ) {
      throw new UsageSourceConflictError();
    }
    this.evidence.set(item.eventDigest, item);
    for (const event of events) {
      const eventKey = `${event.pk}|${event.sk}`;
      if (this.events.has(eventKey)) continue;
      this.events.set(eventKey, event);
      const metricKey = `${event.pk}|${metricAggregateSortKey(event.metric)}`;
      const metric = this.aggregates.get(metricKey) as MetricAggregateItem | undefined;
      this.aggregates.set(metricKey, {
        pk: event.pk,
        sk: metricAggregateSortKey(event.metric),
        itemType: "usage-aggregate-metric",
        internalProjectId: event.internalProjectId,
        period: event.period,
        metric: event.metric,
        quantityAtoms: (metric?.quantityAtoms ?? 0n) + event.quantityAtoms,
        costAtoms: (metric?.costAtoms ?? 0n) + event.costAtoms,
        revision: (metric?.revision ?? 0n) + 1n,
        priceVersionIds: new Set([...(metric?.priceVersionIds ?? []), event.priceVersionId]),
      });
      const totalKey = `${event.pk}|${TOTAL_AGGREGATE_SORT_KEY}`;
      const total = this.aggregates.get(totalKey) as TotalAggregateItem | undefined;
      this.aggregates.set(totalKey, {
        pk: event.pk,
        sk: TOTAL_AGGREGATE_SORT_KEY,
        itemType: "usage-aggregate-total",
        internalProjectId: event.internalProjectId,
        period: event.period,
        costAtoms: (total?.costAtoms ?? 0n) + event.costAtoms,
        revision: (total?.revision ?? 0n) + 1n,
        priceVersionIds: new Set([...(total?.priceVersionIds ?? []), event.priceVersionId]),
      });
    }
    return { status: "recorded", evidence: item, events };
  }
  public async listEvents(internalProjectId: string, period: string) {
    return [...this.events.values()].filter(
      (event) => event.internalProjectId === internalProjectId && event.period === period,
    );
  }
  public async getAggregates(internalProjectId: string, period: string) {
    return [...this.aggregates.values()].filter(
      (item) => item.internalProjectId === internalProjectId && item.period === period,
    );
  }
  public async replaceAggregates(
    items: AggregateItem[],
    expected: ReadonlyMap<string, bigint | undefined>,
  ) {
    if (this.projectionConflictOnce) {
      this.projectionConflictOnce = false;
      throw new UsageProjectionConflictError();
    }
    for (const item of items) {
      const existing = this.aggregates.get(`${item.pk}|${item.sk}`);
      if (existing?.revision !== expected.get(item.sk)) throw new UsageProjectionConflictError();
    }
    for (const item of items) this.aggregates.set(`${item.pk}|${item.sk}`, item);
  }
  public async getCheckpoint(): Promise<StorageCheckpointItem | undefined> {
    return undefined;
  }
  public async createCheckpoint() {
    throw new Error("storage is outside this integration path");
  }
  public async replaceCheckpoint() {
    throw new Error("storage is outside this integration path");
  }
  public async listWatermarks(internalProjectId: string) {
    return [...this.watermarks.values()].filter(
      (item) => item.internalProjectId === internalProjectId,
    );
  }

  public async listWatermarksBefore() {
    return { items: [] };
  }
  public async advanceWatermark(internalProjectId: string, sourceKind: string, meteredAt: string) {
    const key = `${internalProjectId}|${sourceKind}`;
    const existing = this.watermarks.get(key);
    if (!existing || existing.lastMeteredAt < meteredAt) {
      this.watermarks.set(key, {
        pk: `PROJECT#${internalProjectId}`,
        sk: `WATERMARK#${sourceKind}`,
        itemType: "usage-watermark",
        internalProjectId,
        sourceKind,
        lastMeteredAt: meteredAt,
        incompleteSince: existing?.incompleteSince ?? null,
      });
    }
  }
  public async markWatermarkIncomplete(
    internalProjectId: string,
    sourceKind: string,
    incompleteAt: string,
  ) {
    const key = `${internalProjectId}|${sourceKind}`;
    const existing = this.watermarks.get(key);
    this.watermarks.set(key, {
      pk: `PROJECT#${internalProjectId}`,
      sk: `WATERMARK#${sourceKind}`,
      itemType: "usage-watermark",
      internalProjectId,
      sourceKind,
      lastMeteredAt: existing?.lastMeteredAt ?? incompleteAt,
      incompleteSince:
        !existing?.incompleteSince || incompleteAt < existing.incompleteSince
          ? incompleteAt
          : existing.incompleteSince,
    });
  }
  public async putQuarantine() {
    throw new Error("generic quarantine is outside this integration path");
  }
  public async putDownloadQuarantine(item: DownloadMeteringQuarantineItem) {
    const existing = this.quarantines.get(item.pk);
    if (existing) return { status: "duplicate" as const };
    this.quarantines.set(item.pk, item);
    return { status: "recorded" as const };
  }
}

function cloudTrailRecord(input: {
  eventId: string;
  projectId?: string;
  fileId?: string;
  bytes?: string;
  occurredAt?: string;
  failed?: boolean;
}) {
  const projectId = input.projectId ?? projectA;
  const fileId = input.fileId ?? fileA;
  return {
    eventID: input.eventId,
    eventTime: input.occurredAt ?? "2026-08-24T09:00:00.000Z",
    eventType: "AwsApiCall",
    eventSource: "s3.amazonaws.com",
    eventName: "GetObject",
    eventCategory: "Data",
    readOnly: true,
    awsRegion: "il-central-1",
    recipientAccountId: "162067902192",
    resources: [
      {
        type: "AWS::S3::Object",
        ARN: `arn:aws:s3:::${fileBucket}/projects/${projectId}/files/${fileId}`,
      },
    ],
    additionalEventData: input.bytes === undefined ? {} : { bytesTransferredOut: input.bytes },
    ...(input.failed ? { errorCode: "AccessDenied" } : {}),
  };
}

function assembled(records: unknown[]) {
  const repository = new IntegrationRepository();
  const bytes = gzipSync(JSON.stringify({ Records: records }));
  let storeFailures = 0;
  const reader = createCloudTrailLogReader({
    store: {
      async get() {
        if (storeFailures > 0) {
          storeFailures -= 1;
          throw new Error("transient log retrieval");
        }
        return bytes;
      },
    },
    logBucketName: logBucket,
    logPrefix,
    fileBucketName: fileBucket,
    accountId: "162067902192",
    region: "il-central-1",
    maxCompressedBytes: 1_000_000,
    maxInflatedBytes: 2_000_000,
    maxRecords: 100,
    now: () => observedAt,
  });
  const usage = createUsagePricingService({ repository, now: () => observedAt, maxRetries: 3 });
  return {
    repository,
    usage,
    evidenceOnly: createDownloadMeteringService({
      reader,
      usage,
      pricingMode: "evidence-only",
      now: () => observedAt,
    }),
    priced: createDownloadMeteringService({
      reader,
      usage,
      pricingMode: "priced",
      now: () => observedAt,
    }),
    failStore: (times: number) => {
      storeFailures = times;
    },
  };
}

describe("assembled download metering", () => {
  it("gates, promotes, deduplicates, quarantines, isolates projects, and rebuilds", async () => {
    const full = cloudTrailRecord({
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      bytes: "100",
    });
    const records = [
      full,
      cloudTrailRecord({ eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", bytes: "10" }),
      cloudTrailRecord({ eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", bytes: "0" }),
      cloudTrailRecord({ eventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", bytes: "5" }),
      full,
      cloudTrailRecord({
        eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        projectId: projectB,
        fileId: fileB,
        bytes: "7",
      }),
      cloudTrailRecord({
        eventId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        projectId: projectB,
        fileId: fileB,
      }),
      cloudTrailRecord({
        eventId: "99999999-9999-4999-8999-999999999999",
        failed: true,
      }),
    ];
    const { repository, usage, evidenceOnly, priced } = assembled(records);
    const gated = await evidenceOnly.processQueueLog(logKey);
    expect(gated).toMatchObject({
      accepted: 6,
      observed: 5,
      duplicates: 1,
      quarantined: 2,
      recorded: 0,
    });
    expect(repository.events).toHaveLength(0);
    expect(repository.evidence).toHaveLength(5);
    expect(
      [...repository.evidence.values()].every((item) => item.sk === DOWNLOAD_EVIDENCE_SORT_KEY),
    ).toBe(true);
    expect([...repository.evidence.values()].every((item) => item.expiresAt > 0n)).toBe(true);

    const promoted = await priced.reconcileLogKeys([logKey]);
    expect(promoted).toMatchObject({ recorded: 5, duplicates: 1, rebuiltPeriods: 2 });
    expect(repository.events).toHaveLength(15);
    const projectAEvents = [...repository.events.values()].filter(
      (event) => event.internalProjectId === projectA,
    );
    const projectBEvents = [...repository.events.values()].filter(
      (event) => event.internalProjectId === projectB,
    );
    expect(projectAEvents).toHaveLength(12);
    expect(projectBEvents).toHaveLength(3);
    const quantity = (project: string, metric: string) =>
      [...repository.events.values()]
        .filter((event) => event.internalProjectId === project && event.metric === metric)
        .reduce((sum, event) => sum + event.quantityAtoms, 0n);
    expect(quantity(projectA, "s3-download-requests")).toBe(4n);
    expect(quantity(projectA, "s3-download-bytes-out")).toBe(115n);
    expect(quantity(projectA, "cloudtrail-s3-data-events")).toBe(4n);
    expect(quantity(projectB, "s3-download-requests")).toBe(1n);
    expect(quantity(projectB, "s3-download-bytes-out")).toBe(7n);
    expect(repository.quarantines).toHaveLength(2);
    expect(repository.watermarks.get(`${projectB}|cloudtrail-download`)?.incompleteSince).toBe(
      "2026-08-24T09:00:00.000Z",
    );

    const beforeA = await usage.getMonthlyProjection(projectA, "2026-08", observedAt, {
      requiredSources: {},
    });
    repository.aggregates.clear();
    repository.projectionConflictOnce = true;
    const replayed = await priced.reconcileLogKeys([logKey]);
    expect(replayed).toMatchObject({ recorded: 0, duplicates: 6, rebuiltPeriods: 2 });
    expect(repository.events).toHaveLength(15);
    const rebuiltA = await usage.getMonthlyProjection(projectA, "2026-08", observedAt, {
      requiredSources: {},
    });
    expect(rebuiltA.totalCostUsd).toBe(beforeA.totalCostUsd);
    expect(rebuiltA.metrics).toEqual(beforeA.metrics);
    expect([...repository.aggregates.values()].every((item) => !("expiresAt" in item))).toBe(true);
    expect([...repository.events.values()].every((event) => event.expiresAt > 0n)).toBe(true);
  });

  it("models retry exhaustion, DLQ visibility, and idempotent redrive after recovery", async () => {
    const records = [
      cloudTrailRecord({ eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bytes: "100" }),
    ];
    const { repository, priced, failStore } = assembled(records);
    const mainQueue = [logKey];
    const deadLetterQueue: string[] = [];
    failStore(2);
    for (let receive = 0; receive < 2; receive += 1) {
      try {
        await priced.processQueueLog(mainQueue[0]!);
        mainQueue.shift();
      } catch {
        if (receive === 1) deadLetterQueue.push(mainQueue.shift()!);
      }
    }
    expect(mainQueue).toHaveLength(0);
    expect(deadLetterQueue).toEqual([logKey]);
    mainQueue.push(deadLetterQueue.shift()!);
    await priced.processQueueLog(mainQueue.shift()!);
    expect(repository.events).toHaveLength(3);
    mainQueue.push(logKey);
    await priced.processQueueLog(mainQueue.shift()!);
    expect(repository.events).toHaveLength(3);
    expect(deadLetterQueue).toHaveLength(0);
  });
});
