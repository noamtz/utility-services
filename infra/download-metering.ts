import { configureLeastPrivilegeBucketLink } from "./bucket-link.js";
import {
  CLOUDTRAIL_LOG_SUFFIX,
  DOWNLOAD_LOG_BUCKET_COMPONENT_NAME,
  DOWNLOAD_LOG_BUCKET_PUBLIC_ACCESS_BLOCK,
  DOWNLOAD_LOG_RETENTION_DAYS,
  DOWNLOAD_METERING_AWS_ACCOUNT_ID,
  DOWNLOAD_METERING_AWS_PARTITION,
  DOWNLOAD_METERING_DLQ_COMPONENT_NAME,
  DOWNLOAD_METERING_DLQ_RETENTION_DAYS,
  DOWNLOAD_METERING_DYNAMO_ACTIONS,
  DOWNLOAD_METERING_LOG_ACTIONS,
  DOWNLOAD_METERING_NOTIFICATION_COMPONENT_NAME,
  DOWNLOAD_METERING_PROCESSOR_COMPONENT_NAME,
  DOWNLOAD_METERING_PROCESSOR_MEMORY_MB,
  DOWNLOAD_METERING_PROCESSOR_TIMEOUT_SECONDS,
  DOWNLOAD_METERING_QUEUE_COMPONENT_NAME,
  DOWNLOAD_METERING_QUEUE_RETRY_COUNT,
  DOWNLOAD_METERING_QUEUE_VISIBILITY_SECONDS,
  DOWNLOAD_METERING_SOURCE_KIND,
  DOWNLOAD_METERING_TRAIL_COMPONENT_NAME,
  DOWNLOAD_PRICING_MODE,
  MAX_CLOUDTRAIL_COMPRESSED_BYTES,
  MAX_CLOUDTRAIL_INFLATED_BYTES,
  MAX_CLOUDTRAIL_RECORDS,
  cloudTrailAccountLogPrefix,
  cloudTrailRegionalLogPrefix,
  downloadMeteringAdvancedSelectors,
  downloadMeteringTrailArn,
  downloadMeteringTrailName,
} from "./config/download-metering.js";
import { AWS_REGION } from "./config/app.js";
import { configureLeastPrivilegeDynamoLink } from "./dynamo-link.js";

interface DownloadMeteringResourceDependencies {
  readonly production: boolean;
  readonly fileBucket: sst.aws.Bucket;
  readonly usageTable: sst.aws.Dynamo;
}

export function createDownloadMeteringResources(options: DownloadMeteringResourceDependencies) {
  configureLeastPrivilegeBucketLink();
  configureLeastPrivilegeDynamoLink();

  const trailName = downloadMeteringTrailName($app.stage);
  const trailArn = downloadMeteringTrailArn({
    partition: DOWNLOAD_METERING_AWS_PARTITION,
    region: AWS_REGION,
    accountId: DOWNLOAD_METERING_AWS_ACCOUNT_ID,
    trailName,
  });
  const regionalLogPrefix = cloudTrailRegionalLogPrefix(DOWNLOAD_METERING_AWS_ACCOUNT_ID);
  const accountLogPrefix = cloudTrailAccountLogPrefix(DOWNLOAD_METERING_AWS_ACCOUNT_ID);

  const logBucket = new sst.aws.Bucket(DOWNLOAD_LOG_BUCKET_COMPONENT_NAME, {
    cors: false,
    enforceHttps: true,
    policy: [
      {
        actions: ["s3:GetBucketAcl"],
        principals: [{ type: "service", identifiers: ["cloudtrail.amazonaws.com"] }],
        paths: [""],
        conditions: [{ test: "StringEquals", variable: "aws:SourceArn", values: [trailArn] }],
      },
      {
        actions: ["s3:PutObject"],
        principals: [{ type: "service", identifiers: ["cloudtrail.amazonaws.com"] }],
        paths: [`${accountLogPrefix}*`],
        conditions: [
          {
            test: "StringEquals",
            variable: "s3:x-amz-acl",
            values: ["bucket-owner-full-control"],
          },
          { test: "StringEquals", variable: "aws:SourceArn", values: [trailArn] },
        ],
      },
    ],
    lifecycle: [
      {
        id: "expire-cloudtrail-download-logs",
        prefix: accountLogPrefix,
        expiresIn: `${DOWNLOAD_LOG_RETENTION_DAYS} days`,
      },
    ],
    transform: {
      bucket(args) {
        args.forceDestroy = options.production ? false : true;
      },
      publicAccessBlock(args) {
        Object.assign(args, DOWNLOAD_LOG_BUCKET_PUBLIC_ACCESS_BLOCK);
      },
    },
  });

  const deadLetterQueue = new sst.aws.Queue(DOWNLOAD_METERING_DLQ_COMPONENT_NAME, {
    visibilityTimeout: `${DOWNLOAD_METERING_QUEUE_VISIBILITY_SECONDS} seconds`,
    transform: {
      queue(args) {
        args.messageRetentionSeconds = DOWNLOAD_METERING_DLQ_RETENTION_DAYS * 86_400;
        args.sqsManagedSseEnabled = true;
      },
    },
  });
  const queue = new sst.aws.Queue(DOWNLOAD_METERING_QUEUE_COMPONENT_NAME, {
    visibilityTimeout: `${DOWNLOAD_METERING_QUEUE_VISIBILITY_SECONDS} seconds`,
    dlq: { queue: deadLetterQueue.arn, retry: DOWNLOAD_METERING_QUEUE_RETRY_COUNT },
    transform: {
      queue(args) {
        args.sqsManagedSseEnabled = true;
      },
    },
  });

  const queuePolicyDocument = aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: "AllowExactLogBucketProducer",
        effect: "Allow",
        actions: ["sqs:SendMessage"],
        resources: [queue.arn],
        principals: [{ type: "Service", identifiers: ["s3.amazonaws.com"] }],
        conditions: [
          { test: "ArnEquals", variable: "aws:SourceArn", values: [logBucket.arn] },
          {
            test: "StringEquals",
            variable: "aws:SourceAccount",
            values: [DOWNLOAD_METERING_AWS_ACCOUNT_ID],
          },
        ],
      },
    ],
  });
  const queuePolicy = new aws.sqs.QueuePolicy("DownloadMeteringQueuePolicy", {
    queueUrl: queue.url,
    policy: queuePolicyDocument.json,
  });

  const processor = new sst.aws.Function(DOWNLOAD_METERING_PROCESSOR_COMPONENT_NAME, {
    handler: "packages/backend/src/functions/usage-pricing/process-download-metering.handler",
    runtime: "nodejs24.x",
    timeout: `${DOWNLOAD_METERING_PROCESSOR_TIMEOUT_SECONDS} seconds`,
    memory: `${DOWNLOAD_METERING_PROCESSOR_MEMORY_MB} MB`,
    environment: {
      DOWNLOAD_PRICING_MODE,
      DOWNLOAD_METERING_SOURCE_KIND,
      CLOUDTRAIL_ACCOUNT_ID: DOWNLOAD_METERING_AWS_ACCOUNT_ID,
      CLOUDTRAIL_REGION: AWS_REGION,
      CLOUDTRAIL_LOG_PREFIX: regionalLogPrefix,
      FILE_BUCKET_NAME: options.fileBucket.name,
      MAX_CLOUDTRAIL_COMPRESSED_BYTES: String(MAX_CLOUDTRAIL_COMPRESSED_BYTES),
      MAX_CLOUDTRAIL_INFLATED_BYTES: String(MAX_CLOUDTRAIL_INFLATED_BYTES),
      MAX_CLOUDTRAIL_RECORDS: String(MAX_CLOUDTRAIL_RECORDS),
    },
    link: [logBucket, options.usageTable],
    permissions: [
      {
        actions: [...DOWNLOAD_METERING_LOG_ACTIONS],
        resources: [$interpolate`${logBucket.arn}/${regionalLogPrefix}*`],
      },
      { actions: [...DOWNLOAD_METERING_DYNAMO_ACTIONS], resources: [options.usageTable.arn] },
      {
        actions: [
          "sqs:ChangeMessageVisibility",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ReceiveMessage",
        ],
        resources: [queue.arn],
      },
    ],
    transform: { function: { tracingConfig: { mode: "Active" } } },
  });
  const subscription = queue.subscribe(processor.arn, { batch: { size: 1 } });

  const notification = new aws.s3.BucketNotification(
    DOWNLOAD_METERING_NOTIFICATION_COMPONENT_NAME,
    {
      bucket: logBucket.name,
      queues: [
        {
          id: DOWNLOAD_METERING_NOTIFICATION_COMPONENT_NAME,
          queueArn: queue.arn,
          events: ["s3:ObjectCreated:Put"],
          filterPrefix: regionalLogPrefix,
          filterSuffix: CLOUDTRAIL_LOG_SUFFIX,
        },
      ],
    },
    { dependsOn: [queuePolicy] },
  );

  const trail = new aws.cloudtrail.Trail(
    DOWNLOAD_METERING_TRAIL_COMPONENT_NAME,
    {
      name: trailName,
      s3BucketName: logBucket.name,
      enableLogging: true,
      enableLogFileValidation: true,
      includeGlobalServiceEvents: false,
      isMultiRegionTrail: false,
      isOrganizationTrail: false,
      advancedEventSelectors: options.fileBucket.arn.apply((arn) =>
        downloadMeteringAdvancedSelectors(arn),
      ),
    },
    // Depending on the component orders the trail after its synthesized HTTPS and CloudTrail
    // delivery bucket policy without creating a second competing BucketPolicy resource.
    { dependsOn: [logBucket] },
  );

  return {
    logBucket,
    deadLetterQueue,
    queue,
    processor,
    subscription,
    queuePolicy,
    notification,
    trail,
  };
}
