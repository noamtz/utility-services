import { describe, expect, it, vi } from "vitest";

import type { InvocationMetrics } from "../../core/observability/metrics.js";
import { runFreshnessCheck } from "./freshness-monitor.js";
import { watermarkIndexPartitionKey, watermarkIndexSortKey, type WatermarkItem } from "./model.js";

const now = "2026-08-26T00:00:00.000Z";
const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";

function watermark(
  projectId: string,
  lastMeteredAt: string,
  incompleteSince: string | null,
): WatermarkItem {
  return {
    pk: `PROJECT#${projectId}`,
    sk: "WATERMARK#cloudtrail-download",
    itemType: "usage-watermark",
    internalProjectId: projectId,
    sourceKind: "cloudtrail-download",
    lastMeteredAt,
    incompleteSince,
    gsi1pk: watermarkIndexPartitionKey("cloudtrail-download"),
    gsi1sk: watermarkIndexSortKey(lastMeteredAt, projectId),
  };
}

function metrics() {
  return {
    count: vi.fn(),
    gauge: vi.fn(),
    flush: vi.fn(),
  } satisfies InvocationMetrics;
}

describe("metering freshness monitor", () => {
  it("emits stale, incomplete, and success gauges from paginated index queries", async () => {
    const records = [
      watermark(projectA, "2026-08-24T00:00:00.000Z", null),
      watermark(projectB, "2026-08-25T12:00:00.000Z", "2026-08-25T13:00:00.000Z"),
    ];
    const repository = {
      listWatermarksBefore: vi.fn(
        (_source: string, cutoff: string, cursor?: Record<string, unknown>) => {
          const matching = records.filter((item) => item.lastMeteredAt < cutoff);
          if (!cursor && matching.length > 1) {
            return Promise.resolve({ items: matching.slice(0, 1), cursor: { pk: "opaque" } });
          }
          return Promise.resolve({ items: cursor ? matching.slice(1) : matching });
        },
      ),
    };
    const invocationMetrics = metrics();
    await expect(
      runFreshnessCheck({
        repository,
        sources: [{ sourceKind: "cloudtrail-download", staleAfterSeconds: 86_400 }],
        now: () => now,
        metrics: invocationMetrics,
        logger: { info: vi.fn(), error: vi.fn() },
      }),
    ).resolves.toEqual({ stale: 1, incomplete: 1 });
    expect(invocationMetrics.gauge).toHaveBeenCalledWith("MeteringStaleWatermarks", "Checked", 1);
    expect(invocationMetrics.gauge).toHaveBeenCalledWith(
      "MeteringIncompleteWatermarks",
      "Checked",
      1,
    );
    expect(invocationMetrics.gauge).toHaveBeenCalledWith(
      "MeteringFreshnessCheckSuccess",
      "Checked",
      1,
    );
    expect(invocationMetrics.flush).toHaveBeenCalledOnce();
  });

  it("emits explicit zero gauges for an empty index", async () => {
    const invocationMetrics = metrics();
    await expect(
      runFreshnessCheck({
        repository: { listWatermarksBefore: vi.fn().mockResolvedValue({ items: [] }) },
        sources: [{ sourceKind: "cloudtrail-download", staleAfterSeconds: 86_400 }],
        now: () => now,
        metrics: invocationMetrics,
        logger: { info: vi.fn(), error: vi.fn() },
      }),
    ).resolves.toEqual({ stale: 0, incomplete: 0 });
    expect(invocationMetrics.gauge).toHaveBeenCalledWith("MeteringStaleWatermarks", "Checked", 0);
  });

  it("emits a failed check gauge, flushes, and rethrows repository failures", async () => {
    const invocationMetrics = metrics();
    await expect(
      runFreshnessCheck({
        repository: { listWatermarksBefore: vi.fn().mockRejectedValue(new Error("unavailable")) },
        sources: [{ sourceKind: "cloudtrail-download", staleAfterSeconds: 86_400 }],
        now: () => now,
        metrics: invocationMetrics,
        logger: { info: vi.fn(), error: vi.fn() },
      }),
    ).rejects.toThrow("unavailable");
    expect(invocationMetrics.gauge).toHaveBeenCalledWith(
      "MeteringFreshnessCheckSuccess",
      "Checked",
      0,
    );
    expect(invocationMetrics.flush).toHaveBeenCalledOnce();
  });
});
