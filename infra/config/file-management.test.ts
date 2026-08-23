import { describe, expect, it } from "vitest";

import {
  FILE_BUCKET_POLICY,
  FILE_LIFECYCLE_INDEX_NAME,
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
  });

  it("keeps the bucket private, without CORS, and enforces TLS", () => {
    expect(FILE_BUCKET_POLICY.cors).toBe(false);
    expect(FILE_BUCKET_POLICY.forceDestroy).toBe(false);
    expect(Object.values(FILE_BUCKET_POLICY.publicAccessBlock).every(Boolean)).toBe(true);
    expect(FILE_BUCKET_POLICY.transportPolicy).toMatchObject({
      effect: "deny",
      principals: "*",
      conditions: [{ test: "Bool", variable: "aws:SecureTransport", values: ["false"] }],
    });
    expect(JSON.stringify(FILE_BUCKET_POLICY)).not.toMatch(/allowOrigins|public-read|s3:\*/u);
  });

  it("defines only JSON utility routes with explicit non-wildcard actions", () => {
    expect(FILE_ROUTES.map((route) => route.route)).toEqual([
      "POST /v1/files/uploads",
      "GET /v1/files",
      "GET /v1/files/{fileId}",
      "POST /v1/files/{fileId}/downloads",
      "GET /files/public/{publicProjectId}/{publicFileId}",
    ]);
    expect(FILE_ROUTES.map((route) => route.name)).toEqual([
      "AuthorizeFileUploadRoute",
      "ListFilesRoute",
      "InspectFileRoute",
      "AuthorizeFileDownloadRoute",
      "PublicFileDownloadRoute",
    ]);
    const privateDownload = FILE_ROUTES[3];
    expect(privateDownload).toMatchObject({
      handler: "packages/backend/src/functions/files/authorize-download.handler",
      controlTableActions: ["dynamodb:GetItem", "dynamodb:TransactGetItems"],
      fileTableActions: ["dynamodb:GetItem"],
      bucketActions: ["s3:GetObject"],
    });
    const publicDownload = FILE_ROUTES[4];
    expect(publicDownload).toMatchObject({
      handler: "packages/backend/src/functions/files/public-download.handler",
      controlTableActions: [],
      fileTableActions: [],
      bucketActions: ["s3:GetObject"],
    });
    expect(JSON.stringify([privateDownload, publicDownload])).not.toMatch(
      /PutObject|DeleteObject|ListBucket|s3:\*|dynamodb:\*/u,
    );
    expect(JSON.stringify(FILE_ROUTES)).not.toMatch(/body|bytes|s3:\*|dynamodb:\*/u);
    expect(fileTableDeletionProtection(true)).toBe(true);
    expect(fileTableDeletionProtection(false)).toBe(false);
  });
});
