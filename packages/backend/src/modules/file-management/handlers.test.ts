/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies method mocks */
import {
  MAX_FILE_SIZE_BYTES,
  type File,
  type TrustedProjectContext,
  type UploadAuthorization,
} from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import type { ProjectAuthenticationService } from "../project-authentication/service.js";
import { HttpError } from "../../core/http/handler.js";
import {
  createAuthorizeUploadHandler,
  createInspectFileHandler,
  createListFilesHandler,
} from "./handlers.js";
import type { FileService } from "./service.js";

const context: TrustedProjectContext = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  keyId: "key_0123456789abcdefghijkl",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
};
const timestamp = "2026-08-23T08:00:00.000Z";
const file: File = {
  fileId: "fil_0123456789abcdefghijkl",
  name: "file.txt",
  mediaType: "text/plain",
  sizeBytes: 12,
  visibility: "private",
  status: "pending",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const authorization: UploadAuthorization = {
  file,
  upload: {
    method: "PUT",
    url: "https://bucket.example.com/key?X-Amz-Signature=synthetic",
    expiresAt: "2026-08-23T08:15:00.000Z",
    requiredHeaders: {
      "content-type": "text/plain",
      "content-length": "12",
      "if-none-match": "*",
    },
  },
};

function authentication(): ProjectAuthenticationService {
  return { authenticate: vi.fn().mockResolvedValue(context) };
}

function service(): FileService {
  return {
    authorizeUpload: vi.fn().mockResolvedValue(authorization),
    list: vi.fn().mockResolvedValue({ items: [file] }),
    inspect: vi.fn().mockResolvedValue(file),
  };
}

function event(input: {
  method: string;
  path: string;
  body?: unknown;
  pathParameters?: Record<string, string>;
}) {
  return {
    requestContext: { requestId: "request-1", http: { method: input.method, path: input.path } },
    headers: { authorization: `Bearer rus_v1.${context.keyId}.${"s".repeat(43)}` },
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    ...(input.pathParameters ? { pathParameters: input.pathParameters } : {}),
  };
}

describe("file HTTP handlers", () => {
  it("returns 201 for JSON-only upload authorization", async () => {
    const files = service();
    const response = await createAuthorizeUploadHandler(
      files,
      authentication(),
    )(
      event({
        method: "POST",
        path: "/v1/files/uploads",
        body: { name: "file.txt", mediaType: "text/plain", sizeBytes: 12, visibility: "private" },
      }),
    );
    expect(response.statusCode).toBe(201);
    expect(files.authorizeUpload).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ sizeBytes: 12 }),
    );
  });

  it("rejects caller keys and byte payload fields before business logic", async () => {
    const files = service();
    const response = await createAuthorizeUploadHandler(
      files,
      authentication(),
    )(
      event({
        method: "POST",
        path: "/v1/files/uploads",
        body: {
          name: "file.txt",
          mediaType: "text/plain",
          sizeBytes: 12,
          visibility: "private",
          objectKey: "caller/key",
          bytes: "base64",
        },
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(files.authorizeUpload).not.toHaveBeenCalled();
  });

  it("lets the service return FILE_TOO_LARGE for an otherwise valid over-limit request", async () => {
    const files = service();
    vi.mocked(files.authorizeUpload).mockRejectedValue(
      new HttpError(413, "FILE_TOO_LARGE", "File exceeds the maximum size"),
    );
    const response = await createAuthorizeUploadHandler(
      files,
      authentication(),
    )(
      event({
        method: "POST",
        path: "/v1/files/uploads",
        body: {
          name: "file.txt",
          mediaType: "text/plain",
          sizeBytes: MAX_FILE_SIZE_BYTES + 1,
          visibility: "private",
        },
      }),
    );
    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      error: { code: "FILE_TOO_LARGE" },
    });
    expect(files.authorizeUpload).toHaveBeenCalledOnce();
  });

  it("exposes list and inspect through the same trusted authorization", async () => {
    const files = service();
    expect(
      (
        await createListFilesHandler(
          files,
          authentication(),
        )(event({ method: "GET", path: "/v1/files" }))
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await createInspectFileHandler(
          files,
          authentication(),
        )(
          event({
            method: "GET",
            path: `/v1/files/${file.fileId}`,
            pathParameters: { fileId: file.fileId },
          }),
        )
      ).statusCode,
    ).toBe(200);
  });
});
