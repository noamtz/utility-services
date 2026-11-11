import {
  CommunicationConnectionPathSchema,
  CommunicationConnectionListSchema,
  CommunicationConnectionSchema,
  CreateCommunicationConnectionRequestSchema,
  RotateCommunicationCredentialRequestSchema,
  WebhookSetupSchema,
} from "@utility-services/contracts";

import { createHttpHandler, HttpError, type SafeLogger } from "../../core/http/handler.js";
import { extractOwnerContext } from "../identity-control/auth/owner-context.js";
import type { OwnerContext } from "../identity-control/auth/owner-context.js";
import type { InternalProject } from "../identity-control/projects/model.js";
import type { createCommunicationConnectionService } from "./service.js";

type CommunicationConnectionService = ReturnType<typeof createCommunicationConnectionService>;
type ProjectInspector = {
  inspect(projectId: string): Promise<InternalProject | undefined>;
};

async function authorizeCommunicationProject(
  projects: ProjectInspector,
  owner: OwnerContext,
  projectId: string,
): Promise<void> {
  const project = await projects.inspect(projectId);
  if (
    !project ||
    project.ownerId !== owner.ownerId ||
    !project.enabledUtilities.includes("communication")
  ) {
    throw new HttpError(404, "NOT_FOUND", "Project not found");
  }
}

async function authorizeConnectionPath(
  service: CommunicationConnectionService,
  owner: OwnerContext,
  projectId: string,
  connectionId: string,
): Promise<void> {
  const connection = await service.inspect(owner, connectionId);
  if (connection.projectId !== projectId) {
    throw new HttpError(404, "NOT_FOUND", "Communication connection not found");
  }
}

export function createRegisterCommunicationConnectionHandler(
  service: CommunicationConnectionService,
  projects: ProjectInspector,
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
    callback: async ({ authorization, path, body }) => {
      await authorizeCommunicationProject(projects, authorization, path.projectId);
      return service.create(authorization, path.projectId, body);
    },
    ...(logger ? { logger } : {}),
  });
}

export function createListCommunicationConnectionsHandler(
  service: CommunicationConnectionService,
  projects: ProjectInspector,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: {
      path: CommunicationConnectionPathSchema.pick({ projectId: true }),
      response: CommunicationConnectionListSchema,
    },
    deriveAuthorization: extractOwnerContext,
    callback: async ({ authorization, path }) => {
      await authorizeCommunicationProject(projects, authorization, path.projectId);
      return { items: Array.from(await service.list(authorization, path.projectId)) };
    },
    ...(logger ? { logger } : {}),
  });
}

export function createInspectCommunicationConnectionHandler(
  service: CommunicationConnectionService,
  projects: ProjectInspector,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { path: CommunicationConnectionPathSchema, response: CommunicationConnectionSchema },
    deriveAuthorization: extractOwnerContext,
    callback: async ({ authorization, path }) => {
      await authorizeCommunicationProject(projects, authorization, path.projectId);
      await authorizeConnectionPath(service, authorization, path.projectId, path.connectionId);
      return service.inspect(authorization, path.connectionId);
    },
    ...(logger ? { logger } : {}),
  });
}

export function createRotateCommunicationConnectionHandler(
  service: CommunicationConnectionService,
  projects: ProjectInspector,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: {
      path: CommunicationConnectionPathSchema,
      body: RotateCommunicationCredentialRequestSchema,
      response: CommunicationConnectionSchema,
    },
    deriveAuthorization: extractOwnerContext,
    callback: async ({ authorization, path, body }) => {
      await authorizeCommunicationProject(projects, authorization, path.projectId);
      await authorizeConnectionPath(service, authorization, path.projectId, path.connectionId);
      return service.rotate(authorization, path.connectionId, body.credential);
    },
    ...(logger ? { logger } : {}),
  });
}

export function createDisableCommunicationConnectionHandler(
  service: CommunicationConnectionService,
  projects: ProjectInspector,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { path: CommunicationConnectionPathSchema, response: CommunicationConnectionSchema },
    deriveAuthorization: extractOwnerContext,
    callback: async ({ authorization, path }) => {
      await authorizeCommunicationProject(projects, authorization, path.projectId);
      await authorizeConnectionPath(service, authorization, path.projectId, path.connectionId);
      return service.disable(authorization, path.connectionId);
    },
    ...(logger ? { logger } : {}),
  });
}

export function createSetupCommunicationWebhookHandler(
  service: CommunicationConnectionService,
  projects: ProjectInspector,
  callbackBaseUrl: string,
  logger?: SafeLogger,
) {
  return createHttpHandler({
    schemas: { path: CommunicationConnectionPathSchema, response: WebhookSetupSchema },
    deriveAuthorization: extractOwnerContext,
    callback: async ({ authorization, path }) => {
      await authorizeCommunicationProject(projects, authorization, path.projectId);
      return service.setupWebhook(
        authorization,
        path.projectId,
        path.connectionId,
        `${callbackBaseUrl}/v1/communication/webhooks/${path.connectionId}`,
      );
    },
    ...(logger ? { logger } : {}),
  });
}
