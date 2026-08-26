import { describe, expect, it, vi } from "vitest";

import { createDownloadMeteringWorker } from "./metering-worker.js";

const logBucket = "stage-download-metering-logs";
const logPrefix = "AWSLogs/162067902192/CloudTrail/il-central-1/";
const logKey = `${logPrefix}2026/08/24/log.json.gz`;
const summary = {
  logsProcessed: 1,
  accepted: 1,
  observed: 1,
  recorded: 0,
  duplicates: 0,
  quarantined: 0,
  quarantineDuplicates: 0,
  rebuiltPeriods: 0,
  safeEvidenceHashes: ["a".repeat(64)],
};

function sqsEvent() {
  return {
    Records: [
      {
        eventSource: "aws:sqs",
        messageId: "message-1",
        body: JSON.stringify({
          Records: [
            {
              eventName: "ObjectCreated:Put",
              s3: { bucket: { name: logBucket }, object: { key: logKey } },
            },
          ],
        }),
      },
    ],
  };
}

function setup() {
  const logger = { info: vi.fn(), error: vi.fn() };
  const observedMetrics = { count: vi.fn(), gauge: vi.fn(), flush: vi.fn() };
  const runtime = {
    logBucketName: logBucket,
    logPrefix,
    usage: { quarantineDownloadEvidence: vi.fn(() => Promise.resolve("recorded" as const)) },
    metering: {
      processQueueLog: vi.fn(() => Promise.resolve(summary)),
      reconcileLogKeys: vi.fn(() => Promise.resolve({ ...summary, rebuiltPeriods: 1 })),
    },
  };
  return {
    logger,
    runtime,
    worker: createDownloadMeteringWorker({
      runtime: runtime as never,
      logger,
      now: () => "2026-08-24T10:00:00.000Z",
      metricsFactory: () => observedMetrics,
    }),
    observedMetrics,
  };
}

describe("download metering worker", () => {
  it("dispatches queue and exact reconciliation jobs with count/hash-only logs", async () => {
    const { worker, runtime, logger, observedMetrics } = setup();
    await expect(worker.handler(sqsEvent())).resolves.toEqual(summary);
    expect(runtime.metering.processQueueLog).toHaveBeenCalledWith(logKey);
    await worker.handler({ kind: "reconcile-download-metering", logKeys: [logKey] });
    expect(runtime.metering.reconcileLogKeys).toHaveBeenCalledWith([logKey]);
    const serialized = JSON.stringify(logger.info.mock.calls);
    expect(serialized).not.toMatch(/stage-download|AWSLogs|log\.json|message-1|ObjectCreated/u);
    expect(serialized).toContain("a".repeat(64));
    expect(observedMetrics.count).toHaveBeenCalledWith("DownloadMeteringProcessed", "Success", 1);
    expect(observedMetrics.flush).toHaveBeenCalledTimes(2);
  });

  it("acknowledges expected poison by deterministic quarantine", async () => {
    const { worker, runtime, logger, observedMetrics } = setup();
    await expect(worker.handler({ Records: [] })).resolves.toMatchObject({
      logsProcessed: 0,
      quarantined: 1,
    });
    expect(runtime.usage.quarantineDownloadEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "invalid-sqs-envelope" }),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(observedMetrics.count).toHaveBeenCalledWith("DownloadMeteringQuarantine", "Quarantined");
  });

  it("logs only safe request identity and rethrows transient failures for SQS retry", async () => {
    const { worker, runtime, logger, observedMetrics } = setup();
    runtime.metering.processQueueLog.mockRejectedValueOnce(
      new Error("temporary failure containing secret-log-key"),
    );
    await expect(worker.handler(sqsEvent())).rejects.toThrow("temporary failure");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(
      /secret-log-key|AWSLogs|log\.json/u,
    );
    expect(observedMetrics.count).toHaveBeenCalledWith("DownloadMeteringFailure", "Failed");
    expect(observedMetrics.flush).toHaveBeenCalledOnce();
  });
});
