import { safeLogger } from "../../core/observability/powertools.js";
import {
  createInvocationMetrics,
  type InvocationMetrics,
} from "../../core/observability/metrics.js";
import { parseMeteringInvocation } from "./cloudtrail-log.js";
import { getDownloadMeteringRuntime } from "./metering-runtime.js";

export interface MeteringWorkerLogger {
  info(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

export function createDownloadMeteringWorker(options: {
  readonly runtime: ReturnType<typeof getDownloadMeteringRuntime>;
  readonly logger?: MeteringWorkerLogger;
  readonly now?: () => string;
  readonly metricsFactory?: () => InvocationMetrics;
}) {
  const logger = options.logger ?? safeLogger;

  async function handler(rawEvent: unknown) {
    const invocationMetrics =
      options.metricsFactory?.() ?? createInvocationMetrics("DownloadMetering");
    try {
      const invocation = parseMeteringInvocation(rawEvent, {
        logBucketName: options.runtime.logBucketName,
        logPrefix: options.runtime.logPrefix,
        ...(options.now ? { now: options.now } : {}),
      });
      if (invocation.kind === "quarantine") {
        const status = await options.runtime.usage.quarantineDownloadEvidence({
          reasonCode: invocation.reasonCode,
          evidenceHash: invocation.evidenceHash,
          observedAt: invocation.observedAt,
          ...(invocation.internalProjectId
            ? { internalProjectId: invocation.internalProjectId }
            : {}),
        });
        const summary = {
          logsProcessed: 0,
          accepted: 0,
          observed: 0,
          recorded: 0,
          duplicates: 0,
          quarantined: 1,
          quarantineDuplicates: status === "duplicate" ? 1 : 0,
          rebuiltPeriods: 0,
          safeEvidenceHashes: [invocation.evidenceHash],
        } as const;
        invocationMetrics.count("DownloadMeteringQuarantine", "Quarantined");
        if (status === "duplicate") {
          invocationMetrics.count("DownloadMeteringDuplicate", "Duplicate");
        }
        logger.info("Download metering poison evidence acknowledged", {
          reasonCode: invocation.reasonCode,
          evidenceHash: invocation.evidenceHash,
        });
        return summary;
      }
      logger.info("Download metering started", {
        invocationKind: invocation.kind,
        requestHash: invocation.requestHash,
        logCount: invocation.logKeys.length,
      });
      const summary =
        invocation.kind === "queue"
          ? await options.runtime.metering.processQueueLog(invocation.logKeys[0])
          : await options.runtime.metering.reconcileLogKeys(invocation.logKeys);
      invocationMetrics.count("DownloadMeteringProcessed", "Success", summary.logsProcessed);
      if (summary.quarantined > 0) {
        invocationMetrics.count("DownloadMeteringQuarantine", "Quarantined", summary.quarantined);
      }
      const duplicates = summary.duplicates + summary.quarantineDuplicates;
      if (duplicates > 0) {
        invocationMetrics.count("DownloadMeteringDuplicate", "Duplicate", duplicates);
      }
      logger.info("Download metering completed", { ...summary });
      return summary;
    } catch (error) {
      invocationMetrics.count("DownloadMeteringFailure", "Failed");
      logger.error("Download metering transient failure", {
        failureType: error instanceof Error ? "exception" : typeof error,
      });
      throw error;
    } finally {
      invocationMetrics.flush();
    }
  }

  return Object.freeze({ handler });
}

let worker: ReturnType<typeof createDownloadMeteringWorker> | undefined;

export function processDownloadMetering(event: unknown) {
  worker ??= createDownloadMeteringWorker({ runtime: getDownloadMeteringRuntime() });
  return worker.handler(event);
}
