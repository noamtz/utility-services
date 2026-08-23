/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- deterministic in-memory boundary */
import { describe, expect, it, vi } from "vitest";

import {
  ConflictingUploadEvidenceError,
  createUploadCompletionService,
  InvalidUploadEventError,
  UploadObjectNotFoundError,
} from "./completion.js";
import {
  createPendingFile,
  parseFileItem,
  type CompletionEvidence,
  type FileItem,
} from "./model.js";
import type { ObjectStore, StoredObjectEvidence } from "./object-store.js";
import type { DuePendingResult, FileRepository, ListFilesInput } from "./repository.js";

const project = "11111111-1111-4111-8111-111111111111";
const publicProject = "prj_0123456789abcdefghijkl";
const fileId = "fil_0123456789abcdefghijkl";
const objectKey = `projects/${project}/files/${fileId}`;
const occurredAt = "2026-08-23T08:10:00.000Z";
const now = "2026-08-23T10:00:00.000Z";

function pending(): FileItem {
  return createPendingFile({
    internalProjectId: project,
    publicProjectId: publicProject,
    fileId,
    name: "file.txt",
    mediaType: "text/plain",
    sizeBytes: 12n,
    visibility: "private",
    uploadExpiresAt: "2026-08-23T08:15:00.000Z",
    failureEligibleAt: "2026-08-23T09:15:00.000Z",
    createdAt: "2026-08-23T08:00:00.000Z",
  });
}

class MemoryRepository implements FileRepository {
  public item: FileItem = pending();
  public async get(internalProjectId: string, requestedFileId: string) {
    return this.item.internalProjectId === internalProjectId && this.item.fileId === requestedFileId
      ? this.item
      : undefined;
  }
  public async getPublic() {
    return undefined;
  }
  public async list(_input: ListFilesInput) {
    void _input;
    return { items: [this.item] };
  }
  public async reservePending(file: FileItem) {
    this.item = file;
  }
  public async claimCompletion(file: FileItem, evidence: CompletionEvidence, timestamp: string) {
    if (this.item.completionEvidence) return this.item;
    this.item = parseFileItem({
      ...file,
      completionEvidence: evidence,
      updatedAt: timestamp,
      revision: file.revision + 1n,
    });
    return this.item;
  }
  public async finalizeReady(file: FileItem, timestamp: string) {
    const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...terminal } = file;
    void _pendingPk;
    void _pendingSk;
    this.item = parseFileItem({
      ...terminal,
      status: "ready",
      readyAt: file.completionEvidence!.completedAt,
      updatedAt: timestamp,
      revision: file.revision + 1n,
    });
    return this.item;
  }
  public async claimFailure(
    file: FileItem,
    reasonCode: string,
    cleanupRequired: boolean,
    timestamp: string,
  ) {
    this.item = parseFileItem({
      ...file,
      failureCode: reasonCode,
      cleanupRequired,
      updatedAt: timestamp,
      revision: file.revision + 1n,
    });
    return this.item;
  }
  public async completeFailureCleanup(file: FileItem, timestamp: string) {
    this.item = parseFileItem({
      ...file,
      cleanupRequired: false,
      updatedAt: timestamp,
      revision: file.revision + 1n,
    });
    return this.item;
  }
  public async finalizeFailed(file: FileItem, timestamp: string) {
    const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...terminal } = file;
    void _pendingPk;
    void _pendingSk;
    this.item = parseFileItem({
      ...terminal,
      status: "failed",
      failedAt: timestamp,
      updatedAt: timestamp,
      revision: file.revision + 1n,
    });
    return this.item;
  }
  public async listDuePending(): Promise<DuePendingResult> {
    return { items: this.item.status === "pending" ? [this.item] : [] };
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    Records: [
      {
        eventName: "ObjectCreated:Put",
        eventTime: occurredAt,
        s3: {
          bucket: { name: "private-bucket" },
          object: { key: objectKey, size: 12, eTag: "etag", sequencer: "000A" },
        },
        ...overrides,
      },
    ],
  };
}

function fixture(
  object: StoredObjectEvidence | undefined = {
    sizeBytes: 12n,
    mediaType: "text/plain",
    eTag: "etag",
    lastModified: occurredAt,
  },
) {
  const repository = new MemoryRepository();
  const deleted: string[] = [];
  const objectStore: ObjectStore = {
    head: vi.fn().mockResolvedValue(object),
    delete: vi.fn().mockImplementation(async (key: string) => {
      deleted.push(key);
    }),
  };
  const usage = {
    recordUsage: vi.fn().mockResolvedValue({ status: "recorded" }),
    openStorage: vi.fn().mockResolvedValue({ status: "active" }),
  };
  const service = createUploadCompletionService({
    repository,
    objectStore,
    usage,
    bucketName: "private-bucket",
    now: () => now,
  });
  return { repository, objectStore, deleted, usage, service };
}

describe("upload completion saga", () => {
  it("HEAD-verifies, records usage, opens storage, and finalizes ready once", async () => {
    const { repository, usage, service } = fixture();
    await expect(service.handleS3Event(event())).resolves.toEqual({ processed: 1 });
    expect(repository.item.status).toBe("ready");
    expect(repository.item.completionEvidence).toMatchObject({
      completedAt: occurredAt,
      sizeBytes: 12n,
      eTag: "etag",
      sequencer: "000A",
    });
    expect(usage.recordUsage).toHaveBeenCalledWith({
      internalProjectId: project,
      metric: "s3-upload-requests",
      quantityAtoms: 1n,
      sourceKind: "file-upload",
      sourceId: fileId,
      occurredAt,
    });
    expect(usage.openStorage).toHaveBeenCalledWith({
      internalProjectId: project,
      storageSubjectId: fileId,
      byteSize: 12n,
      openedAt: occurredAt,
    });
    await service.handleS3Event(event());
    expect(usage.recordUsage).toHaveBeenCalledOnce();
    expect(usage.openStorage).toHaveBeenCalledOnce();
  });

  it("replays stable evidence after a partial usage/storage failure", async () => {
    const { repository, objectStore, usage, service } = fixture();
    usage.openStorage.mockRejectedValueOnce(new Error("transient usage failure"));
    await expect(service.handleS3Event(event())).rejects.toThrow(/transient/u);
    expect(repository.item.status).toBe("pending");
    expect(repository.item.completionEvidence?.completedAt).toBe(occurredAt);
    vi.mocked(objectStore.head).mockResolvedValue({
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
      lastModified: "2026-08-23T08:11:00.000Z",
    });
    await service.reconcileDue(now);
    expect(repository.item.status).toBe("ready");
    expect(repository.item.readyAt).toBe(occurredAt);
    expect(usage.recordUsage).toHaveBeenCalledTimes(2);
    expect(usage.recordUsage.mock.calls[0]?.[0]).toEqual(usage.recordUsage.mock.calls[1]?.[0]);
  });

  it("cleans mismatched objects before failing and never charges them", async () => {
    const { repository, deleted, usage, service } = fixture({
      sizeBytes: 13n,
      mediaType: "text/plain",
      eTag: "different",
      lastModified: occurredAt,
    });
    const mismatch = event();
    const record = mismatch.Records[0]!;
    record.s3.object.size = 13;
    record.s3.object.eTag = "different";
    await service.handleS3Event(mismatch);
    expect(repository.item.status).toBe("failed");
    expect(repository.item.failureCode).toBe("object-mismatch");
    expect(deleted).toEqual([objectKey]);
    expect(usage.recordUsage).not.toHaveBeenCalled();
  });

  it("keeps notification absence retryable but expires unused reservations in reconciliation", async () => {
    const { repository, objectStore, usage, service } = fixture();
    vi.mocked(objectStore.head).mockResolvedValue(undefined);
    await expect(service.handleS3Event(event())).rejects.toBeInstanceOf(UploadObjectNotFoundError);
    expect(repository.item.status).toBe("pending");
    await expect(service.reconcileDue(now)).resolves.toEqual({ processed: 1, pages: 1 });
    expect(repository.item.status).toBe("failed");
    expect(repository.item.failureCode).toBe("upload-expired");
    expect(usage.recordUsage).not.toHaveBeenCalled();
  });

  it("never revives failed late uploads and deletes only their exact key", async () => {
    const { repository, deleted, usage, service } = fixture();
    repository.item = await repository.claimFailure(repository.item, "upload-expired", false, now);
    repository.item = await repository.finalizeFailed(repository.item, now);
    await service.handleS3Event(event());
    expect(repository.item.status).toBe("failed");
    expect(deleted).toEqual([objectKey]);
    expect(usage.recordUsage).not.toHaveBeenCalled();
  });

  it("rejects wrong buckets and conflicting ready duplicates without charging", async () => {
    const first = fixture();
    await first.service.handleS3Event(event());
    const conflicting = event();
    conflicting.Records[0]!.s3.object.eTag = "changed";
    await expect(first.service.handleS3Event(conflicting)).rejects.toBeInstanceOf(
      ConflictingUploadEvidenceError,
    );
    const wrong = fixture();
    await expect(
      wrong.service.handleS3Event(
        event({
          s3: {
            bucket: { name: "other" },
            object: { key: objectKey, size: 12, eTag: "etag", sequencer: "A" },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidUploadEventError);
    expect(wrong.usage.recordUsage).not.toHaveBeenCalled();
  });
});
