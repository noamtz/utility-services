import {
  GroupDirectoryListSchema,
  GroupDirectoryQuerySchema,
  GroupEventListSchema,
  GroupEventPathSchema,
} from "@utility-services/contracts";
import { createHttpHandler, type SafeLogger } from "../../core/http/handler.js";
import { createProjectAuthorization } from "../project-authentication/authorization.js";
import type { ProjectAuthenticationService } from "../project-authentication/service.js";
import type { createGroupDirectoryService } from "./service.js";

type Service = ReturnType<typeof createGroupDirectoryService>;
export function createListGroupsHandler(
  service: Service,
  authentication: ProjectAuthenticationService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { query: GroupDirectoryQuerySchema, response: GroupDirectoryListSchema },
    deriveAuthorization: createProjectAuthorization(authentication, "communication"),
    callback: ({ authorization, query }) => service.list(authorization, query),
    ...(logger ? { logger } : {}),
  });
}
export function createListGroupEventsHandler(
  service: Service,
  authentication: ProjectAuthenticationService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: {
      path: GroupEventPathSchema,
      query: GroupDirectoryQuerySchema,
      response: GroupEventListSchema,
    },
    deriveAuthorization: createProjectAuthorization(authentication, "communication"),
    callback: ({ authorization, path, query }) =>
      service.events(authorization, path.groupId, query),
    ...(logger ? { logger } : {}),
  });
}
