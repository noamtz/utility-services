/* eslint-disable @typescript-eslint/require-await -- deterministic in-memory integration boundaries */
import type { TrustedProjectContext } from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { createDownloadService } from "../../packages/backend/src/modules/file-management/downloads.js";
import { createFileLifecycleService } from "../../packages/backend/src/modules/file-management/lifecycle.js";
import {
  createPendingFile,
  parseFileItem,
  trashPurgeSortKey,
  TRASH_PURGE_INDEX_PARTITION,
  UPLOAD_CAPABILITY_EXPIRY_SKEW_MILLISECONDS,
  type FileItem,
} from "../../packages/backend/src/modules/file-management/model.js";
import type { ObjectStore } from "../../packages/backend/src/modules/file-management/object-store.js";
import type { DownloadPresigner } from "../../packages/backend/src/modules/file-management/presigning.js";
import {
  FileStateConflictError,
  type FileRepository,
} from "../../packages/backend/src/modules/file-management/repository.js";
import { createFileService } from "../../packages/backend/src/modules/file-management/service.js";

const internalProjectId = "11111111-1111-4111-8111-111111111111";
const publicProjectId = "prj_0123456789abcdefghijkl";
const fileId = "fil_0123456789abcdefghijkl";
const publicFileId = "pfil_0123456789abcdefghijkl";
const readyAt = "2026-08-01T08:00:00.000Z";

const project: TrustedProjectContext = {
  internalProjectId,
  publicProjectId,
  keyId: "key_0123456789abcdefghijkl",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
};

function readyFile(uploadExpiresAt = "2026-08-01T08:15:00.000Z"): FileItem {
  const pending = createPendingFile({
    internalProjectId,
    publicProjectId,
    fileId,
    publicFileId,
    name: "public.txt",
    mediaType: "text/plain",
    sizeBytes: 12n,
    visibility: "public",
    uploadExpiresAt,
    failureEligibleAt: new Date(
      new Date(uploadExpiresAt).getTime() + 60 * 60 * 1_000,
    ).toISOString(),
    createdAt: readyAt,
  });
  const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...base } = pending;
  void _pendingPk;
  void _pendingSk;
  return parseFileItem({
    ...base,
    status: "ready",
    completionEvidence: {
      completedAt: readyAt,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    },
    readyAt,
  });
}

function memoryRepository(initial: FileItem) {
  const state: { item: FileItem | undefined; retainedBytes: bigint } = {
    item: initial,
    retainedBytes: initial.sizeBytes,
  };
  const repository = {
    async get(requestedProjectId: string, requestedFileId: string) {
      return state.item?.internalProjectId === requestedProjectId &&
        state.item.fileId === requestedFileId
        ? state.item
        : undefined;
    },
    async getPublic(requestedProjectId: string, requestedPublicFileId: string) {
      return state.item?.publicProjectId === requestedProjectId &&
        state.item.publicFileId === requestedPublicFileId
        ? state.item
        : undefined;
    },
    async list(input: { internalProjectId: string; limit: number }) {
      const items = state.item?.internalProjectId === input.internalProjectId ? [state.item] : [];
      return { items: items.slice(0, input.limit) };
    },
    async reservePending() {
      throw new Error("not used by lifecycle integration tests");
    },
    async claimCompletion() {
      throw new Error("not used by lifecycle integration tests");
    },
    async finalizeReady() {
      throw new Error("not used by lifecycle integration tests");
    },
    async claimFailure() {
      throw new Error("not used by lifecycle integration tests");
    },
    async completeFailureCleanup() {
      throw new Error("not used by lifecycle integration tests");
    },
    async finalizeFailed() {
      throw new Error("not used by lifecycle integration tests");
    },
    async listDuePending() {
      return { items: [] };
    },
    async trash(file: FileItem, trashedAt: string, purgeAt: string) {
      if (state.item?.status !== "ready" || state.item.revision !== file.revision) {
        throw new FileStateConflictError();
      }
      state.item = parseFileItem({
        ...file,
        status: "trashed",
        trashedAt,
        purgeAt,
        gsi2pk: TRASH_PURGE_INDEX_PARTITION,
        gsi2sk: trashPurgeSortKey(purgeAt, file.internalProjectId, file.fileId),
        updatedAt: trashedAt,
        revision: file.revision + 1n,
      });
      return state.item;
    },
    async restore(file: FileItem, now: string) {
      if (
        state.item?.status !== "trashed" ||
        state.item.purgeStartedAt !== undefined ||
        new Date(now).getTime() >= new Date(state.item.purgeAt!).getTime()
      ) {
        throw new FileStateConflictError();
      }
      const {
        gsi2pk: _lifecyclePk,
        gsi2sk: _lifecycleSk,
        trashedAt: _trashedAt,
        purgeAt: _purgeAt,
        ...restored
      } = state.item;
      void _lifecyclePk;
      void _lifecycleSk;
      void _trashedAt;
      void _purgeAt;
      state.item = parseFileItem({
        ...restored,
        status: "ready",
        updatedAt: now,
        revision: file.revision + 1n,
      });
      return state.item;
    },
    async claimPermanentRemoval(file: FileItem, now: string, force: boolean) {
      if (
        state.item?.revision !== file.revision ||
        (state.item.status !== "ready" && state.item.status !== "trashed") ||
        (!force &&
          (state.item.status !== "trashed" ||
            new Date(state.item.purgeAt!).getTime() > new Date(now).getTime()))
      ) {
        throw new FileStateConflictError();
      }
      const trashedAt = state.item.status === "trashed" ? state.item.trashedAt : now;
      const purgeAt = force
        ? new Date(
            Math.max(
              new Date(now).getTime(),
              new Date(state.item.uploadExpiresAt).getTime() +
                UPLOAD_CAPABILITY_EXPIRY_SKEW_MILLISECONDS,
            ),
          ).toISOString()
        : state.item.purgeAt!;
      state.item = parseFileItem({
        ...state.item,
        status: "trashed",
        trashedAt,
        purgeAt,
        purgeStartedAt: now,
        gsi2pk: TRASH_PURGE_INDEX_PARTITION,
        gsi2sk: trashPurgeSortKey(purgeAt, file.internalProjectId, file.fileId),
        updatedAt: now,
        revision: file.revision + 1n,
      });
      return state.item;
    },
    async recordObjectRemoved(file: FileItem, removedAt: string) {
      if (state.item?.revision !== file.revision || file.purgeStartedAt === undefined) {
        throw new FileStateConflictError();
      }
      state.item = parseFileItem({
        ...file,
        objectRemovedAt: removedAt,
        updatedAt: removedAt,
        revision: file.revision + 1n,
      });
      return state.item;
    },
    async finalizePermanentRemoval(file: FileItem) {
      if (state.item?.revision !== file.revision || file.objectRemovedAt === undefined) {
        throw new FileStateConflictError();
      }
      state.retainedBytes -= file.sizeBytes;
      state.item = undefined;
    },
    async listDuePurge(dueThrough: string) {
      const due =
        state.item?.status === "trashed" &&
        new Date(state.item.purgeAt!).getTime() <= new Date(dueThrough).getTime();
      return { items: due && state.item ? [state.item] : [] };
    },
  } satisfies FileRepository;
  return { repository, state };
}

function fixture(initial = readyFile()) {
  let clock = "2026-08-24T08:00:00.000Z";
  const { repository, state } = memoryRepository(initial);
  const objects = new Set([initial.objectKey]);
  const deleteObject = vi.fn().mockImplementation(async (key: string) => {
    objects.delete(key);
  });
  const objectStore: ObjectStore = {
    head: vi.fn(),
    delete: deleteObject,
  };
  const closeStorage = vi.fn().mockResolvedValue({ status: "closed" });
  const lifecycle = createFileLifecycleService({
    repository,
    objectStore,
    usage: { closeStorage },
    now: () => clock,
  });
  const authorizeGet = vi.fn().mockResolvedValue({ url: "https://download.example.com/signed" });
  const downloadPresigner: DownloadPresigner = { authorizeGet };
  const downloads = createDownloadService({
    repository,
    projects: {
      inspect: async () => ({
        internalProjectId,
        publicProjectId,
        status: "active",
        fileManagement: { downloadUrlLifetimeMinutes: 5 },
      }),
    },
    presigner: downloadPresigner,
    now: () => new Date(clock),
  });
  const files = createFileService({
    repository,
    presigner: {
      authorizePut: async () => {
        throw new Error("not used by lifecycle integration tests");
      },
    },
  });
  return {
    repository,
    state,
    objects,
    deleteObject,
    closeStorage,
    authorizeGet,
    lifecycle,
    downloads,
    files,
    setClock(value: string) {
      clock = value;
    },
  };
}

describe("file trash lifecycle integration", () => {
  it("keeps trashed bytes and identity, denies downloads, and restores the same file", async () => {
    const harness = fixture();

    const deleted = await harness.lifecycle.delete(project, fileId, { force: false });
    expect(deleted).toEqual({
      fileId,
      disposition: "trashed",
      purgeAt: "2026-09-07T08:00:00.000Z",
    });
    expect(harness.state.retainedBytes).toBe(12n);
    expect(harness.objects.has(readyFile().objectKey)).toBe(true);
    await expect(harness.files.inspect(project, fileId)).resolves.toMatchObject({
      fileId,
      publicFileId,
      status: "trashed",
      trashedAt: "2026-08-24T08:00:00.000Z",
      purgeAt: "2026-09-07T08:00:00.000Z",
    });
    await expect(harness.files.list(project, { limit: 20 })).resolves.toMatchObject({
      items: [{ fileId, status: "trashed" }],
    });
    await expect(harness.downloads.authorizePrivate(project, fileId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      harness.downloads.authorizePublic(publicProjectId, publicFileId),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(harness.authorizeGet).not.toHaveBeenCalled();

    harness.setClock("2026-08-25T08:00:00.000Z");
    await expect(harness.lifecycle.restore(project, fileId)).resolves.toMatchObject({
      fileId,
      publicFileId,
      status: "ready",
    });
    await expect(harness.downloads.authorizePrivate(project, fileId)).resolves.toMatchObject({
      file: { fileId, status: "ready" },
    });
    await expect(harness.downloads.authorizePublic(publicProjectId, publicFileId)).resolves.toBe(
      "https://download.example.com/signed",
    );
    expect(harness.state.retainedBytes).toBe(12n);
  });

  it("force-deletes in object, usage, metadata order and releases retained quota", async () => {
    const harness = fixture();

    await expect(harness.lifecycle.delete(project, fileId, { force: true })).resolves.toEqual({
      fileId,
      disposition: "purged",
    });

    expect(harness.deleteObject).toHaveBeenCalledWith(readyFile().objectKey);
    expect(harness.closeStorage).toHaveBeenCalledWith({
      internalProjectId,
      storageSubjectId: fileId,
      byteSize: 12n,
      through: "2026-08-24T08:00:00.000Z",
    });
    expect(harness.objects.size).toBe(0);
    expect(harness.state.item).toBeUndefined();
    expect(harness.state.retainedBytes).toBe(0n);
  });

  it("keeps the original object until upload-capability replay is no longer possible", async () => {
    const source = readyFile("2026-08-24T08:30:00.000Z");
    const harness = fixture(source);

    await expect(harness.lifecycle.delete(project, fileId, { force: true })).resolves.toEqual({
      fileId,
      disposition: "purge-pending",
      purgeAt: "2026-08-24T08:35:00.000Z",
    });
    expect(harness.state.item).toMatchObject({
      status: "trashed",
      purgeStartedAt: "2026-08-24T08:00:00.000Z",
      purgeAt: "2026-08-24T08:35:00.000Z",
    });
    expect(harness.objects.has(source.objectKey)).toBe(true);
    expect(harness.state.retainedBytes).toBe(12n);
    expect(harness.deleteObject).not.toHaveBeenCalled();
    expect(harness.closeStorage).not.toHaveBeenCalled();
    await expect(harness.downloads.authorizePrivate(project, fileId)).rejects.toMatchObject({
      statusCode: 404,
    });

    const replayResult = harness.objects.has(source.objectKey)
      ? "precondition-failed"
      : "recreated";
    expect(replayResult).toBe("precondition-failed");

    harness.setClock("2026-08-24T08:34:59.999Z");
    await expect(harness.lifecycle.purgeDue()).resolves.toEqual({ processed: 0, pages: 1 });
    harness.setClock("2026-08-24T08:35:00.000Z");
    await expect(harness.lifecycle.purgeDue()).resolves.toEqual({ processed: 1, pages: 1 });
    expect(harness.objects.has(source.objectKey)).toBe(false);
    expect(harness.state.retainedBytes).toBe(0n);
  });

  it("purges only after the 14-day deadline and closes storage through physical removal", async () => {
    const harness = fixture();
    await harness.lifecycle.delete(project, fileId, { force: false });

    harness.setClock("2026-09-07T07:59:59.999Z");
    await expect(harness.lifecycle.purgeDue()).resolves.toEqual({ processed: 0, pages: 1 });
    expect(harness.objects.size).toBe(1);

    harness.setClock("2026-09-07T08:00:00.000Z");
    await expect(harness.lifecycle.purgeDue()).resolves.toEqual({ processed: 1, pages: 1 });
    expect(harness.closeStorage).toHaveBeenCalledWith({
      internalProjectId,
      storageSubjectId: fileId,
      byteSize: 12n,
      through: "2026-09-07T08:00:00.000Z",
    });
    const billedByteMilliseconds =
      12n * BigInt(new Date("2026-09-07T08:00:00.000Z").getTime() - new Date(readyAt).getTime());
    expect(billedByteMilliseconds).toBe(12n * 37n * 24n * 60n * 60n * 1_000n);
    expect(harness.objects.size).toBe(0);
    expect(harness.state.item).toBeUndefined();
    expect(harness.state.retainedBytes).toBe(0n);
  });

  it("does not reveal a file through another project context", async () => {
    const harness = fixture();
    await expect(
      harness.lifecycle.delete(
        { ...project, internalProjectId: "22222222-2222-4222-8222-222222222222" },
        fileId,
        { force: false },
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: "FILE_NOT_FOUND" });
    expect(harness.state.item?.status).toBe("ready");
  });
});
