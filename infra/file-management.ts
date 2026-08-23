import { configureLeastPrivilegeBucketLink } from "./bucket-link.js";
import {
  FILE_BUCKET_COMPONENT_NAME,
  FILE_BUCKET_POLICY,
  FILE_COMPLETION_BUCKET_ACTIONS,
  FILE_COMPLETION_BUCKET_LIST_ACTIONS,
  FILE_COMPLETION_COMPONENT_NAME,
  FILE_COMPLETION_TABLE_ACTIONS,
  FILE_COMPLETION_USAGE_ACTIONS,
  FILE_OBJECT_PREFIX,
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
    enforceHttps: false,
    policy: [FILE_BUCKET_POLICY.transportPolicy],
    transform: {
      bucket(args) {
        args.forceDestroy = options.production ? FILE_BUCKET_POLICY.forceDestroy : true;
      },
      publicAccessBlock(args) {
        Object.assign(args, FILE_BUCKET_POLICY.publicAccessBlock);
      },
    },
  });

  const objectResources = [$interpolate`${bucket.arn}/${FILE_OBJECT_PREFIX}*`];
  const workerFunction = {
    handler: "packages/backend/src/functions/files/process-upload-completion.handler",
    runtime: "nodejs24.x" as const,
    link: [table, bucket, options.usageTable],
    permissions: [
      { actions: [...FILE_COMPLETION_TABLE_ACTIONS], resources: [table.arn] },
      { actions: [...FILE_COMPLETION_BUCKET_ACTIONS], resources: objectResources },
      { actions: [...FILE_COMPLETION_BUCKET_LIST_ACTIONS], resources: [bucket.arn] },
      { actions: [...FILE_COMPLETION_USAGE_ACTIONS], resources: [options.usageTable.arn] },
    ],
    transform: { function: { tracingConfig: { mode: "Active" as const } } },
  };
  const notification = bucket.notify({
    notifications: [
      {
        name: FILE_COMPLETION_COMPONENT_NAME,
        events: ["s3:ObjectCreated:Put"],
        filterPrefix: FILE_OBJECT_PREFIX,
        function: workerFunction,
      },
    ],
  });

  const reconciler = new sst.aws.Cron(FILE_RECONCILIATION_COMPONENT_NAME, {
    schedule: FILE_RECONCILIATION_SCHEDULE,
    function: {
      ...workerFunction,
      handler: "packages/backend/src/functions/files/reconcile-pending-uploads.handler",
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
  });

  return { table, bucket, notification, reconciler, purge };
}
