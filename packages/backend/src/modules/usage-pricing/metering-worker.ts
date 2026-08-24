import { safeLogger } from "../../core/observability/powertools.js";
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
}) {
  const logger = options.logger ?? safeLogger;

  async function handler(rawEvent: unknown) {
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
    try {
      const summary =
        invocation.kind === "queue"
          ? await options.runtime.metering.processQueueLog(invocation.logKeys[0])
          : await options.runtime.metering.reconcileLogKeys(invocation.logKeys);
      logger.info("Download metering completed", { ...summary });
      return summary;
    } catch (error) {
      logger.error("Download metering transient failure", {
        invocationKind: invocation.kind,
        requestHash: invocation.requestHash,
      });
      throw error;
    }
  }

  return Object.freeze({ handler });
}

let worker: ReturnType<typeof createDownloadMeteringWorker> | undefined;

export function processDownloadMetering(event: unknown) {
  worker ??= createDownloadMeteringWorker({ runtime: getDownloadMeteringRuntime() });
  return worker.handler(event);
}
