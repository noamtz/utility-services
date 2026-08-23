import {
  CreateUploadRequestSchema,
  FileListPayloadSchema,
  FileSchema,
  MAX_FILE_SIZE_BYTES,
  UploadAuthorizationSchema,
  type CreateUploadRequest,
  type File,
  type FileListPayload,
  type FileListQuery,
  type TrustedProjectContext,
  type UploadAuthorization,
} from "@utility-services/contracts";

import { HttpError } from "../../core/http/handler.js";
import { decodeFileCursor, encodeFileCursor, InvalidFileCursorError } from "./cursor.js";
import { generateFileIds, type FileIds } from "./ids.js";
import { createPendingFile, FILE_STORAGE_QUOTA_BYTES, type FileItem } from "./model.js";
import type { UploadPresigner } from "./presigning.js";
import {
  FileCollisionError,
  FileStateConflictError,
  StorageQuotaExceededError,
  type FileRepository,
} from "./repository.js";

const COMPLETION_GRACE_MILLISECONDS = 60 * 60 * 1_000;

export interface FileService {
  authorizeUpload(
    project: TrustedProjectContext,
    request: CreateUploadRequest,
  ): Promise<UploadAuthorization>;
  list(project: TrustedProjectContext, query: FileListQuery): Promise<FileListPayload>;
  inspect(project: TrustedProjectContext, fileId: string): Promise<File>;
}

export interface FileServiceDependencies {
  readonly repository: FileRepository;
  readonly presigner: UploadPresigner;
  readonly generateIds?: () => FileIds;
  readonly now?: () => Date;
  readonly collisionAttempts?: number;
  readonly quotaLimitBytes?: bigint;
}

export function toPublicFile(item: FileItem): File {
  return FileSchema.parse({
    fileId: item.fileId,
    ...(item.publicFileId ? { publicFileId: item.publicFileId } : {}),
    name: item.name,
    mediaType: item.mediaType,
    sizeBytes: Number(item.sizeBytes),
    visibility: item.visibility,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

function fileNotFound(): HttpError {
  return new HttpError(404, "FILE_NOT_FOUND", "File not found");
}

export function createFileService(dependencies: FileServiceDependencies): FileService {
  const generateIds = dependencies.generateIds ?? generateFileIds;
  const now = dependencies.now ?? (() => new Date());
  const collisionAttempts = dependencies.collisionAttempts ?? 3;
  const quotaLimitBytes = dependencies.quotaLimitBytes ?? FILE_STORAGE_QUOTA_BYTES;
  if (!Number.isInteger(collisionAttempts) || collisionAttempts < 1 || collisionAttempts > 10) {
    throw new RangeError("collisionAttempts must be an integer between 1 and 10");
  }

  return {
    async authorizeUpload(project, requestInput) {
      if (requestInput.sizeBytes > MAX_FILE_SIZE_BYTES) {
        throw new HttpError(413, "FILE_TOO_LARGE", "File exceeds the maximum size");
      }
      const request = CreateUploadRequestSchema.parse(requestInput);
      const issuedAt = now();
      const timestamp = issuedAt.toISOString();
      const expiresAt = new Date(
        issuedAt.getTime() + project.fileManagement.uploadUrlLifetimeMinutes * 60_000,
      ).toISOString();
      const failureEligibleAt = new Date(
        new Date(expiresAt).getTime() + COMPLETION_GRACE_MILLISECONDS,
      ).toISOString();

      for (let attempt = 1; attempt <= collisionAttempts; attempt += 1) {
        const ids = generateIds();
        const file = createPendingFile({
          internalProjectId: project.internalProjectId,
          publicProjectId: project.publicProjectId,
          fileId: ids.fileId,
          ...(request.visibility === "public" ? { publicFileId: ids.publicFileId } : {}),
          name: request.name,
          mediaType: request.mediaType,
          sizeBytes: BigInt(request.sizeBytes),
          visibility: request.visibility,
          uploadExpiresAt: expiresAt,
          failureEligibleAt,
          createdAt: timestamp,
        });
        try {
          await dependencies.repository.reservePending(file, quotaLimitBytes);
        } catch (error) {
          if (error instanceof StorageQuotaExceededError) {
            throw new HttpError(409, "STORAGE_QUOTA_EXCEEDED", "Storage quota exceeded");
          }
          if (error instanceof FileCollisionError || error instanceof FileStateConflictError) {
            if (attempt < collisionAttempts) continue;
            throw new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred");
          }
          throw error;
        }

        try {
          const upload = await dependencies.presigner.authorizePut({
            objectKey: file.objectKey,
            mediaType: file.mediaType,
            sizeBytes: file.sizeBytes,
            expiresInSeconds: project.fileManagement.uploadUrlLifetimeMinutes * 60,
          });
          return UploadAuthorizationSchema.parse({
            file: toPublicFile(file),
            upload: {
              method: "PUT",
              url: upload.url,
              expiresAt,
              requiredHeaders: upload.requiredHeaders,
            },
          });
        } catch (error) {
          const failed = await dependencies.repository.claimFailure(
            file,
            "presign-failed",
            false,
            timestamp,
          );
          await dependencies.repository.finalizeFailed(failed, timestamp);
          throw error;
        }
      }
      throw new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred");
    },

    async list(project, query) {
      let startAfterFileId: string | undefined;
      if (query.cursor) {
        try {
          startAfterFileId = decodeFileCursor(query.cursor, project.internalProjectId).fileId;
        } catch (error) {
          if (error instanceof InvalidFileCursorError) {
            throw new HttpError(400, "VALIDATION_ERROR", "Request validation failed", [
              { path: "query.cursor", message: "File cursor is invalid" },
            ]);
          }
          throw error;
        }
      }
      const result = await dependencies.repository.list({
        internalProjectId: project.internalProjectId,
        limit: query.limit,
        ...(startAfterFileId ? { startAfterFileId } : {}),
      });
      if (result.items.some((item) => item.internalProjectId !== project.internalProjectId)) {
        throw new Error("Repository returned a file for another project");
      }
      return FileListPayloadSchema.parse({
        items: result.items.map(toPublicFile),
        ...(result.nextFileId
          ? {
              nextCursor: encodeFileCursor(project.internalProjectId, {
                fileId: result.nextFileId,
              }),
            }
          : {}),
      });
    },

    async inspect(project, fileId) {
      const item = await dependencies.repository.get(project.internalProjectId, fileId);
      if (!item || item.internalProjectId !== project.internalProjectId) throw fileNotFound();
      return toPublicFile(item);
    },
  };
}
