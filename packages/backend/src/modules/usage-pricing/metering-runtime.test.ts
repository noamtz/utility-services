import { GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceReads = vi.hoisted(() => ({ logBucket: 0, usageTable: 0, fileBucket: 0 }));

vi.mock("sst", () => ({
  Resource: {
    get DownloadMeteringLogBucket() {
      resourceReads.logBucket += 1;
      return { name: "stage-download-metering-logs" };
    },
    get UsagePricingTable() {
      resourceReads.usageTable += 1;
      return { name: "usage-table" };
    },
    get FileBucket() {
      resourceReads.fileBucket += 1;
      throw new Error("FileBucket must not be linked to metering");
    },
  },
}));

import {
  createDownloadMeteringRuntime,
  createS3CloudTrailLogStore,
  getDownloadMeteringRuntime,
} from "./metering-runtime.js";

const base = {
  logBucketName: "stage-download-metering-logs",
  usageTableName: "usage-table",
  fileBucketName: "stage-private-file-bucket",
  accountId: "162067902192",
  region: "il-central-1",
  logPrefix: "AWSLogs/162067902192/CloudTrail/il-central-1/",
  pricingMode: "evidence-only",
  maxCompressedBytes: 1_000,
  maxInflatedBytes: 2_000,
  maxRecords: 100,
} as const;

beforeEach(() => {
  resourceReads.fileBucket = 0;
});

describe("download metering runtime", () => {
  it("validates resources and composes bigint-safe usage without reading FileBucket", () => {
    const documentClient = { send: vi.fn() } as never;
    const s3Client = { send: vi.fn() } as never;
    const runtime = createDownloadMeteringRuntime({ ...base, documentClient, s3Client });
    expect(runtime.usage.observeDownloadEvidence).toBeTypeOf("function");
    expect(runtime.metering.processQueueLog).toBeTypeOf("function");
    expect(runtime.logBucketName).toBe(base.logBucketName);
    expect(resourceReads.fileBucket).toBe(0);
    expect(() =>
      createDownloadMeteringRuntime({ ...base, pricingMode: "enabled", documentClient, s3Client }),
    ).toThrow();
    expect(() =>
      createDownloadMeteringRuntime({ ...base, logBucketName: "", documentClient, s3Client }),
    ).toThrow();
  });

  it("reads only the configured log bucket and requires a byte-transformable body", async () => {
    const send = vi.fn((command: GetObjectCommand) => {
      void command;
      return Promise.resolve({
        Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) },
      });
    });
    const store = createS3CloudTrailLogStore({
      client: { send },
      bucketName: base.logBucketName,
    });
    await expect(store.get("exact-log.json.gz")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: base.logBucketName,
      Key: "exact-log.json.gz",
    });
    const missing = createS3CloudTrailLogStore({
      client: { send: vi.fn(() => Promise.resolve({})) },
      bucketName: base.logBucketName,
    });
    await expect(missing.get("exact-log.json.gz")).rejects.toThrow(
      "CloudTrail log body is unavailable",
    );
  });

  it("uses the bigint-safe Dynamo document options and memoizes linked runtime lazily", () => {
    const from = vi.spyOn(DynamoDBDocumentClient, "from");
    process.env["FILE_BUCKET_NAME"] = base.fileBucketName;
    process.env["CLOUDTRAIL_ACCOUNT_ID"] = base.accountId;
    process.env["CLOUDTRAIL_REGION"] = base.region;
    process.env["CLOUDTRAIL_LOG_PREFIX"] = base.logPrefix;
    process.env["DOWNLOAD_PRICING_MODE"] = base.pricingMode;
    expect(resourceReads.logBucket).toBe(0);
    const first = getDownloadMeteringRuntime();
    const second = getDownloadMeteringRuntime();
    expect(first).toBe(second);
    expect(resourceReads.logBucket).toBe(1);
    expect(resourceReads.usageTable).toBe(1);
    expect(resourceReads.fileBucket).toBe(0);
    expect(from).toHaveBeenCalledTimes(1);
    const options = from.mock.calls[0]?.[1];
    expect(options?.marshallOptions).toMatchObject({ removeUndefinedValues: true });
    expect(options?.unmarshallOptions?.wrapNumbers).toBeTypeOf("function");
    from.mockRestore();
  });
});
