import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { z } from "zod";

import { safeLogger } from "../../core/observability/powertools.js";
import { createCloudTrailLogReader, type CloudTrailLogStore } from "./cloudtrail-log.js";
import { createDownloadMeteringService, DownloadPricingModeSchema } from "./download-metering.js";
import {
  createDynamoUsagePricingRepository,
  usageDocumentClientOptions,
  type UsageDocumentClient,
} from "./repository.js";
import { createUsagePricingService } from "./service.js";

export interface MeteringS3Client {
  send(command: GetObjectCommand): Promise<{
    Body?: { transformToByteArray?: () => Promise<Uint8Array> };
  }>;
}

export function createS3CloudTrailLogStore(options: {
  readonly client: MeteringS3Client;
  readonly bucketName: string;
}): CloudTrailLogStore {
  const bucketName = z.string().trim().min(1).parse(options.bucketName);
  return Object.freeze({
    async get(logKey: string) {
      const key = z.string().min(1).max(1_024).parse(logKey);
      const output = await options.client.send(
        new GetObjectCommand({ Bucket: bucketName, Key: key }),
      );
      if (!output.Body?.transformToByteArray) throw new Error("CloudTrail log body is unavailable");
      return output.Body.transformToByteArray();
    },
  });
}

export function createDownloadMeteringRuntime(options: {
  readonly logBucketName: string;
  readonly usageTableName: string;
  readonly fileBucketName: string;
  readonly accountId: string;
  readonly region: string;
  readonly logPrefix: string;
  readonly pricingMode: string;
  readonly maxCompressedBytes: number;
  readonly maxInflatedBytes: number;
  readonly maxRecords: number;
  readonly s3Client?: MeteringS3Client;
  readonly documentClient?: UsageDocumentClient;
  readonly now?: () => string;
}) {
  const logBucketName = z.string().trim().min(1).parse(options.logBucketName);
  const usageTableName = z.string().trim().min(1).parse(options.usageTableName);
  const fileBucketName = z.string().trim().min(1).parse(options.fileBucketName);
  const pricingMode = DownloadPricingModeSchema.parse(options.pricingMode);
  const s3Client = options.s3Client ?? new S3Client({});
  const documentClient =
    options.documentClient ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), usageDocumentClientOptions());
  const repository = createDynamoUsagePricingRepository({
    client: documentClient,
    tableName: usageTableName,
  });
  const usage = createUsagePricingService({
    repository,
    ...(options.now ? { now: options.now } : {}),
  });
  const logStore = createS3CloudTrailLogStore({ client: s3Client, bucketName: logBucketName });
  const reader = createCloudTrailLogReader({
    store: logStore,
    logBucketName,
    logPrefix: options.logPrefix,
    fileBucketName,
    accountId: options.accountId,
    region: options.region,
    maxCompressedBytes: options.maxCompressedBytes,
    maxInflatedBytes: options.maxInflatedBytes,
    maxRecords: options.maxRecords,
    ...(options.now ? { now: options.now } : {}),
  });
  const metering = createDownloadMeteringService({
    reader,
    usage,
    pricingMode,
    ...(options.now ? { now: options.now } : {}),
  });
  return Object.freeze({
    logBucketName,
    logPrefix: options.logPrefix,
    usage,
    metering,
    reader,
    logStore,
    logger: safeLogger,
  });
}

let runtime: ReturnType<typeof createDownloadMeteringRuntime> | undefined;

export function getDownloadMeteringRuntime() {
  runtime ??= createDownloadMeteringRuntime({
    logBucketName: Resource.DownloadMeteringLogBucket.name,
    usageTableName: Resource.UsagePricingTable.name,
    fileBucketName: z.string().trim().min(1).parse(process.env["FILE_BUCKET_NAME"]),
    accountId: z.string().parse(process.env["CLOUDTRAIL_ACCOUNT_ID"]),
    region: z.string().parse(process.env["CLOUDTRAIL_REGION"]),
    logPrefix: z.string().parse(process.env["CLOUDTRAIL_LOG_PREFIX"]),
    pricingMode: z.string().parse(process.env["DOWNLOAD_PRICING_MODE"]),
    maxCompressedBytes: z.coerce
      .number()
      .int()
      .positive()
      .parse(process.env["MAX_CLOUDTRAIL_COMPRESSED_BYTES"] ?? 10 * 1024 * 1024),
    maxInflatedBytes: z.coerce
      .number()
      .int()
      .positive()
      .parse(process.env["MAX_CLOUDTRAIL_INFLATED_BYTES"] ?? 50 * 1024 * 1024),
    maxRecords: z.coerce
      .number()
      .int()
      .positive()
      .parse(process.env["MAX_CLOUDTRAIL_RECORDS"] ?? 10_000),
  });
  return runtime;
}
