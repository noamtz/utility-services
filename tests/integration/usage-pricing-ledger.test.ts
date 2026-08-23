/* eslint-disable @typescript-eslint/require-await -- in-memory async repository test double */
import { USAGE_METRICS, type PriceVersion } from "@utility-services/contracts";
import { describe, expect, it } from "vitest";

import {
  BINARY_GIB_BYTES,
  formatAttoUsd,
} from "../../packages/backend/src/modules/usage-pricing/fixed-point.js";
import {
  TOTAL_AGGREGATE_SORT_KEY,
  metricAggregateSortKey,
  type DedupeItem,
  type MetricAggregateItem,
  type QuarantineItem,
  type StorageCheckpointItem,
  type TotalAggregateItem,
  type UsageEventItem,
  type WatermarkItem,
} from "../../packages/backend/src/modules/usage-pricing/model.js";
import { selectEffectivePriceVersion } from "../../packages/backend/src/modules/usage-pricing/pricing.js";
import {
  UsageCheckpointConflictError,
  UsageProjectionConflictError,
  UsageSourceConflictError,
  type AggregateItem,
  type RecordEventResult,
  type UsagePricingRepository,
} from "../../packages/backend/src/modules/usage-pricing/repository.js";
import { createUsagePricingService } from "../../packages/backend/src/modules/usage-pricing/service.js";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";

function version(id: string, effectiveAt: string, usdPerUnit: string): PriceVersion {
  return {
    versionId: id,
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
      productFamily: "integration evidence",
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
      usdPerUnit,
      sourcePricePerUnitUsd: usdPerUnit,
      effectiveAt,
      description: "integration rate",
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

class IntegrationRepository implements UsagePricingRepository {
  public readonly events = new Map<string, UsageEventItem>();
  public readonly fingerprints = new Map<string, string>();
  public readonly aggregates = new Map<string, AggregateItem>();
  public readonly checkpoints = new Map<string, StorageCheckpointItem>();
  public readonly watermarks = new Map<string, WatermarkItem>();
  public readonly quarantines: QuarantineItem[] = [];
  public constructor(private readonly prices: PriceVersion[]) {}
  public async listPriceVersions() {
    return this.prices;
  }
  public async findEffectivePrice(at: string) {
    try {
      return selectEffectivePriceVersion(this.prices, at);
    } catch {
      return undefined;
    }
  }
  public async recordEvent(event: UsageEventItem, dedupe: DedupeItem): Promise<RecordEventResult> {
    const fingerprint = this.fingerprints.get(dedupe.pk);
    if (fingerprint && fingerprint !== event.inputFingerprint) throw new UsageSourceConflictError();
    const key = `${event.pk}|${event.sk}`;
    const existing = this.events.get(key);
    if (existing) return { status: "duplicate", event: existing };
    this.fingerprints.set(dedupe.pk, event.inputFingerprint);
    this.events.set(key, event);
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
    return { status: "recorded" };
  }
  public async listEvents(project: string, period: string) {
    return [...this.events.values()].filter(
      (event) => event.internalProjectId === project && event.period === period,
    );
  }
  public async getAggregates(project: string, period: string) {
    return [...this.aggregates.values()].filter(
      (item) => item.internalProjectId === project && item.period === period,
    );
  }
  public async replaceAggregates(
    items: AggregateItem[],
    expected: ReadonlyMap<string, bigint | undefined>,
  ) {
    for (const item of items) {
      const existing = this.aggregates.get(`${item.pk}|${item.sk}`);
      if (existing?.revision !== expected.get(item.sk)) throw new UsageProjectionConflictError();
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
  public async replaceCheckpoint(item: StorageCheckpointItem, revision: bigint) {
    if (this.checkpoints.get(item.subjectDigest)?.revision !== revision)
      throw new UsageCheckpointConflictError();
    this.checkpoints.set(item.subjectDigest, item);
  }
  public async listWatermarks(project: string) {
    return [...this.watermarks.values()].filter((item) => item.internalProjectId === project);
  }
  public async advanceWatermark(project: string, source: string, at: string) {
    const key = `${project}|${source}`;
    const existing = this.watermarks.get(key);
    if (!existing || existing.lastMeteredAt <= at)
      this.watermarks.set(key, {
        pk: `PROJECT#${project}`,
        sk: `WATERMARK#${source}`,
        itemType: "usage-watermark",
        internalProjectId: project,
        sourceKind: source,
        lastMeteredAt: at,
        incompleteSince: null,
      });
  }
  public async markWatermarkIncomplete(project: string, source: string, at: string) {
    const key = `${project}|${source}`;
    const existing = this.watermarks.get(key);
    this.watermarks.set(key, {
      pk: `PROJECT#${project}`,
      sk: `WATERMARK#${source}`,
      itemType: "usage-watermark",
      internalProjectId: project,
      sourceKind: source,
      lastMeteredAt: existing?.lastMeteredAt ?? at,
      incompleteSince: at,
    });
  }
  public async putQuarantine(item: QuarantineItem) {
    this.quarantines.push(item);
  }
  public deleteAggregates(project: string, period: string) {
    for (const [key, item] of this.aggregates)
      if (item.internalProjectId === project && item.period === period) this.aggregates.delete(key);
  }
}

describe("assembled usage/pricing ledger integration boundary", () => {
  it("records, splits, isolates, rebuilds, and reports freshness without leaking internals", async () => {
    const repository = new IntegrationRepository([
      version("v1", "2026-01-01T00:00:00.000Z", "0.01"),
      version("v2", "2026-02-01T00:00:00.000Z", "0.02"),
    ]);
    const service = createUsagePricingService({
      repository,
      now: () => "2026-02-02T00:00:00.000Z",
      createId: () => "33333333-3333-4333-8333-333333333333",
    });

    const upload = {
      internalProjectId: projectA,
      metric: "s3-upload-requests" as const,
      quantityAtoms: 1n,
      sourceKind: "upload-completion",
      sourceId: "private-source-id",
      occurredAt: "2026-01-31T23:00:00.000Z",
    };
    expect((await service.recordUsage(upload)).status).toBe("recorded");
    expect((await service.recordUsage(upload)).status).toBe("duplicate");
    await service.recordUsage({ ...upload, internalProjectId: projectB });

    await service.openStorage({
      internalProjectId: projectA,
      storageSubjectId: "private-file-subject",
      byteSize: BINARY_GIB_BYTES,
      openedAt: "2026-01-31T23:59:59.000Z",
    });
    await service.closeStorage({
      internalProjectId: projectA,
      storageSubjectId: "private-file-subject",
      byteSize: BINARY_GIB_BYTES,
      through: "2026-02-01T00:00:01.000Z",
    });
    expect(
      [...repository.events.values()]
        .filter((event) => event.internalProjectId === projectA)
        .map((event) => event.period)
        .sort(),
    ).toEqual(["2026-01", "2026-01", "2026-02"]);

    const januaryEvents = await repository.listEvents(projectA, "2026-01");
    const before = await service.getMonthlyProjection(
      projectA,
      "2026-01",
      "2026-02-02T00:00:00.000Z",
      { requiredSources: {} },
    );
    expect(before.totalCostUsd).toBe(
      formatAttoUsd(januaryEvents.reduce((sum, event) => sum + event.costAtoms, 0n)),
    );
    expect(before.priceVersionIds).toEqual(["v1"]);
    repository.deleteAggregates(projectA, "2026-01");
    expect(
      (
        await service.rebuildMonthlyProjection(projectA, "2026-01", "2026-02-02T00:00:00.000Z", {
          requiredSources: {},
        })
      ).totalCostUsd,
    ).toBe(before.totalCostUsd);

    const projectBProjection = await service.getMonthlyProjection(
      projectB,
      "2026-01",
      "2026-02-02T00:00:00.000Z",
      { requiredSources: {} },
    );
    expect(
      projectBProjection.metrics.find((metric) => metric.metric === "s3-storage-byte-milliseconds")
        ?.quantity,
    ).toBe("0");

    const costBeforeQuarantine = (
      await service.getMonthlyProjection(projectA, "2026-02", "2026-02-02T00:00:00.000Z", {
        requiredSources: { cloudtrail: 86_400_000 },
      })
    ).totalCostUsd;
    await service.quarantine({
      reasonCode: "ambiguous-evidence",
      sourceKind: "cloudtrail",
      evidenceHash: "b".repeat(64),
      observedAt: "2026-02-02T00:00:00.000Z",
      internalProjectId: projectA,
    });
    const publicProjection = await service.getMonthlyProjection(
      projectA,
      "2026-02",
      "2026-02-02T00:00:00.000Z",
      { requiredSources: { cloudtrail: 86_400_000 } },
    );
    expect(publicProjection.freshness.state).toBe("incomplete");
    expect(publicProjection.totalCostUsd).toBe(costBeforeQuarantine);

    const serialized = JSON.stringify(publicProjection);
    for (const forbidden of [
      projectA,
      projectB,
      "private-source-id",
      "private-file-subject",
      "PROJECT#",
      "SOURCE#",
      "STORAGE#",
      "stack",
      "bucket",
      "objectKey",
      "token",
      "tableName",
    ])
      expect(serialized).not.toContain(forbidden);
  });
});
