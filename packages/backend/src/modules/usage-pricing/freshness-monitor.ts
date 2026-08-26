import { z } from "zod";

import {
  createInvocationMetrics,
  type InvocationMetrics,
} from "../../core/observability/metrics.js";
import { safeLogger } from "../../core/observability/powertools.js";
import type { WatermarkPage } from "./repository.js";

const MAX_PAGES_PER_QUERY = 100;

export interface FreshnessSource {
  readonly sourceKind: string;
  readonly staleAfterSeconds: number;
}

export interface FreshnessWatermarkRepository {
  listWatermarksBefore(
    sourceKind: string,
    cutoff: string,
    cursor?: Record<string, unknown>,
    limit?: number,
  ): Promise<WatermarkPage>;
}

async function collectBefore(
  repository: FreshnessWatermarkRepository,
  sourceKind: string,
  cutoff: string,
) {
  const items: WatermarkPage["items"][number][] = [];
  let cursor: Record<string, unknown> | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_QUERY; pageNumber += 1) {
    const page = await repository.listWatermarksBefore(sourceKind, cutoff, cursor, 100);
    items.push(...page.items);
    if (!page.cursor) return items;
    cursor = page.cursor;
  }
  throw new Error("Freshness watermark query exceeded its bounded page limit");
}

export async function runFreshnessCheck(options: {
  readonly repository: FreshnessWatermarkRepository;
  readonly sources: readonly FreshnessSource[];
  readonly now?: () => string;
  readonly metrics?: InvocationMetrics;
  readonly logger?: Pick<typeof safeLogger, "info" | "error">;
}): Promise<{ stale: number; incomplete: number }> {
  const now = z.iso
    .datetime({ offset: true })
    .parse((options.now ?? (() => new Date().toISOString()))());
  const metrics = options.metrics ?? createInvocationMetrics("MeteringFreshnessMonitor");
  const logger = options.logger ?? safeLogger;
  try {
    let stale = 0;
    let incomplete = 0;
    for (const sourceInput of options.sources) {
      const source = {
        sourceKind: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,63}$/u)
          .parse(sourceInput.sourceKind),
        staleAfterSeconds: z.number().int().positive().parse(sourceInput.staleAfterSeconds),
      };
      const cutoff = new Date(
        new Date(now).getTime() - source.staleAfterSeconds * 1_000,
      ).toISOString();
      const allCutoff = new Date(new Date(now).getTime() + 1).toISOString();
      const [staleItems, currentItems] = await Promise.all([
        collectBefore(options.repository, source.sourceKind, cutoff),
        collectBefore(options.repository, source.sourceKind, allCutoff),
      ]);
      stale += staleItems.length;
      incomplete += currentItems.filter((item) => item.incompleteSince !== null).length;
    }
    metrics.gauge("MeteringStaleWatermarks", "Checked", stale);
    metrics.gauge("MeteringIncompleteWatermarks", "Checked", incomplete);
    metrics.gauge("MeteringFreshnessCheckSuccess", "Checked", 1);
    logger.info("Metering freshness check completed", { stale, incomplete });
    return { stale, incomplete };
  } catch (error) {
    metrics.gauge("MeteringFreshnessCheckSuccess", "Checked", 0);
    logger.error("Metering freshness check failed", {
      failureType: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  } finally {
    metrics.flush();
  }
}
