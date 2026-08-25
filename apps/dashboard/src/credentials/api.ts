import {
  ApiKeyListResponseSchema,
  ApiKeyListQuerySchema,
  IssuedApiKeyResponseSchema,
  RevokedApiKeyResponseSchema,
  type ApiKeyListPayload,
  type ApiKeyListQuery,
  type IssuedApiKey,
  type RevokedApiKey,
} from "@utility-services/contracts";

import type { ControlClient } from "../api/control-client.js";

export interface CredentialApi {
  issue(projectId: string): Promise<IssuedApiKey>;
  list(projectId: string, query?: Partial<ApiKeyListQuery>): Promise<ApiKeyListPayload>;
  revoke(projectId: string, keyId: string): Promise<RevokedApiKey>;
  replace(projectId: string, keyId: string): Promise<IssuedApiKey>;
}

export function createCredentialApi(client: ControlClient): CredentialApi {
  const projectPath = (projectId: string) =>
    `/v1/control/projects/${encodeURIComponent(projectId)}/api-keys`;
  return Object.freeze({
    async issue(projectId: string) {
      return (
        await client.request(projectPath(projectId), IssuedApiKeyResponseSchema, { method: "POST" })
      ).data;
    },
    async list(projectId: string, query = {}) {
      const validated = ApiKeyListQuerySchema.parse(query);
      const search = new URLSearchParams({ limit: String(validated.limit) });
      if (validated.cursor) search.set("cursor", validated.cursor);
      return (
        await client.request(
          `${projectPath(projectId)}?${search.toString()}`,
          ApiKeyListResponseSchema,
        )
      ).data;
    },
    async revoke(projectId: string, keyId: string) {
      return (
        await client.request(
          `${projectPath(projectId)}/${encodeURIComponent(keyId)}`,
          RevokedApiKeyResponseSchema,
          { method: "DELETE" },
        )
      ).data;
    },
    async replace(projectId: string, keyId: string) {
      return (
        await client.request(
          `${projectPath(projectId)}/${encodeURIComponent(keyId)}/replace`,
          IssuedApiKeyResponseSchema,
          { method: "POST" },
        )
      ).data;
    },
  });
}
