import { describe, expect, it } from "vitest";

import {
  FILE_BUCKET_POLICY,
  FILE_LIFECYCLE_INDEX_NAME,
  FILE_OPERATIONS_DLQ_RETENTION_DAYS,
  FILE_OPERATIONS_MAXIMUM_EVENT_AGE_SECONDS,
  FILE_OPERATIONS_RETRY_COUNT,
  FILE_PURGE_BUCKET_ACTIONS,
  FILE_PURGE_SCHEDULE,
  FILE_PURGE_TABLE_ACTIONS,
  FILE_PURGE_USAGE_ACTIONS,
  FILE_RECONCILIATION_SCHEDULE,
  FILE_ROUTES,
  FILE_TABLE_POLICY,
  MAX_FILE_SIZE_BYTES,
  MAX_RETAINED_STORAGE_BYTES,
  PUBLIC_FILE_INDEX_NAME,
  UPLOAD_COMPLETION_GRACE_MINUTES,
  fileTableDeletionProtection,
} from "./file-management.js";

describe("file management infrastructure policy", () => {
  it("locks table indexes, binary limits, and bounded reconciliation", () => {
    expect(FILE_TABLE_POLICY.primaryIndex).toEqual({ hashKey: "pk", rangeKey: "sk" });
    expect(Object.keys(FILE_TABLE_POLICY.globalIndexes)).toEqual([
      PUBLIC_FILE_INDEX_NAME,
      FILE_LIFECYCLE_INDEX_NAME,
    ]);
    expect(MAX_FILE_SIZE_BYTES).toBe(100 * 2 ** 20);
    expect(MAX_RETAINED_STORAGE_BYTES).toBe(5n * 2n ** 30n);
    expect(UPLOAD_COMPLETION_GRACE_MINUTES).toBe(60);
    expect(FILE_RECONCILIATION_SCHEDULE).toBe("rate(5 minutes)");
    expect(FILE_PURGE_SCHEDULE).toBe("rate(5 minutes)");
    expect(FILE_OPERATIONS_MAXIMUM_EVENT_AGE_SECONDS).toBe(3_600);
    expect(FILE_OPERATIONS_MAXIMUM_EVENT_AGE_SECONDS).toBeGreaterThanOrEqual(60);
    expect(FILE_OPERATIONS_MAXIMUM_EVENT_AGE_SECONDS).toBeLessThanOrEqual(86_400);
    expect(FILE_OPERATIONS_RETRY_COUNT).toBe(2);
    expect(FILE_OPERATIONS_DLQ_RETENTION_DAYS).toBe(14);
  });

  it("keeps the bucket private, without CORS, and enforces TLS", () => {
    expect(FILE_BUCKET_POLICY.cors).toBe(false);
    expect(FILE_BUCKET_POLICY.forceDestroy).toBe(false);
    expect(Object.values(FILE_BUCKET_POLICY.publicAccessBlock).every(Boolean)).toBe(true);
    expect(JSON.stringify(FILE_BUCKET_POLICY)).not.toMatch(/allowOrigins|public-read|s3:\*/u);
  });

  it("defines only JSON utility routes with explicit non-wildcard actions", () => {
    expect(FILE_ROUTES.map((route) => route.route)).toEqual([
      "POST /v1/files/uploads",
      "GET /v1/files",
      "GET /v1/files/{fileId}",
      "POST /v1/files/{fileId}/downloads",
      "DELETE /v1/files/{fileId}",
      "POST /v1/files/{fileId}/restore",
      "GET /files/public/{publicProjectId}/{publicFileId}",
    ]);
    expect(FILE_ROUTES.map((route) => route.name)).toEqual([
      "AuthorizeFileUploadRoute",
      "ListFilesRoute",
      "InspectFileRoute",
      "AuthorizeFileDownloadRoute",
      "DeleteFileRoute",
      "RestoreFileRoute",
      "PublicFileDownloadRoute",
    ]);
    expect(FILE_ROUTES[0]).toMatchObject({
      fileTableActions: ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems"],
    });
    const privateDownload = FILE_ROUTES[3];
    expect(privateDownload).toMatchObject({
      handler: "packages/backend/src/functions/files/authorize-download.handler",
      controlTableActions: ["dynamodb:GetItem", "dynamodb:TransactGetItems", "dynamodb:UpdateItem"],
      fileTableActions: ["dynamodb:GetItem"],
      bucketActions: ["s3:GetObject"],
    });
    const deletion = FILE_ROUTES[4];
    expect(deletion).toMatchObject({
      handler: "packages/backend/src/functions/files/delete-file.handler",
      fileTableActions: [
        "dynamodb:DeleteItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:TransactWriteItems",
      ],
      bucketActions: ["s3:DeleteObject"],
    });
    expect(deletion?.usageTableActions).toContain("dynamodb:GetItem");
    expect(deletion?.usageTableActions).toContain("dynamodb:TransactWriteItems");
    const restore = FILE_ROUTES[5];
    expect(restore).toMatchObject({
      handler: "packages/backend/src/functions/files/restore-file.handler",
      fileTableActions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      bucketActions: [],
      usageTableActions: [],
    });
    const publicDownload = FILE_ROUTES[6];
    expect(publicDownload).toMatchObject({
      handler: "packages/backend/src/functions/files/public-download.handler",
      controlTableActions: [],
      fileTableActions: ["dynamodb:GetItem"],
      bucketActions: ["s3:GetObject"],
    });
    expect(JSON.stringify([privateDownload, restore, publicDownload])).not.toMatch(
      /PutObject|DeleteObject|ListBucket|s3:\*|dynamodb:\*/u,
    );
    expect(JSON.stringify(FILE_ROUTES)).not.toMatch(/body|bytes|s3:\*|dynamodb:\*/u);
    expect(FILE_PURGE_TABLE_ACTIONS).toContain("dynamodb:DeleteItem");
    expect(FILE_PURGE_TABLE_ACTIONS).toContain("dynamodb:Query");
    expect(FILE_PURGE_BUCKET_ACTIONS).toEqual(["s3:DeleteObject"]);
    expect(FILE_PURGE_USAGE_ACTIONS).toContain("dynamodb:TransactWriteItems");
    expect(JSON.stringify(FILE_ROUTES)).not.toContain("s3:ListBucket");
    expect(fileTableDeletionProtection(true)).toBe(true);
    expect(fileTableDeletionProtection(false)).toBe(false);
  });
});
