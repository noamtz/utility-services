import { z } from "zod";

import { AWS_REGION } from "./app.js";
import { FILE_OBJECT_PREFIX } from "./file-management.js";
import { classifyStage } from "./stage.js";

export const DOWNLOAD_LOG_BUCKET_COMPONENT_NAME = "DownloadMeteringLogBucket";
export const DOWNLOAD_METERING_DLQ_COMPONENT_NAME = "DownloadMeteringDeadLetterQueue";
export const DOWNLOAD_METERING_QUEUE_COMPONENT_NAME = "DownloadMeteringQueue";
export const DOWNLOAD_METERING_PROCESSOR_COMPONENT_NAME = "DownloadMeteringProcessor";
export const DOWNLOAD_METERING_NOTIFICATION_COMPONENT_NAME = "DownloadMeteringLogNotification";
export const DOWNLOAD_METERING_TRAIL_COMPONENT_NAME = "DownloadMeteringTrail";

export const DOWNLOAD_METERING_SOURCE_KIND = "cloudtrail-download" as const;
export const DOWNLOAD_METERING_AWS_ACCOUNT_ID = "162067902192" as const;
export const DOWNLOAD_METERING_AWS_PARTITION = "aws" as const;
export const DOWNLOAD_PRICING_MODE = "evidence-only" as const satisfies DownloadPricingMode;
export const DOWNLOAD_LOG_RETENTION_DAYS = 90 as const;
export const DOWNLOAD_METERING_DLQ_RETENTION_DAYS = 14 as const;
export const DOWNLOAD_METERING_QUEUE_RETRY_COUNT = 5 as const;
export const DOWNLOAD_METERING_PROCESSOR_TIMEOUT_SECONDS = 60 as const;
export const DOWNLOAD_METERING_QUEUE_VISIBILITY_SECONDS = 180 as const;
export const DOWNLOAD_METERING_PROCESSOR_MEMORY_MB = 512 as const;
export const MAX_CLOUDTRAIL_COMPRESSED_BYTES = 10 * 1024 * 1024;
export const MAX_CLOUDTRAIL_INFLATED_BYTES = 50 * 1024 * 1024;
export const MAX_CLOUDTRAIL_RECORDS = 10_000;
export const CLOUDTRAIL_LOG_SUFFIX = ".json.gz" as const;

export type DownloadPricingMode = "evidence-only" | "priced";

export const DOWNLOAD_METERING_DYNAMO_ACTIONS = [
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:Query",
  "dynamodb:UpdateItem",
  "dynamodb:TransactGetItems",
  "dynamodb:TransactWriteItems",
] as const;
export const DOWNLOAD_METERING_LOG_ACTIONS = ["s3:GetObject"] as const;

export const DOWNLOAD_LOG_BUCKET_PUBLIC_ACCESS_BLOCK = Object.freeze({
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

const AwsPartitionSchema = z.enum(["aws", "aws-cn", "aws-us-gov"]);
const AwsAccountIdSchema = z.string().regex(/^\d{12}$/u);
const TrailNameSchema = z.string().regex(/^[A-Za-z0-9._-]{3,128}$/u);

export function downloadMeteringTrailName(stageInput: unknown): string {
  const stage = classifyStage(stageInput);
  return TrailNameSchema.parse(`utility-services-${stage.name}-download-metering`);
}

export function downloadMeteringTrailArn(input: {
  readonly partition: string;
  readonly region: string;
  readonly accountId: string;
  readonly trailName: string;
}): string {
  const partition = AwsPartitionSchema.parse(input.partition);
  const region = z
    .string()
    .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/u)
    .parse(input.region);
  const accountId = AwsAccountIdSchema.parse(input.accountId);
  const trailName = TrailNameSchema.parse(input.trailName);
  return `arn:${partition}:cloudtrail:${region}:${accountId}:trail/${trailName}`;
}

export function cloudTrailRegionalLogPrefix(accountIdInput: string): string {
  const accountId = AwsAccountIdSchema.parse(accountIdInput);
  return `AWSLogs/${accountId}/CloudTrail/${AWS_REGION}/`;
}

export function cloudTrailAccountLogPrefix(accountIdInput: string): string {
  const accountId = AwsAccountIdSchema.parse(accountIdInput);
  return `AWSLogs/${accountId}/`;
}

export interface AdvancedEventSelector {
  readonly name: string;
  readonly fieldSelectors: ReadonlyArray<{
    readonly field: string;
    readonly equals?: readonly string[];
    readonly startsWiths?: readonly string[];
  }>;
}

export function downloadMeteringAdvancedSelectors(fileBucketArn: string): AdvancedEventSelector[] {
  const bucketArn = z
    .string()
    .regex(/^arn:(?:aws|aws-cn|aws-us-gov):s3:::[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u)
    .parse(fileBucketArn);
  return [
    {
      name: "Successful project GetObject data events",
      fieldSelectors: [
        { field: "eventCategory", equals: ["Data"] },
        { field: "resources.type", equals: ["AWS::S3::Object"] },
        { field: "eventName", equals: ["GetObject"] },
        { field: "readOnly", equals: ["true"] },
        { field: "resources.ARN", startsWiths: [`${bucketArn}/${FILE_OBJECT_PREFIX}`] },
      ],
    },
  ];
}

export function assertDownloadMeteringPolicy(): void {
  if (DOWNLOAD_METERING_QUEUE_VISIBILITY_SECONDS <= DOWNLOAD_METERING_PROCESSOR_TIMEOUT_SECONDS) {
    throw new Error("Metering queue visibility must exceed the processor timeout");
  }
  if (DOWNLOAD_METERING_DLQ_RETENTION_DAYS > DOWNLOAD_LOG_RETENTION_DAYS) {
    throw new Error("Raw logs must outlive terminal queue evidence");
  }
  const actions = [...DOWNLOAD_METERING_DYNAMO_ACTIONS, ...DOWNLOAD_METERING_LOG_ACTIONS];
  if (actions.some((action) => action.includes("*"))) {
    throw new Error("Download metering IAM actions must be explicit");
  }
}

assertDownloadMeteringPolicy();
