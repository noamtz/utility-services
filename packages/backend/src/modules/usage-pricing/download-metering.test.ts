/* eslint-disable @typescript-eslint/require-await -- deterministic in-memory orchestration doubles */
import { describe, expect, it, vi } from "vitest";

import type {
  AcceptedDownloadEvidence,
  CloudTrailArchiveResult,
  QuarantinedDownloadEvidence,
} from "./cloudtrail-log.js";
import { createDownloadMeteringService } from "./download-metering.js";
import type { DownloadEvidenceResult } from "./service.js";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";

function accepted(
  eventId: string,
  internalProjectId = projectA,
  occurredAt = "2026-08-24T09:00:00.000Z",
): AcceptedDownloadEvidence {
  return {
    kind: "accepted",
    eventId,
    internalProjectId,
    fileId: "fil_0123456789abcdefghijkl",
    occurredAt,
    bytesTransferredOut: 42n,
    accountId: "162067902192",
    region: "il-central-1",
    rawLogDigest: "a".repeat(64),
    evidenceHash: eventId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
  };
}

function bad(internalProjectId?: string): QuarantinedDownloadEvidence {
  return {
    kind: "quarantine",
    reasonCode: "invalid-bytes-transferred-out",
    evidenceHash: "b".repeat(64),
    observedAt: "2026-08-24T10:00:00.000Z",
    ...(internalProjectId ? { internalProjectId } : {}),
  };
}

function setup(mode: "evidence-only" | "priced", archives: CloudTrailArchiveResult[]) {
  const pending = [...archives];
  const evidence = new Map<string, "observed" | "recorded">();
  const calls = {
    observe: vi.fn((input: { eventId: string; internalProjectId: string }) => {
      const key = `${input.internalProjectId}|${input.eventId}`;
      const status = evidence.has(key) ? "duplicate" : "observed";
      evidence.set(key, "observed");
      return Promise.resolve({
        status,
        internalProjectId: input.internalProjectId,
        period: "2026-08",
        occurredAt: "2026-08-24T09:00:00.000Z",
        bytesTransferredOut: 42n,
      } satisfies DownloadEvidenceResult);
    }),
    record: vi.fn((input: { eventId: string; internalProjectId: string; occurredAt: string }) => {
      const key = `${input.internalProjectId}|${input.eventId}`;
      const status = evidence.get(key) === "recorded" ? "duplicate" : "recorded";
      evidence.set(key, "recorded");
      return Promise.resolve({
        status,
        internalProjectId: input.internalProjectId,
        period: input.occurredAt.slice(0, 7),
        occurredAt: input.occurredAt,
        bytesTransferredOut: 42n,
      } satisfies DownloadEvidenceResult);
    }),
    quarantine: vi.fn(() => Promise.resolve("recorded" as const)),
    rebuild: vi.fn((internalProjectId: string, period: string) => {
      void internalProjectId;
      void period;
      return Promise.resolve({});
    }),
  };
  const service = createDownloadMeteringService({
    pricingMode: mode,
    reader: {
      readLog: vi.fn(async () => {
        const next = pending.shift();
        if (!next) throw new Error("missing fixture");
        return next;
      }),
    },
    usage: {
      observeDownloadEvidence: calls.observe,
      recordDownloadEvidence: calls.record,
      quarantineDownloadEvidence: calls.quarantine,
      rebuildMonthlyProjection: calls.rebuild,
    },
    now: () => "2026-08-24T10:00:00.000Z",
  });
  return { service, calls, evidence };
}

describe("download metering orchestrator", () => {
  it("continues after poison neighbors and stores evidence without pricing when gated", async () => {
    const first = accepted("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const { service, calls } = setup("evidence-only", [
      { logDigest: "c".repeat(64), records: [bad(projectA), first, first] },
    ]);
    await expect(service.processQueueLog("exact-log.json.gz")).resolves.toMatchObject({
      logsProcessed: 1,
      accepted: 2,
      observed: 1,
      duplicates: 1,
      quarantined: 1,
      recorded: 0,
      rebuiltPeriods: 0,
    });
    expect(calls.observe).toHaveBeenCalledTimes(2);
    expect(calls.record).not.toHaveBeenCalled();
    expect(calls.quarantine).toHaveBeenCalledTimes(1);
    expect(calls.rebuild).not.toHaveBeenCalled();
  });

  it("replays exact logs idempotently and rebuilds each affected project/month once", async () => {
    const a1 = accepted("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const a2 = accepted("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const b1 = accepted("cccccccc-cccc-4ccc-8ccc-cccccccccccc", projectB);
    const nextMonth = accepted(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      projectA,
      "2026-09-01T00:00:00.000Z",
    );
    const archive = { logDigest: "c".repeat(64), records: [a1, a2, b1, nextMonth, bad()] };
    const { service, calls } = setup("priced", [archive, archive]);
    const first = await service.reconcileLogKeys(["one.json.gz"]);
    const second = await service.reconcileLogKeys(["one.json.gz"]);
    expect(first).toMatchObject({ recorded: 4, quarantined: 1, rebuiltPeriods: 3 });
    expect(second).toMatchObject({ duplicates: 4, quarantined: 1, rebuiltPeriods: 3 });
    expect(calls.rebuild).toHaveBeenCalledTimes(6);
    expect(new Set(calls.rebuild.mock.calls.map((call) => `${call[0]}|${call[1]}`))).toEqual(
      new Set([`${projectA}|2026-08`, `${projectA}|2026-09`, `${projectB}|2026-08`]),
    );
  });

  it("rethrows transient reader or usage failures for queue retry and retained-log recovery", async () => {
    const service = createDownloadMeteringService({
      pricingMode: "priced",
      reader: { readLog: vi.fn(async () => Promise.reject(new Error("temporary S3 failure"))) },
      usage: {} as never,
    });
    await expect(service.processQueueLog("retained.json.gz")).rejects.toThrow(
      "temporary S3 failure",
    );

    const item = accepted("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const { service: dynamoFailure, calls } = setup("priced", [
      { logDigest: "c".repeat(64), records: [item] },
    ]);
    calls.record.mockRejectedValueOnce(new Error("temporary Dynamo failure"));
    await expect(dynamoFailure.processQueueLog("retained.json.gz")).rejects.toThrow(
      "temporary Dynamo failure",
    );
  });
});
