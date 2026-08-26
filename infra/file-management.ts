import { configureLeastPrivilegeBucketLink } from "./bucket-link.js";
import {
  FILE_BUCKET_COMPONENT_NAME,
  FILE_BUCKET_POLICY,
  FILE_COMPLETION_BUCKET_ACTIONS,
  FILE_COMPLETION_COMPONENT_NAME,
  FILE_COMPLETION_TABLE_ACTIONS,
  FILE_COMPLETION_USAGE_ACTIONS,
  FILE_OBJECT_PREFIX,
  FILE_OPERATIONS_DLQ_COMPONENT_NAME,
  FILE_OPERATIONS_DLQ_POLICY_COMPONENT_NAME,
  FILE_OPERATIONS_DLQ_RETENTION_DAYS,
  FILE_OPERATIONS_MAXIMUM_EVENT_AGE_SECONDS,
  FILE_OPERATIONS_RETRY_COUNT,
  FILE_PURGE_BUCKET_ACTIONS,
  FILE_PURGE_COMPONENT_NAME,
  FILE_PURGE_SCHEDULE,
  FILE_PURGE_TABLE_ACTIONS,
  FILE_PURGE_USAGE_ACTIONS,
  FILE_RECONCILIATION_COMPONENT_NAME,
  FILE_RECONCILIATION_SCHEDULE,
  FILE_TABLE_COMPONENT_NAME,
  FILE_TABLE_POLICY,
  fileTableDeletionProtection,
} from "./config/file-management.js";
import { configureLeastPrivilegeDynamoLink } from "./dynamo-link.js";

interface FileResourceDependencies {
  readonly production: boolean;
  readonly controlTable: sst.aws.Dynamo;
  readonly usageTable: sst.aws.Dynamo;
}

export function createFileManagementResources(options: FileResourceDependencies) {
  configureLeastPrivilegeDynamoLink();
  configureLeastPrivilegeBucketLink();

  const table = new sst.aws.Dynamo(FILE_TABLE_COMPONENT_NAME, {
    fields: FILE_TABLE_POLICY.fields,
    primaryIndex: FILE_TABLE_POLICY.primaryIndex,
    globalIndexes: FILE_TABLE_POLICY.globalIndexes,
    deletionProtection: fileTableDeletionProtection(options.production),
  });
  const bucket = new sst.aws.Bucket(FILE_BUCKET_COMPONENT_NAME, {
    cors: FILE_BUCKET_POLICY.cors,
    enforceHttps: true,
    transform: {
      bucket(args) {
        args.forceDestroy = options.production ? FILE_BUCKET_POLICY.forceDestroy : true;
      },
      publicAccessBlock(args) {
        Object.assign(args, FILE_BUCKET_POLICY.publicAccessBlock);
      },
    },
  });
  const bucketEncryption = new aws.s3.BucketServerSideEncryptionConfiguration(
    "FileBucketEncryption",
    {
      bucket: bucket.name,
      rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" } }],
    },
    { dependsOn: [bucket] },
  );
  const operationsDlq = new sst.aws.Queue(FILE_OPERATIONS_DLQ_COMPONENT_NAME, {
    transform: {
      queue(args) {
        args.messageRetentionSeconds = FILE_OPERATIONS_DLQ_RETENTION_DAYS * 86_400;
        args.sqsManagedSseEnabled = true;
      },
    },
  });

  const objectResources = [$interpolate`${bucket.arn}/${FILE_OBJECT_PREFIX}*`];
  const workerPermissions = [
    { actions: [...FILE_COMPLETION_TABLE_ACTIONS], resources: [table.arn] },
    { actions: [...FILE_COMPLETION_BUCKET_ACTIONS], resources: objectResources },
    { actions: [...FILE_COMPLETION_USAGE_ACTIONS], resources: [options.usageTable.arn] },
  ];
  const completionFunction = {
    handler: "packages/backend/src/functions/files/process-upload-completion.handler",
    runtime: "nodejs24.x" as const,
    link: [table, bucket, options.usageTable],
    permissions: [
      ...workerPermissions,
      { actions: ["sqs:SendMessage"], resources: [operationsDlq.arn] },
    ],
    retries: FILE_OPERATIONS_RETRY_COUNT,
    transform: {
      function: { tracingConfig: { mode: "Active" as const } },
      eventInvokeConfig(args: { destinationConfig?: unknown }) {
        args.destinationConfig = { onFailure: { destination: operationsDlq.arn } };
      },
    },
  };
  const completionWorker = new sst.aws.Function(FILE_COMPLETION_COMPONENT_NAME, completionFunction);
  const notification = bucket.notify({
    notifications: [
      {
        name: FILE_COMPLETION_COMPONENT_NAME,
        events: ["s3:ObjectCreated:Put"],
        filterPrefix: FILE_OBJECT_PREFIX,
        function: completionWorker.arn,
      },
    ],
  });

  const reconciler = new sst.aws.Cron(FILE_RECONCILIATION_COMPONENT_NAME, {
    schedule: FILE_RECONCILIATION_SCHEDULE,
    function: {
      handler: "packages/backend/src/functions/files/reconcile-pending-uploads.handler",
      runtime: "nodejs24.x" as const,
      link: [table, bucket, options.usageTable],
      permissions: workerPermissions,
      transform: { function: { tracingConfig: { mode: "Active" as const } } },
    },
    transform: {
      target(args) {
        args.deadLetterConfig = { arn: operationsDlq.arn };
        args.retryPolicy = {
          maximumEventAgeInSeconds: FILE_OPERATIONS_MAXIMUM_EVENT_AGE_SECONDS,
          maximumRetryAttempts: FILE_OPERATIONS_RETRY_COUNT,
        };
      },
    },
  });

  const purge = new sst.aws.Cron(FILE_PURGE_COMPONENT_NAME, {
    schedule: FILE_PURGE_SCHEDULE,
    function: {
      handler: "packages/backend/src/functions/files/purge-trashed-files.handler",
      runtime: "nodejs24.x" as const,
      link: [table, bucket, options.usageTable],
      permissions: [
        { actions: [...FILE_PURGE_TABLE_ACTIONS], resources: [table.arn] },
        { actions: [...FILE_PURGE_BUCKET_ACTIONS], resources: objectResources },
        { actions: [...FILE_PURGE_USAGE_ACTIONS], resources: [options.usageTable.arn] },
      ],
      transform: { function: { tracingConfig: { mode: "Active" as const } } },
    },
    transform: {
      target(args) {
        args.deadLetterConfig = { arn: operationsDlq.arn };
        args.retryPolicy = {
          maximumEventAgeInSeconds: FILE_OPERATIONS_MAXIMUM_EVENT_AGE_SECONDS,
          maximumRetryAttempts: FILE_OPERATIONS_RETRY_COUNT,
        };
      },
    },
  });

  const operationsDlqPolicyDocument = aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: "AllowExactFileSchedules",
        effect: "Allow",
        actions: ["sqs:SendMessage"],
        resources: [operationsDlq.arn],
        principals: [{ type: "Service", identifiers: ["events.amazonaws.com"] }],
        conditions: [
          {
            test: "ArnEquals",
            variable: "aws:SourceArn",
            values: [reconciler.nodes.rule.arn, purge.nodes.rule.arn],
          },
        ],
      },
    ],
  });
  const operationsDlqPolicy = new aws.sqs.QueuePolicy(FILE_OPERATIONS_DLQ_POLICY_COMPONENT_NAME, {
    queueUrl: operationsDlq.url,
    policy: operationsDlqPolicyDocument.json,
  });

  return {
    table,
    bucket,
    bucketEncryption,
    operationsDlq,
    operationsDlqPolicy,
    completionWorker,
    notification,
    reconciler,
    purge,
  };
}
