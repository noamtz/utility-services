import {
  CreateProjectRequestSchema,
  ProjectListPayloadSchema,
  ProjectListQuerySchema,
  ProjectPathSchema,
  ProjectSchema,
} from "@utility-services/contracts";

import { createHttpHandler, type SafeLogger } from "../../../core/http/handler.js";
import { extractOwnerContext } from "../auth/owner-context.js";
import type { ProjectService } from "./service.js";

export function createCreateProjectHandler(service: ProjectService, logger?: SafeLogger) {
  return createHttpHandler({
    schemas: { body: CreateProjectRequestSchema, response: ProjectSchema },
    deriveAuthorization: extractOwnerContext,
    successStatusCode: 201,
    callback: ({ authorization, body }) => service.create(authorization, body),
    ...(logger ? { logger } : {}),
  });
}

export function createListProjectsHandler(service: ProjectService, logger?: SafeLogger) {
  return createHttpHandler({
    schemas: { query: ProjectListQuerySchema, response: ProjectListPayloadSchema },
    deriveAuthorization: extractOwnerContext,
    callback: ({ authorization, query }) => service.list(authorization, query),
    ...(logger ? { logger } : {}),
  });
}

export function createInspectProjectHandler(service: ProjectService, logger?: SafeLogger) {
  return createHttpHandler({
    schemas: { path: ProjectPathSchema, response: ProjectSchema },
    deriveAuthorization: extractOwnerContext,
    callback: ({ authorization, path }) => service.inspect(authorization, path.projectId),
    ...(logger ? { logger } : {}),
  });
}
