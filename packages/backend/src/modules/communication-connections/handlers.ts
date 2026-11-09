import {
  CommunicationConnectionPathSchema,
  CommunicationConnectionSchema,
  CreateCommunicationConnectionRequestSchema,
} from "@utility-services/contracts";

import { createHttpHandler, type SafeLogger } from "../../core/http/handler.js";
import { extractOwnerContext } from "../identity-control/auth/owner-context.js";
import type { createCommunicationConnectionService } from "./service.js";

type CommunicationConnectionService = ReturnType<typeof createCommunicationConnectionService>;

export function createRegisterCommunicationConnectionHandler(
  service: CommunicationConnectionService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: {
      path: CommunicationConnectionPathSchema.pick({ projectId: true }),
      body: CreateCommunicationConnectionRequestSchema,
      response: CommunicationConnectionSchema,
    },
    deriveAuthorization: extractOwnerContext,
    successStatusCode: 201,
    callback: ({ authorization, path, body }) => service.create(authorization, path.projectId, body),
    ...(logger ? { logger } : {}),
  });
}

export function createInspectCommunicationConnectionHandler(
  service: CommunicationConnectionService,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { path: CommunicationConnectionPathSchema, response: CommunicationConnectionSchema },
    deriveAuthorization: extractOwnerContext,
    callback: ({ authorization, path }) => service.inspect(authorization, path.connectionId),
    ...(logger ? { logger } : {}),
  });
}
