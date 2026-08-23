import { describe, expect, it } from "vitest";

import {
  CreateUploadRequestSchema,
  DeleteFileQuerySchema,
  DeleteFileResultSchema,
  DownloadAuthorizationSchema,
  FileListQuerySchema,
  FileSchema,
  MAX_FILE_SIZE_BYTES,
  PublicFilePathSchema,
  UploadAuthorizationSchema,
} from "./contract.js";

const timestamp = "2026-08-23T08:00:00.000Z";
const privateFile = {
  fileId: "fil_0123456789abcdefghijkl",
  name: "photo.png",
  mediaType: "image/png",
  sizeBytes: 1024,
  visibility: "private",
  status: "pending",
  createdAt: timestamp,
  updatedAt: timestamp,
} as const;

describe("file contracts", () => {
  it("accepts the exact upload request and normalizes display metadata", () => {
    expect(
      CreateUploadRequestSchema.parse({
        name: "  מסמך.png  ",
        mediaType: "IMAGE/PNG",
        sizeBytes: MAX_FILE_SIZE_BYTES,
        visibility: "public",
      }),
    ).toEqual({
      name: "מסמך.png",
      mediaType: "image/png",
      sizeBytes: MAX_FILE_SIZE_BYTES,
      visibility: "public",
    });
  });

  it.each([
    { name: "", mediaType: "image/png", sizeBytes: 1, visibility: "private" },
    { name: "bad\nname", mediaType: "image/png", sizeBytes: 1, visibility: "private" },
    { name: "x", mediaType: "image/png; charset=utf-8", sizeBytes: 1, visibility: "private" },
    { name: "x", mediaType: "image", sizeBytes: 1, visibility: "private" },
    { name: "x", mediaType: "image/png", sizeBytes: 0, visibility: "private" },
    { name: "x", mediaType: "image/png", sizeBytes: 1.5, visibility: "private" },
    {
      name: "x",
      mediaType: "image/png",
      sizeBytes: MAX_FILE_SIZE_BYTES + 1,
      visibility: "private",
    },
    { name: "x", mediaType: "image/png", sizeBytes: 1, visibility: "shared" },
    {
      name: "x",
      mediaType: "image/png",
      sizeBytes: 1,
      visibility: "private",
      objectKey: "caller/key",
    },
  ])("rejects malformed or caller-controlled upload input", (value) => {
    expect(CreateUploadRequestSchema.safeParse(value).success).toBe(false);
  });

  it("enforces public identity consistency and excludes internal fields", () => {
    expect(FileSchema.parse(privateFile)).toEqual(privateFile);
    expect(
      FileSchema.safeParse({ ...privateFile, publicFileId: "pfil_0123456789abcdefghijkl" }).success,
    ).toBe(false);
    expect(
      FileSchema.safeParse({
        ...privateFile,
        visibility: "public",
        publicFileId: "pfil_0123456789abcdefghijkl",
      }).success,
    ).toBe(true);
    expect(FileSchema.safeParse({ ...privateFile, objectKey: "private" }).success).toBe(false);
    expect(FileSchema.safeParse({ ...privateFile, internalProjectId: "private" }).success).toBe(
      false,
    );
  });

  it("exposes lifecycle timestamps only for trashed files", () => {
    const trashed = {
      ...privateFile,
      status: "trashed",
      trashedAt: timestamp,
      purgeAt: "2026-09-06T08:00:00.000Z",
    } as const;
    expect(FileSchema.parse(trashed)).toEqual(trashed);
    expect(FileSchema.safeParse({ ...trashed, purgeAt: timestamp }).success).toBe(true);
    expect(FileSchema.safeParse({ ...trashed, purgeAt: "2026-08-23T07:59:59.999Z" }).success).toBe(
      false,
    );
    expect(FileSchema.safeParse({ ...trashed, purgeAt: undefined }).success).toBe(false);
    expect(
      FileSchema.safeParse({ ...privateFile, trashedAt: timestamp, purgeAt: trashed.purgeAt })
        .success,
    ).toBe(false);
    expect(FileSchema.safeParse({ ...trashed, purgeStartedAt: timestamp }).success).toBe(false);
    expect(FileSchema.safeParse({ ...trashed, objectRemovedAt: timestamp }).success).toBe(false);
  });

  it("parses explicit force confirmation and strict deletion results", () => {
    expect(DeleteFileQuerySchema.parse({})).toEqual({ force: false });
    expect(DeleteFileQuerySchema.parse({ force: "false" })).toEqual({ force: false });
    expect(DeleteFileQuerySchema.parse({ force: "true" })).toEqual({ force: true });
    for (const force of ["TRUE", "1", "", true]) {
      expect(DeleteFileQuerySchema.safeParse({ force }).success).toBe(false);
    }

    expect(
      DeleteFileResultSchema.parse({
        fileId: privateFile.fileId,
        disposition: "trashed",
        purgeAt: "2026-09-06T08:00:00.000Z",
      }),
    ).toMatchObject({ disposition: "trashed" });
    expect(
      DeleteFileResultSchema.parse({ fileId: privateFile.fileId, disposition: "purged" }),
    ).toMatchObject({ disposition: "purged" });
    expect(
      DeleteFileResultSchema.parse({
        fileId: privateFile.fileId,
        disposition: "purge-pending",
        purgeAt: "2026-08-23T08:05:00.000Z",
      }),
    ).toMatchObject({ disposition: "purge-pending" });
    expect(
      DeleteFileResultSchema.safeParse({
        fileId: privateFile.fileId,
        disposition: "purge-pending",
      }).success,
    ).toBe(false);
    expect(
      DeleteFileResultSchema.safeParse({
        fileId: privateFile.fileId,
        disposition: "purged",
        purgeAt: timestamp,
      }).success,
    ).toBe(false);
  });

  it("accepts only an opaque HTTPS PUT authorization with exact required headers", () => {
    const authorization = {
      file: privateFile,
      upload: {
        method: "PUT",
        url: "https://files.example.com/path?X-Amz-Signature=synthetic",
        expiresAt: timestamp,
        requiredHeaders: {
          "content-type": "image/png",
          "content-length": "1024",
          "if-none-match": "*",
        },
      },
    } as const;
    expect(UploadAuthorizationSchema.parse(authorization)).toEqual(authorization);
    expect(
      UploadAuthorizationSchema.safeParse({
        ...authorization,
        upload: { ...authorization.upload, url: "http://files.example.com/path" },
      }).success,
    ).toBe(false);
    expect(
      UploadAuthorizationSchema.safeParse({
        ...authorization,
        upload: {
          ...authorization.upload,
          requiredHeaders: {
            ...authorization.upload.requiredHeaders,
            "if-none-match": "changed",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      UploadAuthorizationSchema.safeParse({
        ...authorization,
        upload: { ...authorization.upload, bucket: "private-bucket" },
      }).success,
    ).toBe(false);
  });

  it("accepts exact public file paths", () => {
    const path = {
      publicProjectId: "prj_0123456789abcdefghijkl",
      publicFileId: "pfil_0123456789abcdefghijkl",
    };
    expect(PublicFilePathSchema.parse(path)).toEqual(path);
    expect(PublicFilePathSchema.safeParse({ ...path, fileId: privateFile.fileId }).success).toBe(
      false,
    );
    expect(
      PublicFilePathSchema.safeParse({ ...path, publicProjectId: "prj_invalid" }).success,
    ).toBe(false);
    expect(PublicFilePathSchema.safeParse({ ...path, publicFileId: "pfil_invalid" }).success).toBe(
      false,
    );
  });

  it("accepts only an opaque HTTPS GET authorization with exact public metadata", () => {
    const authorization = {
      file: privateFile,
      download: {
        method: "GET",
        url: "https://files.example.com/path?X-Amz-Signature=synthetic",
        expiresAt: timestamp,
      },
    } as const;
    expect(DownloadAuthorizationSchema.parse(authorization)).toEqual(authorization);
    expect(
      DownloadAuthorizationSchema.safeParse({
        ...authorization,
        download: { ...authorization.download, url: "http://files.example.com/path" },
      }).success,
    ).toBe(false);
    expect(
      DownloadAuthorizationSchema.safeParse({
        ...authorization,
        download: { ...authorization.download, method: "PUT" },
      }).success,
    ).toBe(false);
    expect(
      DownloadAuthorizationSchema.safeParse({
        ...authorization,
        download: { method: "GET", url: authorization.download.url },
      }).success,
    ).toBe(false);
    expect(
      DownloadAuthorizationSchema.safeParse({
        ...authorization,
        download: { ...authorization.download, objectKey: "projects/private/file" },
      }).success,
    ).toBe(false);
    expect(
      DownloadAuthorizationSchema.safeParse({ ...authorization, bucket: "private-bucket" }).success,
    ).toBe(false);
    expect(
      DownloadAuthorizationSchema.safeParse({
        ...authorization,
        file: {
          ...privateFile,
          visibility: "public",
        },
      }).success,
    ).toBe(false);
  });

  it("applies bounded list defaults and rejects unsafe cursors", () => {
    expect(FileListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(FileListQuerySchema.parse({ limit: "50", cursor: "safe_cursor" })).toEqual({
      limit: 50,
      cursor: "safe_cursor",
    });
    expect(FileListQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(FileListQuerySchema.safeParse({ cursor: "unsafe+cursor" }).success).toBe(false);
  });
});
