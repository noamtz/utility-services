import {
  DeleteFileResultSchema,
  type DeleteFileQuery,
  type DeleteFileResult,
  type File,
  type TrustedProjectContext,
} from "@utility-services/contracts";
import { z } from "zod";

import { HttpError } from "../../core/http/handler.js";
import { TRASH_RETENTION_MILLISECONDS, type FileItem } from "./model.js";
import type { ObjectStore } from "./object-store.js";
import { FileStateConflictError, type FileRepository } from "./repository.js";
import { toPublicFile } from "./service.js";

export interface LifecycleUsageService {
  closeStorage(input: {
    internalProjectId: string;
    storageSubjectId: string;
    byteSize: bigint;
    through: string;
  }): Promise<unknown>;
}

export interface FileLifecycleService {
  delete(
    project: TrustedProjectContext,
    fileId: string,
    query: DeleteFileQuery,
  ): Promise<DeleteFileResult>;
  restore(project: TrustedProjectContext, fileId: string): Promise<File>;
  purgeDue(dueThrough?: string): Promise<{ processed: number; pages: number }>;
}

export interface FileLifecycleDependencies {
  readonly repository: FileRepository;
  readonly objectStore: ObjectStore;
  readonly usage: LifecycleUsageService;
  readonly now?: () => string;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

function fileNotFound(): HttpError {
  return new HttpError(404, "FILE_NOT_FOUND", "File not found");
}

function stateConflict(): HttpError {
  return new HttpError(409, "FILE_STATE_CONFLICT", "File state does not allow this operation");
}

export function createFileLifecycleService(
  dependencies: FileLifecycleDependencies,
): FileLifecycleService {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const pageSize = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(dependencies.pageSize ?? 20);
  const maxPages = z
    .number()
    .int()
    .min(1)
    .max(20)
    .parse(dependencies.maxPages ?? 5);

  async function ownedFile(project: TrustedProjectContext, fileId: string): Promise<FileItem> {
    const file = await dependencies.repository.get(project.internalProjectId, fileId);
    if (!file || file.internalProjectId !== project.internalProjectId) throw fileNotFound();
    return file;
  }

  async function permanentlyRemove(fileInput: FileItem): Promise<void> {
    let file = fileInput;
    if (file.objectRemovedAt === undefined) {
      await dependencies.objectStore.delete(file.objectKey);
      file = await dependencies.repository.recordObjectRemoved(file, now());
    }
    await dependencies.usage.closeStorage({
      internalProjectId: file.internalProjectId,
      storageSubjectId: file.fileId,
      byteSize: file.completionEvidence!.sizeBytes,
      through: file.objectRemovedAt!,
    });
    await dependencies.repository.finalizePermanentRemoval(file, now());
  }

  return Object.freeze({
    async delete(project: TrustedProjectContext, fileId: string, query: DeleteFileQuery) {
      const file = await ownedFile(project, fileId);
      const timestamp = now();
      try {
        if (query.force) {
          const claimed = await dependencies.repository.claimPermanentRemoval(
            file,
            timestamp,
            true,
          );
          if (new Date(claimed.purgeAt!).getTime() > new Date(timestamp).getTime()) {
            return DeleteFileResultSchema.parse({
              fileId: file.fileId,
              disposition: "purge-pending",
              purgeAt: claimed.purgeAt,
            });
          }
          await permanentlyRemove(claimed);
          return DeleteFileResultSchema.parse({ fileId: file.fileId, disposition: "purged" });
        }
        if (file.status === "trashed") {
          if (file.purgeStartedAt !== undefined) throw new FileStateConflictError();
          return DeleteFileResultSchema.parse({
            fileId: file.fileId,
            disposition: "trashed",
            purgeAt: file.purgeAt,
          });
        }
        const purgeAt = new Date(
          new Date(timestamp).getTime() + TRASH_RETENTION_MILLISECONDS,
        ).toISOString();
        const trashed = await dependencies.repository.trash(file, timestamp, purgeAt);
        return DeleteFileResultSchema.parse({
          fileId: trashed.fileId,
          disposition: "trashed",
          purgeAt: trashed.purgeAt,
        });
      } catch (error) {
        if (error instanceof FileStateConflictError) throw stateConflict();
        throw error;
      }
    },

    async restore(project: TrustedProjectContext, fileId: string) {
      const file = await ownedFile(project, fileId);
      try {
        return toPublicFile(await dependencies.repository.restore(file, now()));
      } catch (error) {
        if (error instanceof FileStateConflictError) throw stateConflict();
        throw error;
      }
    },

    async purgeDue(dueThroughInput?: string) {
      const dueThrough = z.iso.datetime({ offset: true }).parse(dueThroughInput ?? now());
      let processed = 0;
      let pages = 0;
      let startKey: Record<string, unknown> | undefined;
      do {
        const page = await dependencies.repository.listDuePurge(dueThrough, pageSize, startKey);
        pages += 1;
        for (const due of page.items) {
          const claimed =
            due.purgeStartedAt !== undefined
              ? due
              : await dependencies.repository.claimPermanentRemoval(due, now(), false);
          await permanentlyRemove(claimed);
          processed += 1;
        }
        startKey = page.nextStartKey;
      } while (startKey && pages < maxPages);
      return { processed, pages };
    },
  });
}
