import { z } from "zod";

import { createSuccessEnvelopeSchema } from "../http/envelope.js";
import { PublicProjectIdSchema } from "../projects/contract.js";

export const DEFAULT_API_KEY_LIST_LIMIT = 20;
export const MAX_API_KEY_LIST_LIMIT = 50;

export const ApiKeyIdSchema = z.string().regex(/^key_[A-Za-z0-9_-]{22}$/, "API key ID is invalid");

export const ProjectApiKeySchema = z
  .string()
  .regex(/^rus_v1\.key_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/, "API key is invalid");

export const ApiKeyStatusSchema = z.enum(["active", "revoked", "replaced", "suspended"]);

export const ApiKeyProjectPathSchema = z.object({ projectId: PublicProjectIdSchema }).strict();

export const ApiKeyPathSchema = ApiKeyProjectPathSchema.extend({
  keyId: ApiKeyIdSchema,
}).strict();

export const ApiKeyCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/, "API key cursor is invalid");

export const ApiKeyListQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_API_KEY_LIST_LIMIT)
      .default(DEFAULT_API_KEY_LIST_LIMIT),
    cursor: ApiKeyCursorSchema.optional(),
  })
  .strict();

const TimestampSchema = z.iso.datetime({ offset: true });

export const ApiKeyMetadataSchema = z
  .object({
    keyId: ApiKeyIdSchema,
    status: ApiKeyStatusSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    revokedAt: TimestampSchema.optional(),
    replacedAt: TimestampSchema.optional(),
    replacementKeyId: ApiKeyIdSchema.optional(),
  })
  .strict();

export const ApiKeyListPayloadSchema = z
  .object({
    items: z.array(ApiKeyMetadataSchema),
    nextCursor: ApiKeyCursorSchema.optional(),
  })
  .strict();

export const IssuedApiKeySchema = z
  .object({
    apiKey: ProjectApiKeySchema,
    metadata: ApiKeyMetadataSchema,
  })
  .strict();

export const RevokedApiKeySchema = z.object({ metadata: ApiKeyMetadataSchema }).strict();

export const IssuedApiKeyResponseSchema = createSuccessEnvelopeSchema(IssuedApiKeySchema);
export const ApiKeyListResponseSchema = createSuccessEnvelopeSchema(ApiKeyListPayloadSchema);
export const RevokedApiKeyResponseSchema = createSuccessEnvelopeSchema(RevokedApiKeySchema);

export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;
export type ApiKeyProjectPath = z.infer<typeof ApiKeyProjectPathSchema>;
export type ApiKeyPath = z.infer<typeof ApiKeyPathSchema>;
export type ApiKeyListQuery = z.infer<typeof ApiKeyListQuerySchema>;
export type ApiKeyMetadata = z.infer<typeof ApiKeyMetadataSchema>;
export type ApiKeyListPayload = z.infer<typeof ApiKeyListPayloadSchema>;
export type IssuedApiKey = z.infer<typeof IssuedApiKeySchema>;
export type RevokedApiKey = z.infer<typeof RevokedApiKeySchema>;
export type IssuedApiKeyResponse = z.infer<typeof IssuedApiKeyResponseSchema>;
export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponseSchema>;
export type RevokedApiKeyResponse = z.infer<typeof RevokedApiKeyResponseSchema>;
