/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/unbound-method -- typed Vitest repository test doubles */
import { MAX_FILE_SIZE_BYTES, type TrustedProjectContext } from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { encodeFileCursor } from "./cursor.js";
import { createPendingFile, type FileItem } from "./model.js";
import type { UploadPresigner } from "./presigning.js";
import {
  FileCollisionError,
  StorageQuotaExceededError,
  type FileRepository,
} from "./repository.js";
import { createFileService } from "./service.js";

const project: TrustedProjectContext = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  keyId: "key_0123456789abcdefghijkl",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
};
const timestamp = "2026-08-23T08:00:00.000Z";
const fileId = "fil_0123456789abcdefghijkl";
const publicFileId = "pfil_0123456789abcdefghijkl";

function file(): FileItem {
  return createPendingFile({
    internalProjectId: project.internalProjectId,
    publicProjectId: project.publicProjectId,
    fileId,
    name: "file.txt",
    mediaType: "text/plain",
    sizeBytes: 12n,
    visibility: "private",
    uploadExpiresAt: "2026-08-23T08:15:00.000Z",
    failureEligibleAt: "2026-08-23T09:15:00.000Z",
    createdAt: timestamp,
  });
}

function repository(overrides: Partial<FileRepository> = {}): FileRepository {
  return {
    get: vi.fn().mockResolvedValue(file()),
    getPublic: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ items: [file()] }),
    reservePending: vi.fn().mockResolvedValue(undefined),
    claimCompletion: vi.fn(),
    finalizeReady: vi.fn(),
    claimFailure: vi.fn().mockImplementation(async (value, reason, cleanup, now) => ({
      ...value,
      failureCode: reason,
      cleanupRequired: cleanup,
      updatedAt: now,
      revision: value.revision + 1n,
    })),
    completeFailureCleanup: vi.fn().mockImplementation(async (value) => value),
    finalizeFailed: vi.fn().mockImplementation(async (value) => value),
    listDuePending: vi.fn().mockResolvedValue({ items: [] }),
    trash: vi.fn(),
    restore: vi.fn(),
    claimPermanentRemoval: vi.fn(),
    recordObjectRemoved: vi.fn(),
    finalizePermanentRemoval: vi.fn(),
    listDuePurge: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  };
}

function presigner(overrides: Partial<UploadPresigner> = {}): UploadPresigner {
  return {
    authorizePut: vi.fn().mockResolvedValue({
      url: "https://bucket.example.com/key?X-Amz-Signature=synthetic",
      requiredHeaders: {
        "content-type": "text/plain",
        "content-length": "12",
        "if-none-match": "*",
      },
    }),
    ...overrides,
  };
}

describe("file service", () => {
  it("reserves and returns an opaque settings-derived upload authorization", async () => {
    const repo = repository();
    const sign = presigner();
    const service = createFileService({
      repository: repo,
      presigner: sign,
      generateIds: () => ({ fileId, publicFileId }),
      now: () => new Date(timestamp),
    });
    const result = await service.authorizeUpload(project, {
      name: "file.txt",
      mediaType: "text/plain",
      sizeBytes: 12,
      visibility: "private",
    });
    expect(result).toMatchObject({
      file: { fileId, status: "pending", visibility: "private" },
      upload: {
        method: "PUT",
        expiresAt: "2026-08-23T08:15:00.000Z",
        requiredHeaders: { "if-none-match": "*" },
      },
    });
    expect(repo.reservePending).toHaveBeenCalledOnce();
    expect(sign.authorizePut).toHaveBeenCalledWith(
      expect.objectContaining({ expiresInSeconds: 900, sizeBytes: 12n }),
    );
    expect(JSON.stringify(result.file)).not.toMatch(/bucket|objectKey|internalProject|url/u);
  });

  it("includes public identity only for immutable public visibility", async () => {
    const service = createFileService({
      repository: repository(),
      presigner: presigner(),
      generateIds: () => ({ fileId, publicFileId }),
      now: () => new Date(timestamp),
    });
    expect(
      (
        await service.authorizeUpload(project, {
          name: "file.txt",
          mediaType: "text/plain",
          sizeBytes: 12,
          visibility: "public",
        })
      ).file.publicFileId,
    ).toBe(publicFileId);
  });

  it("retries collisions and maps quota safely", async () => {
    const reserve = vi
      .fn()
      .mockRejectedValueOnce(new FileCollisionError())
      .mockResolvedValueOnce(undefined);
    const service = createFileService({
      repository: repository({ reservePending: reserve }),
      presigner: presigner(),
      generateIds: () => ({ fileId, publicFileId }),
      now: () => new Date(timestamp),
    });
    await service.authorizeUpload(project, {
      name: "file.txt",
      mediaType: "text/plain",
      sizeBytes: 12,
      visibility: "private",
    });
    expect(reserve).toHaveBeenCalledTimes(2);

    const quota = createFileService({
      repository: repository({
        reservePending: vi.fn().mockRejectedValue(new StorageQuotaExceededError()),
      }),
      presigner: presigner(),
      generateIds: () => ({ fileId, publicFileId }),
      now: () => new Date(timestamp),
    });
    await expect(
      quota.authorizeUpload(project, {
        name: "file.txt",
        mediaType: "text/plain",
        sizeBytes: 12,
        visibility: "private",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "STORAGE_QUOTA_EXCEEDED" });
  });

  it("maps an otherwise valid over-limit size to FILE_TOO_LARGE before reserving", async () => {
    const repo = repository();
    const service = createFileService({ repository: repo, presigner: presigner() });
    await expect(
      service.authorizeUpload(project, {
        name: "file.txt",
        mediaType: "text/plain",
        sizeBytes: MAX_FILE_SIZE_BYTES + 1,
        visibility: "private",
      }),
    ).rejects.toMatchObject({ statusCode: 413, code: "FILE_TOO_LARGE" });
    expect(repo.reservePending).not.toHaveBeenCalled();
  });

  it("releases reservation after presigning fails before exposing a URL", async () => {
    const failure = new Error("signer failed");
    const repo = repository();
    const service = createFileService({
      repository: repo,
      presigner: presigner({ authorizePut: vi.fn().mockRejectedValue(failure) }),
      generateIds: () => ({ fileId, publicFileId }),
      now: () => new Date(timestamp),
    });
    await expect(
      service.authorizeUpload(project, {
        name: "file.txt",
        mediaType: "text/plain",
        sizeBytes: 12,
        visibility: "private",
      }),
    ).rejects.toBe(failure);
    expect(repo.claimFailure).toHaveBeenCalledWith(
      expect.anything(),
      "presign-failed",
      false,
      timestamp,
    );
    expect(repo.finalizeFailed).toHaveBeenCalledOnce();
  });

  it("scopes list cursors and inspect lookups to trusted project context", async () => {
    const repo = repository({
      list: vi.fn().mockResolvedValue({ items: [file()], nextFileId: fileId }),
      get: vi.fn().mockResolvedValue(undefined),
    });
    const service = createFileService({ repository: repo, presigner: presigner() });
    const listed = await service.list(project, { limit: 20 });
    expect(listed.nextCursor).toBeDefined();
    expect(repo.list).toHaveBeenCalledWith({
      internalProjectId: project.internalProjectId,
      limit: 20,
    });
    await expect(service.inspect(project, fileId)).rejects.toMatchObject({
      statusCode: 404,
      code: "FILE_NOT_FOUND",
    });
    await expect(
      service.list(project, {
        limit: 20,
        cursor: encodeFileCursor("22222222-2222-4222-8222-222222222222", { fileId }),
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
  });
});
