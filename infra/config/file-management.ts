import { MAX_FILE_SIZE_BYTES } from "@utility-services/contracts";

export const FILE_TABLE_COMPONENT_NAME = "FileTable";
export const FILE_BUCKET_COMPONENT_NAME = "FileBucket";
export const FILE_COMPLETION_COMPONENT_NAME = "FileUploadCompletion";
export const FILE_RECONCILIATION_COMPONENT_NAME = "FileUploadReconciliation";
export const FILE_PURGE_COMPONENT_NAME = "FileTrashPurge";
export const PUBLIC_FILE_INDEX_NAME = "PublicFiles";
export const FILE_LIFECYCLE_INDEX_NAME = "FileLifecycle";
export const MAX_RETAINED_STORAGE_BYTES = 5n * 2n ** 30n;
export const UPLOAD_COMPLETION_GRACE_MINUTES = 60;
export const FILE_RECONCILIATION_SCHEDULE = "rate(5 minutes)";
export const FILE_PURGE_SCHEDULE = "rate(5 minutes)";
export const FILE_OBJECT_PREFIX = "projects/";

export { MAX_FILE_SIZE_BYTES };

export const FILE_TABLE_POLICY = {
  billingMode: "PAY_PER_REQUEST",
  fields: {
    pk: "string",
    sk: "string",
    gsi1pk: "string",
    gsi1sk: "string",
    gsi2pk: "string",
    gsi2sk: "string",
  },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  globalIndexes: {
    [PUBLIC_FILE_INDEX_NAME]: { hashKey: "gsi1pk", rangeKey: "gsi1sk", projection: "all" },
    [FILE_LIFECYCLE_INDEX_NAME]: {
      hashKey: "gsi2pk",
      rangeKey: "gsi2sk",
      projection: "all",
    },
  },
} as const;

export const FILE_BUCKET_POLICY = {
  cors: false,
  forceDestroy: false,
  publicAccessBlock: {
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  },
  transportPolicy: {
    actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
    effect: "deny",
    principals: "*",
    conditions: [{ test: "Bool", variable: "aws:SecureTransport", values: ["false"] }],
  },
} as const;

export const FILE_ROUTES = [
  {
    name: "AuthorizeFileUploadRoute",
    route: "POST /v1/files/uploads",
    handler: "packages/backend/src/functions/files/authorize-upload.handler",
    controlTableActions: ["dynamodb:GetItem", "dynamodb:TransactGetItems"],
    fileTableActions: ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems"],
    bucketActions: ["s3:PutObject"],
    usageTableActions: [],
  },
  {
    name: "ListFilesRoute",
    route: "GET /v1/files",
    handler: "packages/backend/src/functions/files/list-files.handler",
    controlTableActions: ["dynamodb:GetItem", "dynamodb:TransactGetItems"],
    fileTableActions: [],
    bucketActions: [],
    usageTableActions: [],
  },
  {
    name: "InspectFileRoute",
    route: "GET /v1/files/{fileId}",
    handler: "packages/backend/src/functions/files/inspect-file.handler",
    controlTableActions: ["dynamodb:GetItem", "dynamodb:TransactGetItems"],
    fileTableActions: ["dynamodb:GetItem"],
    bucketActions: [],
    usageTableActions: [],
  },
  {
    name: "AuthorizeFileDownloadRoute",
    route: "POST /v1/files/{fileId}/downloads",
    handler: "packages/backend/src/functions/files/authorize-download.handler",
    controlTableActions: ["dynamodb:GetItem", "dynamodb:TransactGetItems"],
    fileTableActions: ["dynamodb:GetItem"],
    bucketActions: ["s3:GetObject"],
    usageTableActions: [],
  },
  {
    name: "DeleteFileRoute",
    route: "DELETE /v1/files/{fileId}",
    handler: "packages/backend/src/functions/files/delete-file.handler",
    controlTableActions: ["dynamodb:GetItem", "dynamodb:TransactGetItems"],
    fileTableActions: ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems"],
    bucketActions: ["s3:DeleteObject"],
    usageTableActions: [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
      "dynamodb:TransactWriteItems",
    ],
  },
  {
    name: "RestoreFileRoute",
    route: "POST /v1/files/{fileId}/restore",
    handler: "packages/backend/src/functions/files/restore-file.handler",
    controlTableActions: ["dynamodb:GetItem", "dynamodb:TransactGetItems"],
    fileTableActions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
    bucketActions: [],
    usageTableActions: [],
  },
  {
    name: "PublicFileDownloadRoute",
    route: "GET /files/public/{publicProjectId}/{publicFileId}",
    handler: "packages/backend/src/functions/files/public-download.handler",
    controlTableActions: [],
    fileTableActions: ["dynamodb:GetItem"],
    bucketActions: ["s3:GetObject"],
    usageTableActions: [],
  },
] as const;

export const FILE_COMPLETION_TABLE_ACTIONS = [
  "dynamodb:GetItem",
  "dynamodb:Query",
  "dynamodb:UpdateItem",
  "dynamodb:TransactWriteItems",
] as const;
export const FILE_COMPLETION_BUCKET_ACTIONS = ["s3:GetObject", "s3:DeleteObject"] as const;
export const FILE_COMPLETION_BUCKET_LIST_ACTIONS = ["s3:ListBucket"] as const;
export const FILE_COMPLETION_USAGE_ACTIONS = [
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:Query",
  "dynamodb:UpdateItem",
  "dynamodb:TransactGetItems",
  "dynamodb:TransactWriteItems",
] as const;
export const FILE_PURGE_TABLE_ACTIONS = [
  "dynamodb:GetItem",
  "dynamodb:Query",
  "dynamodb:UpdateItem",
  "dynamodb:TransactWriteItems",
] as const;
export const FILE_PURGE_BUCKET_ACTIONS = ["s3:DeleteObject"] as const;
export const FILE_PURGE_USAGE_ACTIONS = [
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:Query",
  "dynamodb:UpdateItem",
  "dynamodb:TransactWriteItems",
] as const;

export function fileTableDeletionProtection(production: boolean): boolean {
  return production;
}
