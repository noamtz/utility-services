import { z } from "zod";

import type {
  AcceptedDownloadEvidence,
  CloudTrailArchiveResult,
  QuarantinedDownloadEvidence,
} from "./cloudtrail-log.js";
import type { DownloadEvidenceInput, DownloadEvidenceResult } from "./service.js";

export const DownloadPricingModeSchema = z.enum(["evidence-only", "priced"]);
export type DownloadPricingMode = z.infer<typeof DownloadPricingModeSchema>;

export interface DownloadMeteringUsageService {
  observeDownloadEvidence(input: DownloadEvidenceInput): Promise<DownloadEvidenceResult>;
  recordDownloadEvidence(input: DownloadEvidenceInput): Promise<DownloadEvidenceResult>;
  quarantineDownloadEvidence(input: {
    reasonCode: string;
    evidenceHash: string;
    observedAt: string;
    internalProjectId?: string;
  }): Promise<"recorded" | "duplicate">;
  rebuildMonthlyProjection(
    internalProjectId: string,
    period: string,
    evaluatedAt: string,
    policy: { requiredSources: Readonly<Record<string, number>> },
  ): Promise<unknown>;
}

export interface DownloadMeteringLogReader {
  readLog(logKey: string): Promise<CloudTrailArchiveResult>;
}

export interface DownloadMeteringSummary {
  readonly logsProcessed: number;
  readonly accepted: number;
  readonly observed: number;
  readonly recorded: number;
  readonly duplicates: number;
  readonly quarantined: number;
  readonly quarantineDuplicates: number;
  readonly rebuiltPeriods: number;
  readonly safeEvidenceHashes: readonly string[];
}

function usageInput(evidence: AcceptedDownloadEvidence): DownloadEvidenceInput {
  return {
    eventId: evidence.eventId,
    internalProjectId: evidence.internalProjectId,
    fileId: evidence.fileId,
    occurredAt: evidence.occurredAt,
    bytesTransferredOut: evidence.bytesTransferredOut,
    accountId: evidence.accountId,
    region: evidence.region,
    rawLogDigest: evidence.rawLogDigest,
  };
}

function period(timestamp: string): string {
  return new Date(z.iso.datetime({ offset: true }).parse(timestamp)).toISOString().slice(0, 7);
}

export function createDownloadMeteringService(options: {
  readonly reader: DownloadMeteringLogReader;
  readonly usage: DownloadMeteringUsageService;
  readonly pricingMode: DownloadPricingMode;
  readonly now?: () => string;
}) {
  const pricingMode = DownloadPricingModeSchema.parse(options.pricingMode);
  const now = options.now ?? (() => new Date().toISOString());

  async function quarantine(record: QuarantinedDownloadEvidence) {
    return options.usage.quarantineDownloadEvidence({
      reasonCode: record.reasonCode,
      evidenceHash: record.evidenceHash,
      observedAt: record.observedAt,
      ...(record.internalProjectId ? { internalProjectId: record.internalProjectId } : {}),
    });
  }

  async function processLogKeys(
    logKeysInput: readonly string[],
    reconcile = false,
  ): Promise<DownloadMeteringSummary> {
    const logKeys = z.array(z.string().min(1).max(1_024)).min(1).max(100).parse(logKeysInput);
    let accepted = 0;
    let observed = 0;
    let recorded = 0;
    let duplicates = 0;
    let quarantined = 0;
    let quarantineDuplicates = 0;
    const hashes = new Set<string>();
    const affected = new Map<string, { internalProjectId: string; period: string }>();

    for (const logKey of logKeys) {
      const archive = await options.reader.readLog(logKey);
      for (const item of archive.records) {
        hashes.add(item.evidenceHash);
        if (item.kind === "quarantine") {
          const status = await quarantine(item);
          quarantined += 1;
          if (status === "duplicate") quarantineDuplicates += 1;
          continue;
        }
        accepted += 1;
        const result =
          pricingMode === "evidence-only"
            ? await options.usage.observeDownloadEvidence(usageInput(item))
            : await options.usage.recordDownloadEvidence(usageInput(item));
        if (result.status === "observed") observed += 1;
        else if (result.status === "recorded") recorded += 1;
        else duplicates += 1;
        if (pricingMode === "priced" && reconcile) {
          const usagePeriod = period(result.occurredAt);
          affected.set(`${result.internalProjectId}|${usagePeriod}`, {
            internalProjectId: result.internalProjectId,
            period: usagePeriod,
          });
        }
      }
    }

    if (pricingMode === "priced" && reconcile) {
      const evaluatedAt = new Date(z.iso.datetime({ offset: true }).parse(now())).toISOString();
      for (const item of affected.values()) {
        await options.usage.rebuildMonthlyProjection(
          item.internalProjectId,
          item.period,
          evaluatedAt,
          { requiredSources: {} },
        );
      }
    }

    return Object.freeze({
      logsProcessed: logKeys.length,
      accepted,
      observed,
      recorded,
      duplicates,
      quarantined,
      quarantineDuplicates,
      rebuiltPeriods: affected.size,
      safeEvidenceHashes: Object.freeze([...hashes].sort()),
    });
  }

  return Object.freeze({
    processQueueLog: (logKey: string) => processLogKeys([logKey], false),
    reconcileLogKeys: (logKeys: readonly string[]) => processLogKeys(logKeys, true),
  });
}
