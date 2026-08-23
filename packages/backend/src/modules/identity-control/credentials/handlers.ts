import {
  ApiKeyListPayloadSchema,
  ApiKeyListQuerySchema,
  ApiKeyPathSchema,
  ApiKeyProjectPathSchema,
  IssuedApiKeySchema,
  RevokedApiKeySchema,
} from "@utility-services/contracts";
import { z } from "zod";

import { createHttpHandler, type SafeLogger } from "../../../core/http/handler.js";
import { extractOwnerContext } from "../auth/owner-context.js";
import type { CredentialService } from "./service.js";

const EmptyBodySchema = z.undefined();

export function createIssueProjectApiKeyHandler(service: CredentialService, logger?: SafeLogger) {
  return createHttpHandler({
    schemas: {
      path: ApiKeyProjectPathSchema,
      body: EmptyBodySchema,
      response: IssuedApiKeySchema,
    },
    deriveAuthorization: extractOwnerContext,
    successStatusCode: 201,
    callback: ({ authorization, path }) => service.issue(authorization, path.projectId),
    ...(logger ? { logger } : {}),
  });
}

export function createListProjectApiKeysHandler(service: CredentialService, logger?: SafeLogger) {
  return createHttpHandler({
    schemas: {
      path: ApiKeyProjectPathSchema,
      query: ApiKeyListQuerySchema,
      response: ApiKeyListPayloadSchema,
    },
    deriveAuthorization: extractOwnerContext,
    callback: ({ authorization, path, query }) =>
      service.list(authorization, path.projectId, query),
    ...(logger ? { logger } : {}),
  });
}

export function createRevokeProjectApiKeyHandler(service: CredentialService, logger?: SafeLogger) {
  return createHttpHandler({
    schemas: { path: ApiKeyPathSchema, body: EmptyBodySchema, response: RevokedApiKeySchema },
    deriveAuthorization: extractOwnerContext,
    callback: ({ authorization, path }) =>
      service.revoke(authorization, path.projectId, path.keyId),
    ...(logger ? { logger } : {}),
  });
}

export function createReplaceProjectApiKeyHandler(service: CredentialService, logger?: SafeLogger) {
  return createHttpHandler({
    schemas: { path: ApiKeyPathSchema, body: EmptyBodySchema, response: IssuedApiKeySchema },
    deriveAuthorization: extractOwnerContext,
    successStatusCode: 201,
    callback: ({ authorization, path }) =>
      service.replace(authorization, path.projectId, path.keyId),
    ...(logger ? { logger } : {}),
  });
}
