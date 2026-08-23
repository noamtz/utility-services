import {
  CreateUploadRequestSchema,
  FileListPayloadSchema,
  FileListQuerySchema,
  FilePathSchema,
  FileSchema,
  UploadAuthorizationSchema,
} from "@utility-services/contracts";
import { z } from "zod";

import { createHttpHandler, type SafeLogger } from "../../core/http/handler.js";
import { createProjectAuthorization } from "../project-authentication/authorization.js";
import type { ProjectAuthenticationService } from "../project-authentication/service.js";
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
