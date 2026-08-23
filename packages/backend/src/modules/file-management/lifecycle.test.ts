/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies method mocks */
import type { TrustedProjectContext } from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../core/http/handler.js";
import { createFileLifecycleService } from "./lifecycle.js";
import {
  createPendingFile,
  parseFileItem,
  trashPurgeSortKey,
  TRASH_PURGE_INDEX_PARTITION,
  TRASH_RETENTION_MILLISECONDS,
  type FileItem,
} from "./model.js";
import type { ObjectStore } from "./object-store.js";
import { FileStateConflictError, type FileRepository } from "./repository.js";

const internalProjectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
const fileId = "fil_0123456789abcdefghijkl";
const timestamp = "2026-08-24T08:00:00.000Z";
const purgeAt = new Date(
  new Date(timestamp).getTime() + TRASH_RETENTION_MILLISECONDS,
).toISOString();

const context: TrustedProjectContext = {
  internalProjectId,
  publicProjectId: "prj_0123456789abcdefghijkl",
  keyId: "key_0123456789abcdefghijkl",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
};

function ready(projectId = internalProjectId): FileItem {
  const pending = createPendingFile({
    internalProjectId: projectId,
    publicProjectId: context.publicProjectId,
    fileId,
    name: "file.txt",
    mediaType: "text/plain",
    sizeBytes: 12n,
    visibility: "private",
    uploadExpiresAt: "2026-08-24T07:15:00.000Z",
    failureEligibleAt: "2026-08-24T08:15:00.000Z",
    createdAt: "2026-08-24T07:00:00.000Z",
  });
  const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...base } = pending;
  void _pendingPk;
  void _pendingSk;
  return parseFileItem({
    ...base,
    status: "ready",
    completionEvidence: {
      completedAt: "2026-08-24T07:05:00.000Z",
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    },
    readyAt: "2026-08-24T07:05:00.000Z",
  });
}

function trashed(input?: { claimed?: boolean; removed?: boolean }): FileItem {
  const source = ready();
  const purgeStartedAt = "2026-09-07T08:00:00.000Z";
  const objectRemovedAt = "2026-09-07T08:00:01.000Z";
  return parseFileItem({
    ...source,
    status: "trashed",
    trashedAt: timestamp,
    purgeAt,
    gsi2pk: TRASH_PURGE_INDEX_PARTITION,
    gsi2sk: trashPurgeSortKey(purgeAt, internalProjectId, fileId),
    ...(input?.claimed ? { purgeStartedAt } : {}),
    ...(input?.removed ? { objectRemovedAt } : {}),
  });
}

function repository(overrides: Partial<FileRepository> = {}) {
  return {
    get: vi.fn(),
    getPublic: vi.fn(),
    list: vi.fn(),
    reservePending: vi.fn(),
    claimCompletion: vi.fn(),
    finalizeReady: vi.fn(),
    claimFailure: vi.fn(),
    completeFailureCleanup: vi.fn(),
    finalizeFailed: vi.fn(),
    listDuePending: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    claimPermanentRemoval: vi.fn(),
    recordObjectRemoved: vi.fn(),
    finalizePermanentRemoval: vi.fn(),
    listDuePurge: vi.fn(),
    ...overrides,
  } satisfies FileRepository;
}

function objectStore(): ObjectStore {
  return { head: vi.fn(), delete: vi.fn() };
}

function usage() {
  return { closeStorage: vi.fn() };
}

describe("file lifecycle service", () => {
  it("trashes for exactly 14 days without touching object storage or usage", async () => {
    const source = ready();
    const trashedFile = trashed();
    const files = repository({
      get: vi.fn().mockResolvedValue(source),
      trash: vi.fn().mockResolvedValue(trashedFile),
    });
    const objects = objectStore();
    const storage = usage();
    const service = createFileLifecycleService({
      repository: files,
      objectStore: objects,
      usage: storage,
      now: () => timestamp,
    });

    await expect(service.delete(context, fileId, { force: false })).resolves.toEqual({
      fileId,
      disposition: "trashed",
      purgeAt,
    });
    expect(files.trash).toHaveBeenCalledWith(source, timestamp, purgeAt);
    expect(objects.delete).not.toHaveBeenCalled();
    expect(storage.closeStorage).not.toHaveBeenCalled();
    expect(files.finalizePermanentRemoval).not.toHaveBeenCalled();
  });

  it("keeps repeated trash and restore effect-idempotent", async () => {
    const trashedFile = trashed();
    const restored = ready();
    const files = repository({
      get: vi.fn().mockResolvedValueOnce(trashedFile).mockResolvedValueOnce(restored),
      restore: vi.fn().mockResolvedValue(restored),
    });
    const service = createFileLifecycleService({
      repository: files,
      objectStore: objectStore(),
      usage: usage(),
      now: () => timestamp,
    });

    await expect(service.delete(context, fileId, { force: false })).resolves.toMatchObject({
      disposition: "trashed",
      purgeAt,
    });
    expect(files.trash).not.toHaveBeenCalled();
    await expect(service.restore(context, fileId)).resolves.toMatchObject({
      fileId,
      status: "ready",
    });
    expect(files.restore).toHaveBeenCalledWith(restored, timestamp);
  });

  it("maps missing, cross-project, and illegal states safely", async () => {
    const missing = createFileLifecycleService({
      repository: repository({ get: vi.fn().mockResolvedValue(undefined) }),
      objectStore: objectStore(),
      usage: usage(),
    });
    await expect(missing.restore(context, fileId)).rejects.toMatchObject({
      statusCode: 404,
      code: "FILE_NOT_FOUND",
    });

    const crossProject = createFileLifecycleService({
      repository: repository({ get: vi.fn().mockResolvedValue(ready(otherProjectId)) }),
      objectStore: objectStore(),
      usage: usage(),
    });
    await expect(crossProject.delete(context, fileId, { force: false })).rejects.toBeInstanceOf(
      HttpError,
    );

    const conflict = createFileLifecycleService({
      repository: repository({
        get: vi.fn().mockResolvedValue(trashed()),
        restore: vi.fn().mockRejectedValue(new FileStateConflictError()),
      }),
      objectStore: objectStore(),
      usage: usage(),
    });
    await expect(conflict.restore(context, fileId)).rejects.toMatchObject({
      statusCode: 409,
      code: "FILE_STATE_CONFLICT",
    });
  });

  it("forces deletion through object removal, stable storage closure, then finalization", async () => {
    const source = ready();
    const claimed = trashed({ claimed: true });
    const removed = trashed({ claimed: true, removed: true });
    const files = repository({
      get: vi.fn().mockResolvedValue(source),
      claimPermanentRemoval: vi.fn().mockResolvedValue(claimed),
      recordObjectRemoved: vi.fn().mockResolvedValue(removed),
      finalizePermanentRemoval: vi.fn().mockResolvedValue(undefined),
    });
    const objects = objectStore();
    const storage = usage();
    const clock = vi
      .fn()
      .mockReturnValueOnce(timestamp)
      .mockReturnValueOnce(removed.objectRemovedAt)
      .mockReturnValueOnce("2026-09-07T08:00:02.000Z");
    const service = createFileLifecycleService({
      repository: files,
      objectStore: objects,
      usage: storage,
      now: clock,
    });

    await expect(service.delete(context, fileId, { force: true })).resolves.toEqual({
      fileId,
      disposition: "purged",
    });
    expect(objects.delete).toHaveBeenCalledWith(source.objectKey);
    expect(files.recordObjectRemoved).toHaveBeenCalledWith(claimed, removed.objectRemovedAt);
    expect(storage.closeStorage).toHaveBeenCalledWith({
      internalProjectId,
      storageSubjectId: fileId,
      byteSize: 12n,
      through: removed.objectRemovedAt,
    });
    expect(files.finalizePermanentRemoval).toHaveBeenCalledWith(
      removed,
      "2026-09-07T08:00:02.000Z",
    );
  });

  it("does not close storage or release metadata when object deletion fails", async () => {
    const claimed = trashed({ claimed: true });
    const files = repository({
      get: vi.fn().mockResolvedValue(ready()),
      claimPermanentRemoval: vi.fn().mockResolvedValue(claimed),
    });
    const objects = objectStore();
    vi.mocked(objects.delete).mockRejectedValue(new Error("s3 unavailable"));
    const storage = usage();
    const service = createFileLifecycleService({
      repository: files,
      objectStore: objects,
      usage: storage,
      now: () => timestamp,
    });

    await expect(service.delete(context, fileId, { force: true })).rejects.toThrow(
      "s3 unavailable",
    );
    expect(files.recordObjectRemoved).not.toHaveBeenCalled();
    expect(storage.closeStorage).not.toHaveBeenCalled();
    expect(files.finalizePermanentRemoval).not.toHaveBeenCalled();
  });

  it("retries idempotent object deletion when removal evidence persistence fails", async () => {
    const claimed = trashed({ claimed: true });
    const removed = trashed({ claimed: true, removed: true });
    const files = repository({
      get: vi.fn().mockResolvedValueOnce(ready()).mockResolvedValueOnce(claimed),
      claimPermanentRemoval: vi.fn().mockResolvedValue(claimed),
      recordObjectRemoved: vi
        .fn()
        .mockRejectedValueOnce(new Error("file table unavailable"))
        .mockResolvedValueOnce(removed),
      finalizePermanentRemoval: vi.fn().mockResolvedValue(undefined),
    });
    const objects = objectStore();
    const storage = usage();
    const service = createFileLifecycleService({
      repository: files,
      objectStore: objects,
      usage: storage,
      now: () => removed.objectRemovedAt!,
    });

    await expect(service.delete(context, fileId, { force: true })).rejects.toThrow(
      "file table unavailable",
    );
    await expect(service.delete(context, fileId, { force: true })).resolves.toMatchObject({
      disposition: "purged",
    });
    expect(objects.delete).toHaveBeenCalledTimes(2);
    expect(storage.closeStorage).toHaveBeenCalledOnce();
    expect(storage.closeStorage).toHaveBeenCalledWith(
      expect.objectContaining({ through: removed.objectRemovedAt }),
    );
    expect(files.finalizePermanentRemoval).toHaveBeenCalledOnce();
  });

  it("resumes after storage failure without deleting the object twice or changing close time", async () => {
    const claimed = trashed({ claimed: true });
    const removed = trashed({ claimed: true, removed: true });
    const files = repository({
      get: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(removed),
      claimPermanentRemoval: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(removed),
      recordObjectRemoved: vi.fn().mockResolvedValue(removed),
      finalizePermanentRemoval: vi.fn().mockResolvedValue(undefined),
    });
    const objects = objectStore();
    const storage = usage();
    storage.closeStorage
      .mockRejectedValueOnce(new Error("usage unavailable"))
      .mockResolvedValueOnce({ status: "closed" });
    const service = createFileLifecycleService({
      repository: files,
      objectStore: objects,
      usage: storage,
      now: () => removed.objectRemovedAt!,
    });

    await expect(service.delete(context, fileId, { force: true })).rejects.toThrow(
      "usage unavailable",
    );
    await expect(service.delete(context, fileId, { force: true })).resolves.toMatchObject({
      disposition: "purged",
    });
    expect(objects.delete).toHaveBeenCalledOnce();
    expect(storage.closeStorage).toHaveBeenCalledTimes(2);
    expect(storage.closeStorage.mock.calls[0]?.[0]).toEqual(
      storage.closeStorage.mock.calls[1]?.[0],
    );
    expect(files.finalizePermanentRemoval).toHaveBeenCalledOnce();
  });

  it("replays the identical storage close when final metadata and quota removal fails", async () => {
    const claimed = trashed({ claimed: true });
    const removed = trashed({ claimed: true, removed: true });
    const files = repository({
      get: vi.fn().mockResolvedValueOnce(ready()).mockResolvedValueOnce(removed),
      claimPermanentRemoval: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(removed),
      recordObjectRemoved: vi.fn().mockResolvedValue(removed),
      finalizePermanentRemoval: vi
        .fn()
        .mockRejectedValueOnce(new Error("transaction unavailable"))
        .mockResolvedValueOnce(undefined),
    });
    const objects = objectStore();
    const storage = usage();
    const service = createFileLifecycleService({
      repository: files,
      objectStore: objects,
      usage: storage,
      now: () => removed.objectRemovedAt!,
    });

    await expect(service.delete(context, fileId, { force: true })).rejects.toThrow(
      "transaction unavailable",
    );
    await expect(service.delete(context, fileId, { force: true })).resolves.toMatchObject({
      disposition: "purged",
    });
    expect(objects.delete).toHaveBeenCalledOnce();
    expect(storage.closeStorage).toHaveBeenCalledTimes(2);
    expect(storage.closeStorage.mock.calls[0]?.[0]).toEqual(
      storage.closeStorage.mock.calls[1]?.[0],
    );
    expect(files.finalizePermanentRemoval).toHaveBeenCalledTimes(2);
  });

  it("processes due trash in bounded pages through the same permanent-removal path", async () => {
    const due = trashed();
    const claimed = trashed({ claimed: true });
    const removed = trashed({ claimed: true, removed: true });
    const files = repository({
      listDuePurge: vi
        .fn()
        .mockResolvedValueOnce({ items: [due], nextStartKey: { pk: due.pk, sk: due.sk } })
        .mockResolvedValueOnce({ items: [] }),
      claimPermanentRemoval: vi.fn().mockResolvedValue(claimed),
      recordObjectRemoved: vi.fn().mockResolvedValue(removed),
      finalizePermanentRemoval: vi.fn().mockResolvedValue(undefined),
    });
    const service = createFileLifecycleService({
      repository: files,
      objectStore: objectStore(),
      usage: usage(),
      now: () => removed.objectRemovedAt!,
      pageSize: 1,
      maxPages: 2,
    });

    await expect(service.purgeDue(purgeAt)).resolves.toEqual({ processed: 1, pages: 2 });
    expect(files.listDuePurge).toHaveBeenNthCalledWith(1, purgeAt, 1, undefined);
    expect(files.listDuePurge).toHaveBeenNthCalledWith(2, purgeAt, 1, {
      pk: due.pk,
      sk: due.sk,
    });
    expect(files.claimPermanentRemoval).toHaveBeenCalledWith(due, removed.objectRemovedAt, false);
  });
});
