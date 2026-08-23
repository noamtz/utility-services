import {
  ApiKeyListPayloadSchema,
  IssuedApiKeySchema,
  RevokedApiKeySchema,
  type ApiKeyListPayload,
  type ApiKeyListQuery,
  type IssuedApiKey,
  type RevokedApiKey,
} from "@utility-services/contracts";

import { HttpError } from "../../../core/http/handler.js";
import type { OwnerContext } from "../auth/owner-context.js";
import { decodeApiKeyCursor, encodeApiKeyCursor, InvalidApiKeyCursorError } from "./cursor.js";
import {
  encodeSecretHash,
  generateProjectApiKey,
  hashApiKeySecret,
  type GeneratedProjectApiKey,
} from "./credential.js";
import { toApiKeyMetadata, toCredentialItems } from "./model.js";
import {
  CredentialCollisionError,
  CredentialStateConflictError,
  type CredentialRepository,
} from "./repository.js";

export interface CredentialService {
  issue(owner: OwnerContext, publicProjectId: string): Promise<IssuedApiKey>;
  list(
    owner: OwnerContext,
    publicProjectId: string,
    query: ApiKeyListQuery,
  ): Promise<ApiKeyListPayload>;
  revoke(owner: OwnerContext, publicProjectId: string, keyId: string): Promise<RevokedApiKey>;
  replace(owner: OwnerContext, publicProjectId: string, keyId: string): Promise<IssuedApiKey>;
}

export interface CredentialServiceDependencies {
  readonly repository: CredentialRepository;
  readonly generateCredential?: () => GeneratedProjectApiKey;
  readonly now?: () => Date;
  readonly collisionAttempts?: number;
}

function projectNotFound(): HttpError {
  return new HttpError(404, "NOT_FOUND", "Project not found");
}

function apiKeyNotFound(): HttpError {
  return new HttpError(404, "NOT_FOUND", "API key not found");
}

function lifecycleConflict(): HttpError {
  return new HttpError(409, "CONFLICT", "API key cannot be replaced in its current state");
}

function internalError(): HttpError {
  return new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred");
}

export function createCredentialService(
  dependencies: CredentialServiceDependencies,
): CredentialService {
  const generateCredential = dependencies.generateCredential ?? generateProjectApiKey;
  const now = dependencies.now ?? (() => new Date());
  const collisionAttempts = dependencies.collisionAttempts ?? 3;
  if (!Number.isInteger(collisionAttempts) || collisionAttempts < 1 || collisionAttempts > 10) {
    throw new RangeError("collisionAttempts must be an integer between 1 and 10");
  }

  async function ownedProject(owner: OwnerContext, publicProjectId: string) {
    const project = await dependencies.repository.inspectProject(publicProjectId);
    if (!project || project.ownerId !== owner.ownerId) throw projectNotFound();
    return project;
  }

  async function createForProject(
    project: Awaited<ReturnType<typeof ownedProject>>,
    operation: "issue" | "replace",
    targetKeyId?: string,
  ): Promise<IssuedApiKey> {
    const timestamp = now().toISOString();
    for (let attempt = 1; attempt <= collisionAttempts; attempt += 1) {
      const generated = generateCredential();
      const records = toCredentialItems({
        internalProjectId: project.internalProjectId,
        publicProjectId: project.publicProjectId,
        keyId: generated.keyId,
        secretHash: encodeSecretHash(hashApiKeySecret(generated.secret)),
        createdAt: timestamp,
      });
      try {
        if (operation === "issue") {
          await dependencies.repository.issue(project, records.metadata, records.lookup);
        } else {
          const current = await dependencies.repository.inspectMetadata(
            project.publicProjectId,
            targetKeyId!,
          );
          if (!current) throw apiKeyNotFound();
          if (current.status !== "active" && current.status !== "suspended") {
            throw lifecycleConflict();
          }
          await dependencies.repository.replace(
            current,
            records.metadata,
            records.lookup,
            timestamp,
          );
        }
        return IssuedApiKeySchema.parse({
          apiKey: generated.apiKey,
          metadata: toApiKeyMetadata(records.metadata),
        });
      } catch (error) {
        if (error instanceof CredentialCollisionError) {
          if (attempt === collisionAttempts) throw internalError();
          continue;
        }
        if (error instanceof CredentialStateConflictError) {
          if (operation === "replace") throw lifecycleConflict();
          throw new HttpError(409, "CONFLICT", "Project state changed; retry the request");
        }
        throw error;
      }
    }
    throw internalError();
  }

  return {
    async issue(owner, publicProjectId) {
      return createForProject(await ownedProject(owner, publicProjectId), "issue");
    },

    async list(owner, publicProjectId, query) {
      await ownedProject(owner, publicProjectId);
      let startAfter;
      if (query.cursor) {
        try {
          startAfter = decodeApiKeyCursor(query.cursor);
        } catch (error) {
          if (error instanceof InvalidApiKeyCursorError) {
            throw new HttpError(400, "VALIDATION_ERROR", "Request validation failed", [
              { path: "query.cursor", message: "API key cursor is invalid" },
            ]);
          }
          throw error;
        }
      }
      const result = await dependencies.repository.list({
        publicProjectId,
        limit: query.limit,
        ...(startAfter ? { startAfter } : {}),
      });
      if (result.items.some((item) => item.publicProjectId !== publicProjectId)) {
        throw new Error("Repository returned an API key for another project");
      }
      return ApiKeyListPayloadSchema.parse({
        items: result.items.map(toApiKeyMetadata),
        ...(result.nextCursor ? { nextCursor: encodeApiKeyCursor(result.nextCursor) } : {}),
      });
    },

    async revoke(owner, publicProjectId, keyId) {
      await ownedProject(owner, publicProjectId);
      let current = await dependencies.repository.inspectMetadata(publicProjectId, keyId);
      if (!current) throw apiKeyNotFound();
      try {
        current = await dependencies.repository.revoke(current, now().toISOString());
      } catch (error) {
        if (!(error instanceof CredentialStateConflictError)) throw error;
        const latest = await dependencies.repository.inspectMetadata(publicProjectId, keyId);
        if (!latest || (latest.status !== "revoked" && latest.status !== "replaced")) {
          throw new HttpError(409, "CONFLICT", "API key state changed; retry the request");
        }
        current = latest;
      }
      return RevokedApiKeySchema.parse({ metadata: toApiKeyMetadata(current) });
    },

    async replace(owner, publicProjectId, keyId) {
      const project = await ownedProject(owner, publicProjectId);
      const current = await dependencies.repository.inspectMetadata(publicProjectId, keyId);
      if (!current) throw apiKeyNotFound();
      if (current.status !== "active" && current.status !== "suspended") throw lifecycleConflict();
      return createForProject(project, "replace", keyId);
    },
  };
}
