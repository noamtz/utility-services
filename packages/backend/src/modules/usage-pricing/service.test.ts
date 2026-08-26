/* eslint-disable @typescript-eslint/require-await -- in-memory async repository test double */
import { USAGE_METRICS, type PriceVersion } from "@utility-services/contracts";
import { describe, expect, it } from "vitest";

import { BINARY_GIB_BYTES } from "./fixed-point.js";
import {
  metricAggregateSortKey,
  TOTAL_AGGREGATE_SORT_KEY,
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
import { selectEffectivePriceVersion } from "./pricing.js";
import {
  UsageCheckpointConflictError,
  UsageProjectionConflictError,
  UsageSourceConflictError,
  type AggregateItem,
  type RecordEventResult,
  type RecordDownloadEventResult,
  type UsagePricingRepository,
} from "./repository.js";
import { StorageEvidenceConflictError, createUsagePricingService } from "./service.js";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-20T00:00:00.000Z";

function priceVersion(versionId: string, effectiveAt: string, multiplier = "1"): PriceVersion {
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
      productFamily: "test",
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
      usdPerUnit: multiplier,
      sourcePricePerUnitUsd: multiplier,
      effectiveAt,
      description: "test rate",
    })),
    sources: [
      {
        url: "https://example.com",
        publicationDate: effectiveAt,
        version: effectiveAt.replace(/\D/gu, "").slice(0, 14),
        sha256: "a".repeat(64),
      },
    ],
  };
}

class MemoryRepository implements UsagePricingRepository {
  public readonly events = new Map<string, UsageEventItem>();
  public readonly sourceFingerprints = new Map<string, string>();
  public readonly aggregates = new Map<string, AggregateItem>();
  public readonly checkpoints = new Map<string, StorageCheckpointItem>();
  public readonly watermarks = new Map<string, WatermarkItem>();
  public readonly quarantines: QuarantineItem[] = [];
  public readonly downloadEvidence = new Map<string, ProcessedDownloadEvidenceItem>();
  public readonly downloadQuarantines = new Map<string, DownloadMeteringQuarantineItem>();
  public failWatermarkOnce = false;
  public failAfterRecordOnce = false;
  public projectionConflictOnce = false;
  public checkpointConflictOnce = false;
  public downloadFailureOnce = false;
  public constructor(public readonly prices: PriceVersion[]) {}

  public async listPriceVersions() {
    return this.prices;
  }
  public async findEffectivePrice(occurredAt: string) {
    try {
      return selectEffectivePriceVersion(this.prices, occurredAt);
    } catch {
      return undefined;
    }
  }
  public async recordEvent(event: UsageEventItem, dedupe: DedupeItem): Promise<RecordEventResult> {
    const sourceKey = dedupe.pk;
    const existingFingerprint = this.sourceFingerprints.get(sourceKey);
    const existingEvent = this.events.get(`${event.pk}|${event.sk}`);
    if (existingFingerprint && existingFingerprint !== event.inputFingerprint)
      throw new UsageSourceConflictError();
    if (existingEvent) return { status: "duplicate", event: existingEvent };
    this.sourceFingerprints.set(sourceKey, event.inputFingerprint);
    this.events.set(`${event.pk}|${event.sk}`, event);
    const metricKey = `${event.pk}|${metricAggregateSortKey(event.metric)}`;
    const previousMetric = this.aggregates.get(metricKey) as MetricAggregateItem | undefined;
    this.aggregates.set(metricKey, {
      pk: event.pk,
      sk: metricAggregateSortKey(event.metric),
      itemType: "usage-aggregate-metric",
      internalProjectId: event.internalProjectId,
      period: event.period,
      metric: event.metric,
      quantityAtoms: (previousMetric?.quantityAtoms ?? 0n) + event.quantityAtoms,
      costAtoms: (previousMetric?.costAtoms ?? 0n) + event.costAtoms,
      revision: (previousMetric?.revision ?? 0n) + 1n,
      priceVersionIds: new Set([...(previousMetric?.priceVersionIds ?? []), event.priceVersionId]),
    });
    const totalKey = `${event.pk}|${TOTAL_AGGREGATE_SORT_KEY}`;
    const previousTotal = this.aggregates.get(totalKey) as TotalAggregateItem | undefined;
    this.aggregates.set(totalKey, {
      pk: event.pk,
      sk: TOTAL_AGGREGATE_SORT_KEY,
      itemType: "usage-aggregate-total",
      internalProjectId: event.internalProjectId,
      period: event.period,
      costAtoms: (previousTotal?.costAtoms ?? 0n) + event.costAtoms,
      revision: (previousTotal?.revision ?? 0n) + 1n,
      priceVersionIds: new Set([...(previousTotal?.priceVersionIds ?? []), event.priceVersionId]),
    });
    if (this.failAfterRecordOnce) {
      this.failAfterRecordOnce = false;
      throw new Error("simulated crash after durable record");
    }
    return { status: "recorded" };
  }
  public async getDownloadEvidence(eventDigest: string) {
    return this.downloadEvidence.get(eventDigest);
  }
  public async observeDownloadEvidence(evidence: ProcessedDownloadEvidenceItem) {
    const existing = this.downloadEvidence.get(evidence.eventDigest);
    if (existing && existing.fingerprint !== evidence.fingerprint)
      throw new UsageSourceConflictError();
    if (existing) return { status: "duplicate" as const, evidence: existing };
    this.downloadEvidence.set(evidence.eventDigest, evidence);
    return { status: "observed" as const, evidence };
  }
  public async recordDownloadEvent(
    evidence: ProcessedDownloadEvidenceItem,
    events: readonly [UsageEventItem, UsageEventItem, UsageEventItem],
  ): Promise<RecordDownloadEventResult> {
    if (this.downloadFailureOnce) {
      this.downloadFailureOnce = false;
      throw new Error("simulated atomic failure");
    }
    const existing = this.downloadEvidence.get(evidence.eventDigest);
    if (existing && existing.fingerprint !== evidence.fingerprint)
      throw new UsageSourceConflictError();
    if (existing?.pricingStatus === "priced") {
      return { status: "duplicate", evidence: existing, events };
    }
    for (const event of events) {
      const existingEvent = this.events.get(`${event.pk}|${event.sk}`);
      if (existingEvent && existingEvent.inputFingerprint !== event.inputFingerprint)
        throw new UsageSourceConflictError();
    }
    this.downloadEvidence.set(evidence.eventDigest, evidence);
    for (const event of events) {
      const key = `${event.pk}|${event.sk}`;
      if (this.events.has(key)) continue;
      this.events.set(key, event);
      const metricKey = `${event.pk}|${metricAggregateSortKey(event.metric)}`;
      const previousMetric = this.aggregates.get(metricKey) as MetricAggregateItem | undefined;
      this.aggregates.set(metricKey, {
        pk: event.pk,
        sk: metricAggregateSortKey(event.metric),
        itemType: "usage-aggregate-metric",
        internalProjectId: event.internalProjectId,
        period: event.period,
        metric: event.metric,
        quantityAtoms: (previousMetric?.quantityAtoms ?? 0n) + event.quantityAtoms,
        costAtoms: (previousMetric?.costAtoms ?? 0n) + event.costAtoms,
        revision: (previousMetric?.revision ?? 0n) + 1n,
        priceVersionIds: new Set([
          ...(previousMetric?.priceVersionIds ?? []),
          event.priceVersionId,
        ]),
      });
      const totalKey = `${event.pk}|${TOTAL_AGGREGATE_SORT_KEY}`;
      const previousTotal = this.aggregates.get(totalKey) as TotalAggregateItem | undefined;
      this.aggregates.set(totalKey, {
        pk: event.pk,
        sk: TOTAL_AGGREGATE_SORT_KEY,
        itemType: "usage-aggregate-total",
        internalProjectId: event.internalProjectId,
        period: event.period,
        costAtoms: (previousTotal?.costAtoms ?? 0n) + event.costAtoms,
        revision: (previousTotal?.revision ?? 0n) + 1n,
        priceVersionIds: new Set([...(previousTotal?.priceVersionIds ?? []), event.priceVersionId]),
      });
    }
    return { status: "recorded", evidence, events };
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
      const key = `${item.pk}|${item.sk}`;
      if (this.aggregates.get(key)?.revision !== expected.get(item.sk))
        throw new UsageProjectionConflictError();
    }
    for (const item of items) this.aggregates.set(`${item.pk}|${item.sk}`, item);
  }
  public async getCheckpoint(_project: string, digest: string) {
    return this.checkpoints.get(digest);
  }
  public async createCheckpoint(item: StorageCheckpointItem) {
    if (this.checkpoints.has(item.subjectDigest)) throw new UsageCheckpointConflictError();
    this.checkpoints.set(item.subjectDigest, item);
  }
  public async replaceCheckpoint(item: StorageCheckpointItem, expectedRevision: bigint) {
    if (this.checkpointConflictOnce) {
      this.checkpointConflictOnce = false;
      throw new UsageCheckpointConflictError();
    }
    const existing = this.checkpoints.get(item.subjectDigest);
    if (existing?.revision !== expectedRevision) throw new UsageCheckpointConflictError();
    this.checkpoints.set(item.subjectDigest, item);
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
    if (this.failWatermarkOnce) {
      this.failWatermarkOnce = false;
      throw new Error("watermark unavailable");
    }
    const key = `${internalProjectId}|${sourceKind}`;
    const existing = this.watermarks.get(key);
    if (!existing || existing.lastMeteredAt < meteredAt)
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
  public async markWatermarkIncomplete(
    internalProjectId: string,
    sourceKind: string,
    observedAt: string,
  ) {
    const key = `${internalProjectId}|${sourceKind}`;
    const existing = this.watermarks.get(key);
    this.watermarks.set(key, {
      pk: `PROJECT#${internalProjectId}`,
      sk: `WATERMARK#${sourceKind}`,
      itemType: "usage-watermark",
      internalProjectId,
      sourceKind,
      lastMeteredAt: existing?.lastMeteredAt ?? observedAt,
      incompleteSince: existing?.incompleteSince ?? observedAt,
    });
  }
  public async putQuarantine(item: QuarantineItem) {
    this.quarantines.push(item);
  }
  public async putDownloadQuarantine(item: DownloadMeteringQuarantineItem) {
    const existing = this.downloadQuarantines.get(item.pk);
    if (existing && existing.reasonCode !== item.reasonCode) throw new UsageSourceConflictError();
    if (existing) return { status: "duplicate" as const };
    this.downloadQuarantines.set(item.pk, item);
    return { status: "recorded" as const };
  }
}

function setup(
  repository = new MemoryRepository([priceVersion("v1", "2026-01-01T00:00:00.000Z")]),
) {
  return {
    repository,
    service: createUsagePricingService({
      repository,
      now: () => now,
      createId: () => "33333333-3333-4333-8333-333333333333",
      maxRetries: 3,
    }),
  };
}

describe("usage pricing service record policy", () => {
  const downloadInput = {
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    internalProjectId: projectA,
    fileId: "fil_0123456789abcdefghijkl",
    occurredAt: "2026-08-10T00:00:00.000Z",
    bytesTransferredOut: 42n,
    accountId: "162067902192",
    region: "il-central-1",
    rawLogDigest: "d".repeat(64),
  } as const;

  it("observes evidence without ledger, aggregates, or freshness and promotes once later", async () => {
    const { repository, service } = setup();
    await expect(service.observeDownloadEvidence(downloadInput)).resolves.toMatchObject({
      status: "observed",
      bytesTransferredOut: 42n,
    });
    expect(repository.events).toHaveLength(0);
    expect(repository.aggregates).toHaveLength(0);
    expect(repository.watermarks).toHaveLength(0);
    await expect(service.recordDownloadEvidence(downloadInput)).resolves.toMatchObject({
      status: "recorded",
      occurredAt: downloadInput.occurredAt,
    });
    await expect(service.recordDownloadEvidence(downloadInput)).resolves.toMatchObject({
      status: "duplicate",
    });
    expect(repository.events).toHaveLength(3);
    expect(
      [...repository.events.values()].map((event) => [event.metric, event.quantityAtoms]),
    ).toEqual([
      ["s3-download-requests", 1n],
      ["s3-download-bytes-out", 42n],
      ["cloudtrail-s3-data-events", 1n],
    ]);
    expect(
      [...repository.events.values()].every(
        (event) => event.occurredAt === downloadInput.occurredAt,
      ),
    ).toBe(true);
  });

  it("keeps the three download metrics atomic and preserves incomplete freshness", async () => {
    const { repository, service } = setup();
    repository.downloadFailureOnce = true;
    await expect(service.recordDownloadEvidence(downloadInput)).rejects.toThrow(
      "simulated atomic failure",
    );
    expect(repository.events).toHaveLength(0);
    await service.quarantineDownloadEvidence({
      reasonCode: "missing-bytes",
      evidenceHash: "e".repeat(64),
      observedAt: "2026-08-09T00:00:00.000Z",
      internalProjectId: projectA,
    });
    await service.recordDownloadEvidence(downloadInput);
    const watermark = repository.watermarks.get(`${projectA}|cloudtrail-download`);
    expect(watermark?.lastMeteredAt).toBe(downloadInput.occurredAt);
    expect(watermark?.incompleteSince).toBe("2026-08-09T00:00:00.000Z");
    expect(repository.downloadQuarantines).toHaveLength(1);
  });

  it("records once, no-ops exact duplicates, and isolates projects with the same source string", async () => {
    const { repository, service } = setup();
    const input = {
      internalProjectId: projectA,
      metric: "s3-upload-requests" as const,
      quantityAtoms: 2n,
      sourceKind: "upload-completion",
      sourceId: "same-source",
      occurredAt: "2026-08-10T00:00:00.000Z",
    };
    expect((await service.recordUsage(input)).status).toBe("recorded");
    expect((await service.recordUsage(input)).status).toBe("duplicate");
    expect((await service.recordUsage({ ...input, internalProjectId: projectB })).status).toBe(
      "recorded",
    );
    expect(repository.events).toHaveLength(2);
  });

  it("quarantines divergent source reuse without another charge", async () => {
    const { repository, service } = setup();
    const input = {
      internalProjectId: projectA,
      metric: "s3-upload-requests" as const,
      quantityAtoms: 1n,
      sourceKind: "upload-completion",
      sourceId: "source",
      occurredAt: "2026-08-10T00:00:00.000Z",
    };
    await service.recordUsage(input);
    await expect(service.recordUsage({ ...input, quantityAtoms: 2n })).rejects.toBeInstanceOf(
      UsageSourceConflictError,
    );
    expect(repository.events).toHaveLength(1);
    expect(repository.quarantines).toHaveLength(1);
    expect(repository.watermarks.get(`${projectA}|upload-completion`)?.incompleteSince).toBe(now);
  });

  it("selects price by occurrence rather than processing time and preserves history", async () => {
    const repository = new MemoryRepository([
      priceVersion("v1", "2026-01-01T00:00:00.000Z", "1"),
      priceVersion("v2", "2026-08-15T00:00:00.000Z", "2"),
    ]);
    const { service } = setup(repository);
    const first = await service.recordUsage({
      internalProjectId: projectA,
      metric: "s3-upload-requests",
      quantityAtoms: 1n,
      sourceKind: "upload",
      sourceId: "before",
      occurredAt: "2026-08-14T23:59:59.999Z",
    });
    const second = await service.recordUsage({
      internalProjectId: projectA,
      metric: "s3-upload-requests",
      quantityAtoms: 1n,
      sourceKind: "upload",
      sourceId: "after",
      occurredAt: "2026-08-15T00:00:00.000Z",
    });
    expect(first.priceVersionId).toBe("v1");
    expect(second.priceVersionId).toBe("v2");
    expect(first.costAtoms).toBe(1_000_000_000_000_000_000n);
  });

  it("repairs a separately failed watermark without duplicate cost", async () => {
    const { repository, service } = setup();
    repository.failWatermarkOnce = true;
    await service.recordUsage({
      internalProjectId: projectA,
      metric: "s3-download-requests",
      quantityAtoms: 1n,
      sourceKind: "cloudtrail",
      sourceId: "event",
      occurredAt: "2026-08-10T00:00:00.000Z",
    });
    expect(repository.events).toHaveLength(1);
    expect(repository.watermarks.get(`${projectA}|cloudtrail`)?.lastMeteredAt).toBe(
      "2026-08-10T00:00:00.000Z",
    );
  });
});

describe("usage pricing service storage checkpoints", () => {
  it("opens idempotently, checkpoints, continues through trash-like time, and closes once", async () => {
    const { repository, service } = setup();
    const opened = await service.openStorage({
      internalProjectId: projectA,
      storageSubjectId: "file-1",
      byteSize: BINARY_GIB_BYTES,
      openedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(
      (
        await service.openStorage({
          internalProjectId: projectA,
          storageSubjectId: "file-1",
          byteSize: BINARY_GIB_BYTES,
          openedAt: "2026-08-01T00:00:00.000Z",
        })
      ).subjectDigest,
    ).toBe(opened.subjectDigest);
    expect(
      (
        await service.checkpointStorageThrough({
          internalProjectId: projectA,
          storageSubjectId: "file-1",
          byteSize: BINARY_GIB_BYTES,
          through: "2026-08-10T00:00:00.000Z",
        })
      ).status,
    ).toBe("active");
    const closed = await service.closeStorage({
      internalProjectId: projectA,
      storageSubjectId: "file-1",
      byteSize: BINARY_GIB_BYTES,
      through: "2026-08-20T00:00:00.000Z",
    });
    expect(closed.status).toBe("closed");
    expect(
      (
        await service.closeStorage({
          internalProjectId: projectA,
          storageSubjectId: "file-1",
          byteSize: BINARY_GIB_BYTES,
          through: "2026-08-20T00:00:00.000Z",
        })
      ).revision,
    ).toBe(closed.revision);
    expect(repository.events.size).toBeGreaterThanOrEqual(2);
  });

  it("splits storage across month/rate boundaries and retries checkpoint races exactly", async () => {
    const repository = new MemoryRepository([
      priceVersion("v1", "2026-01-01T00:00:00.000Z"),
      priceVersion("v2", "2026-02-01T00:00:00.000Z"),
    ]);
    const { service } = setup(repository);
    await service.openStorage({
      internalProjectId: projectA,
      storageSubjectId: "file",
      byteSize: 1n,
      openedAt: "2026-01-31T23:59:59.000Z",
    });
    repository.checkpointConflictOnce = true;
    await service.checkpointStorageThrough({
      internalProjectId: projectA,
      storageSubjectId: "file",
      byteSize: 1n,
      through: "2026-02-01T00:00:01.000Z",
    });
    expect([...repository.events.values()].map((event) => event.period).sort()).toEqual([
      "2026-01",
      "2026-02",
    ]);
    expect(repository.events).toHaveLength(2);
  });

  it("rejects out-of-order, size-mismatched, and conflicting duplicate evidence", async () => {
    const { service } = setup();
    await service.openStorage({
      internalProjectId: projectA,
      storageSubjectId: "file",
      byteSize: 1n,
      openedAt: "2026-08-10T00:00:00.000Z",
    });
    await expect(
      service.openStorage({
        internalProjectId: projectA,
        storageSubjectId: "file",
        byteSize: 2n,
        openedAt: "2026-08-10T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(StorageEvidenceConflictError);
    await expect(
      service.checkpointStorageThrough({
        internalProjectId: projectA,
        storageSubjectId: "file",
        byteSize: 1n,
        through: "2026-08-09T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(StorageEvidenceConflictError);
  });
});

describe("usage pricing service projection, rebuild, and freshness", () => {
  const policy = { requiredSources: { cloudtrail: 86_400_000 } };

  it("returns exact zero-cost not-yet-metered and fresh projections", async () => {
    const { repository, service } = setup();
    const empty = await service.getMonthlyProjection(projectA, "2026-08", now, policy);
    expect(empty).toMatchObject({
      label: "AWS-equivalent usage cost",
      currency: "USD",
      totalCostUsd: "0",
      freshness: { state: "not-yet-metered", lastMeteredAt: null },
    });
    await repository.advanceWatermark(projectA, "cloudtrail", now);
    expect(
      (await service.getMonthlyProjection(projectA, "2026-08", now, policy)).freshness.state,
    ).toBe("fresh");
  });

  it("shows stale and incomplete states without changing accumulated cost", async () => {
    const { repository, service } = setup();
    await service.recordUsage({
      internalProjectId: projectA,
      metric: "s3-download-requests",
      quantityAtoms: 1n,
      sourceKind: "cloudtrail",
      sourceId: "one",
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const stale = await service.getMonthlyProjection(projectA, "2026-08", now, policy);
    expect(stale.freshness.state).toBe("stale");
    const cost = stale.totalCostUsd;
    await service.quarantine({
      reasonCode: "ambiguous-source",
      sourceKind: "cloudtrail",
      evidenceHash: "b".repeat(64),
      observedAt: now,
      internalProjectId: projectA,
    });
    const incomplete = await service.getMonthlyProjection(projectA, "2026-08", now, policy);
    expect(incomplete.freshness.state).toBe("incomplete");
    expect(incomplete.totalCostUsd).toBe(cost);
    expect(repository.quarantines).toHaveLength(1);
  });

  it("rebuilds deleted aggregates from authoritative events and retries a race", async () => {
    const { repository, service } = setup();
    await service.recordUsage({
      internalProjectId: projectA,
      metric: "s3-upload-requests",
      quantityAtoms: 2n,
      sourceKind: "upload",
      sourceId: "one",
      occurredAt: "2026-08-10T00:00:00.000Z",
    });
    const before = await service.getMonthlyProjection(projectA, "2026-08", now, {
      requiredSources: {},
    });
    repository.aggregates.clear();
    repository.projectionConflictOnce = true;
    const rebuilt = await service.rebuildMonthlyProjection(projectA, "2026-08", now, {
      requiredSources: {},
    });
    expect(rebuilt.totalCostUsd).toBe(before.totalCostUsd);
    expect(rebuilt.metrics).toHaveLength(USAGE_METRICS.length);
  });
});
