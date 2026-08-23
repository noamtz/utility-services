import { z } from "zod";

import type { ObjectStore, StoredObjectEvidence } from "./object-store.js";
import { parseFileObjectKey, type CompletionEvidence, type FileItem } from "./model.js";
import type { FileRepository } from "./repository.js";

const S3RecordSchema = z
  .object({
    eventName: z.literal("ObjectCreated:Put"),
    eventTime: z.iso.datetime({ offset: true }),
    s3: z
      .object({
        bucket: z.object({ name: z.string().min(1) }).passthrough(),
        object: z
          .object({
            key: z.string().min(1),
            size: z.number().int().safe().positive(),
            eTag: z.string().trim().min(1).max(256),
            sequencer: z
              .string()
              .regex(/^[A-Fa-f0-9]+$/u)
              .max(128),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const S3EventSchema = z.object({ Records: z.array(z.unknown()).min(1).max(100) }).passthrough();

export interface CompletionUsageService {
  recordUsage(input: {
    internalProjectId: string;
    metric: "s3-upload-requests";
    quantityAtoms: bigint;
    sourceKind: string;
    sourceId: string;
    occurredAt: string;
  }): Promise<unknown>;
  openStorage(input: {
    internalProjectId: string;
    storageSubjectId: string;
    byteSize: bigint;
    openedAt: string;
  }): Promise<unknown>;
}

export class InvalidUploadEventError extends Error {
  public constructor() {
    super("Upload event is invalid or outside the configured file boundary");
    this.name = "InvalidUploadEventError";
  }
}

export class UploadObjectNotFoundError extends Error {
  public constructor() {
    super("Uploaded object is not yet observable");
    this.name = "UploadObjectNotFoundError";
  }
}

export class ConflictingUploadEvidenceError extends Error {
  public constructor() {
    super("Upload completion evidence conflicts with stored intent");
    this.name = "ConflictingUploadEvidenceError";
  }
}

interface EventEvidence {
  readonly occurredAt: string;
  readonly sizeBytes: bigint;
  readonly eTag: string;
  readonly sequencer: string;
}

function decodedObjectKey(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    throw new InvalidUploadEventError();
  }
}

function normalizeETag(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function completionMatchesEvent(file: FileItem, event: EventEvidence): boolean {
  const evidence = file.completionEvidence;
  return (
    evidence !== undefined &&
    evidence.sizeBytes === event.sizeBytes &&
    evidence.eTag === event.eTag &&
    (evidence.sequencer === undefined || evidence.sequencer === event.sequencer)
  );
}

function completionMatchesObject(file: FileItem, object: StoredObjectEvidence): boolean {
  const evidence = file.completionEvidence;
  return (
    evidence !== undefined &&
    evidence.sizeBytes === object.sizeBytes &&
    evidence.mediaType === object.mediaType &&
    evidence.eTag === object.eTag
  );
}

export function createUploadCompletionService(options: {
  readonly repository: FileRepository;
  readonly objectStore: ObjectStore;
  readonly usage: CompletionUsageService;
  readonly bucketName: string;
  readonly now?: () => string;
  readonly pageSize?: number;
  readonly maxPages?: number;
}) {
  const bucketName = z.string().trim().min(1).parse(options.bucketName);
  const now = options.now ?? (() => new Date().toISOString());
  const pageSize = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(options.pageSize ?? 20);
  const maxPages = z
    .number()
    .int()
    .min(1)
    .max(20)
    .parse(options.maxPages ?? 5);

  async function finishFailure(
    file: FileItem,
    reasonCode: string,
    cleanup: boolean,
  ): Promise<FileItem> {
    const timestamp = now();
    let failed = await options.repository.claimFailure(file, reasonCode, cleanup, timestamp);
    if (failed.cleanupRequired === true) {
      await options.objectStore.delete(failed.objectKey);
      failed = await options.repository.completeFailureCleanup(failed, timestamp);
    }
    return options.repository.finalizeFailed(failed, timestamp);
  }

  function evidenceFromObject(
    object: StoredObjectEvidence,
    occurredAt: string,
    sequencer?: string,
  ): CompletionEvidence {
    return {
      completedAt: new Date(occurredAt).toISOString(),
      sizeBytes: object.sizeBytes,
      mediaType: object.mediaType,
      eTag: object.eTag,
      ...(sequencer ? { sequencer } : {}),
    };
  }

  async function complete(file: FileItem, event?: EventEvidence): Promise<FileItem> {
    if (file.status === "failed") {
      await options.objectStore.delete(file.objectKey);
      return file;
    }
    if (file.status === "ready" || file.status === "trashed") {
      if (event && !completionMatchesEvent(file, event)) throw new ConflictingUploadEvidenceError();
      return file;
    }
    if (file.failureCode !== undefined) {
      return finishFailure(file, file.failureCode, file.cleanupRequired === true);
    }
    const object = await options.objectStore.head(file.objectKey);
    if (!object) throw new UploadObjectNotFoundError();
    const eventConflict =
      event !== undefined && (event.sizeBytes !== object.sizeBytes || event.eTag !== object.eTag);
    if (
      object.sizeBytes !== file.sizeBytes ||
      object.mediaType !== file.mediaType ||
      eventConflict
    ) {
      return finishFailure(file, "object-mismatch", true);
    }
    if (file.completionEvidence !== undefined) {
      if (
        !completionMatchesObject(file, object) ||
        (event !== undefined && !completionMatchesEvent(file, event))
      ) {
        throw new ConflictingUploadEvidenceError();
      }
    }
    const evidence =
      file.completionEvidence ??
      evidenceFromObject(object, event?.occurredAt ?? object.lastModified, event?.sequencer);
    const claimed = await options.repository.claimCompletion(file, evidence, now());
    await options.usage.recordUsage({
      internalProjectId: claimed.internalProjectId,
      metric: "s3-upload-requests",
      quantityAtoms: 1n,
      sourceKind: "file-upload",
      sourceId: claimed.fileId,
      occurredAt: claimed.completionEvidence!.completedAt,
    });
    await options.usage.openStorage({
      internalProjectId: claimed.internalProjectId,
      storageSubjectId: claimed.fileId,
      byteSize: claimed.completionEvidence!.sizeBytes,
      openedAt: claimed.completionEvidence!.completedAt,
    });
    return options.repository.finalizeReady(claimed, now());
  }

  async function processRecord(rawRecord: unknown): Promise<FileItem> {
    const result = S3RecordSchema.safeParse(rawRecord);
    if (!result.success || result.data.s3.bucket.name !== bucketName) {
      throw new InvalidUploadEventError();
    }
    const key = decodedObjectKey(result.data.s3.object.key);
    let identity;
    try {
      identity = parseFileObjectKey(key);
    } catch {
      throw new InvalidUploadEventError();
    }
    const file = await options.repository.get(identity.internalProjectId, identity.fileId);
    if (!file || file.objectKey !== key || file.internalProjectId !== identity.internalProjectId) {
      throw new InvalidUploadEventError();
    }
    return complete(file, {
      occurredAt: result.data.eventTime,
      sizeBytes: BigInt(result.data.s3.object.size),
      eTag: normalizeETag(result.data.s3.object.eTag),
      sequencer: result.data.s3.object.sequencer,
    });
  }

  async function handleS3Event(rawEvent: unknown): Promise<{ processed: number }> {
    const result = S3EventSchema.safeParse(rawEvent);
    if (!result.success) throw new InvalidUploadEventError();
    for (const record of result.data.Records) await processRecord(record);
    return { processed: result.data.Records.length };
  }

  async function reconcileDue(dueThrough = now()): Promise<{ processed: number; pages: number }> {
    let processed = 0;
    let pages = 0;
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await options.repository.listDuePending(dueThrough, pageSize, startKey);
      pages += 1;
      for (const file of page.items) {
        if (file.status !== "pending") continue;
        if (file.failureCode !== undefined) {
          await finishFailure(file, file.failureCode, file.cleanupRequired === true);
        } else {
          const object = await options.objectStore.head(file.objectKey);
          if (object) await complete(file);
          else await finishFailure(file, "upload-expired", false);
        }
        processed += 1;
      }
      startKey = page.nextStartKey;
    } while (startKey && pages < maxPages);
    return { processed, pages };
  }

  return Object.freeze({ processRecord, handleS3Event, reconcileDue, complete });
}
