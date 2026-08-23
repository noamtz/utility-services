/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies method mocks */
import {
  MAX_FILE_SIZE_BYTES,
  type DownloadAuthorization,
  type DeleteFileResult,
  type File,
  type TrustedProjectContext,
  type UploadAuthorization,
} from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import type { ProjectAuthenticationService } from "../project-authentication/service.js";
import { HttpError } from "../../core/http/handler.js";
import {
  createAuthorizeDownloadHandler,
  createAuthorizeUploadHandler,
  createDeleteFileHandler,
  createInspectFileHandler,
  createListFilesHandler,
  createPublicDownloadHandler,
  createRestoreFileHandler,
} from "./handlers.js";
import type { FileLifecycleService } from "./lifecycle.js";
import type { DownloadService } from "./downloads.js";
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
const readyFile: File = { ...file, status: "ready" };
const downloadAuthorization: DownloadAuthorization = {
  file: readyFile,
  download: {
    method: "GET",
    url: "https://bucket.example.com/key?X-Amz-Signature=synthetic",
    expiresAt: "2026-08-23T08:05:00.000Z",
  },
};
const deleteResult: DeleteFileResult = {
  fileId: file.fileId,
  disposition: "trashed",
  purgeAt: "2026-09-07T08:00:00.000Z",
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

function downloads(): DownloadService {
  return {
    authorizePrivate: vi.fn().mockResolvedValue(downloadAuthorization),
    authorizePublic: vi.fn().mockResolvedValue(downloadAuthorization.download.url),
  };
}

function lifecycle(): FileLifecycleService {
  return {
    delete: vi.fn().mockResolvedValue(deleteResult),
    restore: vi.fn().mockResolvedValue(readyFile),
    purgeDue: vi.fn(),
  };
}

function event(input: {
  method: string;
  path: string;
  body?: unknown;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
}) {
  return {
    requestContext: { requestId: "request-1", http: { method: input.method, path: input.path } },
    headers: { authorization: `Bearer rus_v1.${context.keyId}.${"s".repeat(43)}` },
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    ...(input.pathParameters ? { pathParameters: input.pathParameters } : {}),
    ...(input.queryStringParameters ? { queryStringParameters: input.queryStringParameters } : {}),
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

  it("returns a validated private download envelope from trusted authorization", async () => {
    const downloadService = downloads();
    const response = await createAuthorizeDownloadHandler(
      downloadService,
      authentication(),
    )(
      event({
        method: "POST",
        path: `/v1/files/${file.fileId}/downloads`,
        pathParameters: { fileId: file.fileId },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      data: downloadAuthorization,
      requestId: "request-1",
    });
    expect(downloadService.authorizePrivate).toHaveBeenCalledWith(context, file.fileId);
  });

  it.each([undefined, "Bearer malformed"])(
    "rejects a missing or malformed private bearer before download lookup",
    async (authorizationHeader) => {
      const downloadService = downloads();
      const request = {
        ...event({
          method: "POST",
          path: `/v1/files/${file.fileId}/downloads`,
          pathParameters: { fileId: file.fileId },
        }),
        headers: authorizationHeader ? { authorization: authorizationHeader } : {},
      };
      const response = await createAuthorizeDownloadHandler(
        downloadService,
        authentication(),
      )(request);

      expect(response.statusCode).toBe(401);
      expect(downloadService.authorizePrivate).not.toHaveBeenCalled();
    },
  );

  it("returns a fixed public redirect without authenticating or logging the URL", async () => {
    const downloadService = downloads();
    const logger = { info: vi.fn(), error: vi.fn() };
    const response = await createPublicDownloadHandler(
      downloadService,
      logger,
    )(
      event({
        method: "GET",
        path: `/files/public/${context.publicProjectId}/pfil_0123456789abcdefghijkl`,
        pathParameters: {
          publicProjectId: context.publicProjectId,
          publicFileId: "pfil_0123456789abcdefghijkl",
        },
      }),
    );

    expect(response).toEqual({
      statusCode: 302,
      headers: {
        location: downloadAuthorization.download.url,
        "cache-control": "no-store",
        "x-request-id": "request-1",
      },
      body: "",
    });
    expect(downloadService.authorizePublic).toHaveBeenCalledWith(
      context.publicProjectId,
      "pfil_0123456789abcdefghijkl",
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("X-Amz-Signature");
  });

  it("uses shared validation and not-found responses on the public route", async () => {
    const downloadService = downloads();
    const malformed = await createPublicDownloadHandler(downloadService)(
      event({
        method: "GET",
        path: "/files/public/bad/bad",
        pathParameters: { publicProjectId: "bad", publicFileId: "bad" },
      }),
    );
    expect(malformed.statusCode).toBe(400);
    expect(downloadService.authorizePublic).not.toHaveBeenCalled();

    vi.mocked(downloadService.authorizePublic).mockRejectedValue(
      new HttpError(404, "FILE_NOT_FOUND", "File not found"),
    );
    const missing = await createPublicDownloadHandler(downloadService)(
      event({
        method: "GET",
        path: `/files/public/${context.publicProjectId}/pfil_0123456789abcdefghijkl`,
        pathParameters: {
          publicProjectId: context.publicProjectId,
          publicFileId: "pfil_0123456789abcdefghijkl",
        },
      }),
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.headers).not.toHaveProperty("location");
  });

  it("requires exact force confirmation and returns a deletion envelope", async () => {
    const service = lifecycle();
    const pendingForceResult: DeleteFileResult = {
      fileId: file.fileId,
      disposition: "purge-pending",
      purgeAt: "2026-08-23T08:20:00.000Z",
    };
    vi.mocked(service.delete).mockResolvedValue(pendingForceResult);
    const response = await createDeleteFileHandler(
      service,
      authentication(),
    )(
      event({
        method: "DELETE",
        path: `/v1/files/${file.fileId}`,
        pathParameters: { fileId: file.fileId },
        queryStringParameters: { force: "true" },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      data: pendingForceResult,
      requestId: "request-1",
    });
    expect(service.delete).toHaveBeenCalledWith(context, file.fileId, { force: true });

    const malformed = await createDeleteFileHandler(
      service,
      authentication(),
    )(
      event({
        method: "DELETE",
        path: `/v1/files/${file.fileId}`,
        pathParameters: { fileId: file.fileId },
        queryStringParameters: { force: "TRUE" },
      }),
    );
    expect(malformed.statusCode).toBe(400);
    expect(service.delete).toHaveBeenCalledOnce();
  });

  it("defaults delete to trash and restores through trusted project context", async () => {
    const service = lifecycle();
    await createDeleteFileHandler(
      service,
      authentication(),
    )(
      event({
        method: "DELETE",
        path: `/v1/files/${file.fileId}`,
        pathParameters: { fileId: file.fileId },
      }),
    );
    expect(service.delete).toHaveBeenCalledWith(context, file.fileId, { force: false });

    const restored = await createRestoreFileHandler(
      service,
      authentication(),
    )(
      event({
        method: "POST",
        path: `/v1/files/${file.fileId}/restore`,
        pathParameters: { fileId: file.fileId },
      }),
    );
    expect(restored.statusCode).toBe(200);
    expect(service.restore).toHaveBeenCalledWith(context, file.fileId);
  });
});
