import { describe, expect, it } from "vitest";

import {
  CreateUploadRequestSchema,
  FileListQuerySchema,
  FileSchema,
  MAX_FILE_SIZE_BYTES,
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
