import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { createCloudTrailLogReader, parseMeteringInvocation } from "./cloudtrail-log.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const fileId = "fil_0123456789abcdefghijkl";
const logBucket = "stage-download-metering-logs";
const fileBucket = "stage-private-file-bucket";
const logPrefix = "AWSLogs/162067902192/CloudTrail/il-central-1/";
const logKey = `${logPrefix}2026/08/24/log.json.gz`;
const now = "2026-08-24T10:00:00.000Z";

function record(overrides: Record<string, unknown> = {}) {
  return {
    eventVersion: "1.11",
    eventID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    eventTime: "2026-08-24T09:55:00.000Z",
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
    additionalEventData: { bytesTransferredOut: "42" },
    ...overrides,
  };
}

function archive(records: unknown[]) {
  return gzipSync(JSON.stringify({ Records: records }));
}

function reader(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  const get = vi.fn(() => Promise.resolve(bytes));
  return {
    get,
    value: createCloudTrailLogReader({
      store: { get },
      logBucketName: logBucket,
      logPrefix,
      fileBucketName: fileBucket,
      accountId: "162067902192",
      region: "il-central-1",
      maxCompressedBytes: 1_000_000,
      maxInflatedBytes: 2_000_000,
      maxRecords: 100,
      now: () => now,
      ...overrides,
    }),
  };
}

function sqsEvent(key = logKey, bucket = logBucket) {
  return {
    Records: [
      {
        eventSource: "aws:sqs",
        messageId: "message-1",
        body: JSON.stringify({
          Records: [
            {
              eventName: "ObjectCreated:Put",
              s3: { bucket: { name: bucket }, object: { key } },
            },
          ],
        }),
      },
    ],
  };
}

describe("CloudTrail metering invocation parser", () => {
  it("accepts one SQS-wrapped S3 log and exact-key reconciliation jobs", () => {
    expect(
      parseMeteringInvocation(sqsEvent(), { logBucketName: logBucket, logPrefix, now: () => now }),
    ).toMatchObject({ kind: "queue", logKeys: [logKey] });
    expect(
      parseMeteringInvocation(
        { kind: "reconcile-download-metering", logKeys: [logKey, logKey] },
        { logBucketName: logBucket, logPrefix, now: () => now },
      ),
    ).toMatchObject({ kind: "reconcile", logKeys: [logKey] });
    expect(
      parseMeteringInvocation(sqsEvent(logKey.replace(".json.gz", ".txt")), {
        logBucketName: logBucket,
        logPrefix,
        now: () => now,
      }),
    ).toMatchObject({ kind: "quarantine", reasonCode: "outside-log-boundary" });
  });

  it("hashes malformed, multi-message, and wrong-bucket envelopes without exposing them", () => {
    const invalid = [
      { Records: [] },
      { Records: [{}, {}] },
      { Records: [{ eventSource: "aws:sqs", messageId: "one", body: "secret-body" }] },
      sqsEvent(logKey, "wrong-private-bucket"),
    ];
    for (const event of invalid) {
      const result = parseMeteringInvocation(event, {
        logBucketName: logBucket,
        logPrefix,
        now: () => now,
      });
      expect(result.kind).toBe("quarantine");
      expect(JSON.stringify(result)).not.toMatch(/secret-body|wrong-private-bucket|AWSLogs/u);
    }
  });

  it("rejects each non-exact replay-key shape and safely hashes circular input", () => {
    for (const key of ["wrong-prefix/log.json.gz", `${logPrefix}log.json`]) {
      expect(
        parseMeteringInvocation(
          { kind: "reconcile-download-metering", logKeys: [key] },
          { logBucketName: logBucket, logPrefix, now: () => now },
        ),
      ).toMatchObject({ kind: "quarantine", reasonCode: "invalid-reconcile-key" });
    }
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(
      parseMeteringInvocation(circular, { logBucketName: logBucket, logPrefix }),
    ).toMatchObject({
      kind: "quarantine",
      reasonCode: "invalid-sqs-envelope",
    });
  });
});

describe("CloudTrail gzip archive parser", () => {
  it("accepts full, range-like, zero-byte, string, and numeric byte evidence", async () => {
    const records = [
      record(),
      record({
        eventID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        additionalEventData: { bytesTransferredOut: 10 },
      }),
      record({
        eventID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        additionalEventData: { bytesTransferredOut: "0" },
      }),
    ];
    const { value } = reader(archive(records));
    const result = await value.readLog(logKey);
    expect(result.records).toHaveLength(3);
    expect(result.records.map((item) => item.kind)).toEqual(["accepted", "accepted", "accepted"]);
    expect(
      result.records.map((item) => (item.kind === "accepted" ? item.bytesTransferredOut : -1n)),
    ).toEqual([42n, 10n, 0n]);
    expect(result.records[0]).toMatchObject({
      internalProjectId: projectId,
      fileId,
      accountId: "162067902192",
      region: "il-central-1",
    });
  });

  it("deduplicates only later and preserves distinct event IDs from URL reuse", async () => {
    const repeated = record({ eventID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const { value } = reader(archive([record(), record(), repeated]));
    const result = await value.readLog(logKey);
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({ eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(result.records[1]).toMatchObject({ eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(result.records[2]).toMatchObject({ eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  });

  it.each([
    ["missing", undefined],
    ["negative", "-1"],
    ["fractional", "1.5"],
    ["unsafe-number", Number.MAX_SAFE_INTEGER + 1],
    ["non-digit", "10 bytes"],
    ["too-large", "9".repeat(39)],
  ])("quarantines %s transferred byte evidence", async (_name, bytes) => {
    const additionalEventData = bytes === undefined ? {} : { bytesTransferredOut: bytes };
    const { value } = reader(archive([record({ additionalEventData })]));
    await expect(value.readLog(logKey)).resolves.toMatchObject({
      records: [
        {
          kind: "quarantine",
          reasonCode: "invalid-bytes-transferred-out",
          internalProjectId: projectId,
        },
      ],
    });
  });

  it("quarantines failed, out-of-scope, ambiguous, malformed, and encoded-key evidence", async () => {
    const encodedKey = `projects/${projectId}/files/${encodeURIComponent(fileId)}`;
    const cases = [
      [record({ errorCode: "AccessDenied" }), "failed-get-object"],
      [record({ awsRegion: "us-east-1" }), "outside-download-boundary"],
      [record({ recipientAccountId: "000000000000" }), "outside-download-boundary"],
      [record({ eventSource: "ec2.amazonaws.com" }), "outside-download-boundary"],
      [record({ eventType: "AwsServiceEvent" }), "outside-download-boundary"],
      [record({ eventName: "PutObject" }), "outside-download-boundary"],
      [record({ eventCategory: "Management" }), "outside-download-boundary"],
      [
        record({ resources: [...record().resources, ...record().resources] }),
        "ambiguous-object-resource",
      ],
      [
        record({ resources: [{ type: "AWS::S3::Object", ARN: "arn:aws:s3:::wrong/key" }] }),
        "ambiguous-object-resource",
      ],
      [
        record({
          resources: [{ type: "AWS::S3::Object", ARN: `arn:aws:s3:::${fileBucket}/${encodedKey}` }],
        }),
        null,
      ],
      [
        record({
          resources: [
            { type: "AWS::S3::Object", ARN: `arn:aws:s3:::${fileBucket}/projects/%/files/x` },
          ],
        }),
        "invalid-object-key",
      ],
      [
        record({
          resources: [
            {
              type: "AWS::S3::Object",
              ARN: `arn:aws:s3:::${fileBucket}/projects/not-a-project/files/not-a-file`,
            },
          ],
        }),
        "invalid-object-key",
      ],
      [{ raw: "Bearer secret" }, "invalid-cloudtrail-record"],
    ] as const;
    for (const [raw, reason] of cases) {
      const { value } = reader(archive([raw]));
      const result = await value.readLog(logKey);
      if (reason === null) expect(result.records[0]?.kind).toBe("accepted");
      else expect(result.records[0]).toMatchObject({ kind: "quarantine", reasonCode: reason });
      if (reason === "failed-get-object") {
        expect(result.records[0]).toMatchObject({ internalProjectId: projectId });
      }
      if (result.records[0]?.kind === "quarantine") {
        expect(JSON.stringify(result.records[0])).not.toMatch(/Bearer|arn:aws:s3|projects\//u);
      }
    }
  });

  it("bounds archive retrieval and turns poison archives into safe quarantine", async () => {
    const malformed = [
      [new Uint8Array(), "invalid-compressed-size"],
      [new TextEncoder().encode("not-gzip"), "invalid-gzip"],
      [gzipSync("not-json"), "invalid-cloudtrail-json"],
      [archive([]), "invalid-record-count"],
      [archive([record(), record()]), "invalid-record-count", { maxRecords: 1 }],
    ] as const;
    for (const [bytes, reason, overrides] of malformed) {
      const { value } = reader(bytes, overrides ?? {});
      await expect(value.readLog(logKey)).resolves.toMatchObject({
        records: [{ kind: "quarantine", reasonCode: reason }],
      });
    }
    const tooCompressed = reader(archive([record()]), { maxCompressedBytes: 1 });
    await expect(tooCompressed.value.readLog(logKey)).resolves.toMatchObject({
      records: [{ reasonCode: "invalid-compressed-size" }],
    });
    await expect(
      reader(archive([record()])).value.readLog(`${logPrefix}not-gzip.txt`),
    ).resolves.toMatchObject({ records: [{ reasonCode: "outside-log-boundary" }] });
  });

  it("throws transient object-store failures for queue retry", async () => {
    const get = vi.fn(() => Promise.reject(new Error("temporary S3 failure")));
    const value = createCloudTrailLogReader({
      store: { get },
      logBucketName: logBucket,
      logPrefix,
      fileBucketName: fileBucket,
      accountId: "162067902192",
      region: "il-central-1",
      maxCompressedBytes: 100,
      maxInflatedBytes: 100,
      maxRecords: 10,
      now: () => now,
    });
    await expect(value.readLog(logKey)).rejects.toThrow("temporary S3 failure");
  });
});
