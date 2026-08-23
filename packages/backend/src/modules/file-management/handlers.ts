import {
  CreateUploadRequestSchema,
  DeleteFileQuerySchema,
  DeleteFileResultSchema,
  DownloadAuthorizationSchema,
  FileListPayloadSchema,
  FileListQuerySchema,
  FilePathSchema,
  FileSchema,
  PublicFilePathSchema,
  UploadAuthorizationSchema,
} from "@utility-services/contracts";
import { z } from "zod";

import {
  createHttpHandler,
  createHttpRedirectHandler,
  type SafeLogger,
} from "../../core/http/handler.js";
import { createProjectAuthorization } from "../project-authentication/authorization.js";
import type { ProjectAuthenticationService } from "../project-authentication/service.js";
import type { DownloadService } from "./downloads.js";
import type { FileLifecycleService } from "./lifecycle.js";
import type { FileService } from "./service.js";

const CreateUploadBoundaryRequestSchema = CreateUploadRequestSchema.extend({
  sizeBytes: z.number().int().safe().positive(),
});

export function createAuthorizeUploadHandler(
  service: FileService,
  authentication: ProjectAuthenticationService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { body: CreateUploadBoundaryRequestSchema, response: UploadAuthorizationSchema },
    deriveAuthorization: createProjectAuthorization(authentication),
    successStatusCode: 201,
    callback: ({ authorization, body }) => service.authorizeUpload(authorization, body),
    ...(logger ? { logger } : {}),
  });
}

export function createListFilesHandler(
  service: FileService,
  authentication: ProjectAuthenticationService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { query: FileListQuerySchema, response: FileListPayloadSchema },
    deriveAuthorization: createProjectAuthorization(authentication),
    callback: ({ authorization, query }) => service.list(authorization, query),
    ...(logger ? { logger } : {}),
  });
}

export function createInspectFileHandler(
  service: FileService,
  authentication: ProjectAuthenticationService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { path: FilePathSchema, response: FileSchema },
    deriveAuthorization: createProjectAuthorization(authentication),
    callback: ({ authorization, path }) => service.inspect(authorization, path.fileId),
    ...(logger ? { logger } : {}),
  });
}

export function createAuthorizeDownloadHandler(
  service: DownloadService,
  authentication: ProjectAuthenticationService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { path: FilePathSchema, response: DownloadAuthorizationSchema },
    deriveAuthorization: createProjectAuthorization(authentication),
    callback: ({ authorization, path }) => service.authorizePrivate(authorization, path.fileId),
    ...(logger ? { logger } : {}),
  });
}

export function createPublicDownloadHandler(service: DownloadService, logger?: SafeLogger) {
  return createHttpRedirectHandler({
    schemas: { path: PublicFilePathSchema, response: z.url().startsWith("https://") },
    callback: ({ path }) => service.authorizePublic(path.publicProjectId, path.publicFileId),
    ...(logger ? { logger } : {}),
  });
}

export function createDeleteFileHandler(
  service: FileLifecycleService,
  authentication: ProjectAuthenticationService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: {
      path: FilePathSchema,
      query: DeleteFileQuerySchema,
      response: DeleteFileResultSchema,
    },
    deriveAuthorization: createProjectAuthorization(authentication),
    callback: ({ authorization, path, query }) => service.delete(authorization, path.fileId, query),
    ...(logger ? { logger } : {}),
  });
}

export function createRestoreFileHandler(
  service: FileLifecycleService,
  authentication: ProjectAuthenticationService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { path: FilePathSchema, response: FileSchema },
    deriveAuthorization: createProjectAuthorization(authentication),
    callback: ({ authorization, path }) => service.restore(authorization, path.fileId),
    ...(logger ? { logger } : {}),
  });
}
