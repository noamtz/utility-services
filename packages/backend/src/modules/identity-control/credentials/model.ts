import {
  ApiKeyIdSchema,
  ApiKeyMetadataSchema,
  ApiKeyStatusSchema,
  PublicProjectIdSchema,
  type ApiKeyMetadata,
  type ApiKeyStatus,
} from "@utility-services/contracts";
import { z } from "zod";

export const API_KEY_LOOKUP_SORT_KEY = "LOOKUP" as const;
export const API_KEY_SORT_PREFIX = "API_KEY#" as const;

const TimestampSchema = z.iso.datetime({ offset: true });
const SecretHashSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const CredentialLifecycleShape = {
  internalProjectId: z.uuid(),
  publicProjectId: PublicProjectIdSchema,
  keyId: ApiKeyIdSchema,
  status: ApiKeyStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  revokedAt: TimestampSchema.optional(),
  replacedAt: TimestampSchema.optional(),
  replacementKeyId: ApiKeyIdSchema.optional(),
} as const;

function lifecycleIsValid(value: {
  status: ApiKeyStatus;
  revokedAt?: string | undefined;
  replacedAt?: string | undefined;
  replacementKeyId?: string | undefined;
}): boolean {
  if (value.status === "revoked") {
    return (
      value.revokedAt !== undefined &&
      value.replacedAt === undefined &&
      value.replacementKeyId === undefined
    );
  }
  if (value.status === "replaced") {
    return (
      value.revokedAt === undefined &&
      value.replacedAt !== undefined &&
      value.replacementKeyId !== undefined
    );
  }
  return (
    value.revokedAt === undefined &&
    value.replacedAt === undefined &&
    value.replacementKeyId === undefined
  );
}

export const ProjectApiKeyMetadataItemSchema = z
  .object({
    pk: z.string().startsWith("PROJECT#"),
    sk: z.string().startsWith(API_KEY_SORT_PREFIX),
    itemType: z.literal("api-key-metadata"),
    ...CredentialLifecycleShape,
  })
  .strict()
  .refine(lifecycleIsValid, "Credential lifecycle fields are inconsistent");

export const ApiKeyLookupItemSchema = z
  .object({
    pk: z.string().startsWith("API_KEY#"),
    sk: z.literal(API_KEY_LOOKUP_SORT_KEY),
    itemType: z.literal("api-key-lookup"),
    secretHash: SecretHashSchema,
    ...CredentialLifecycleShape,
  })
  .strict()
  .refine(lifecycleIsValid, "Credential lifecycle fields are inconsistent");

export type ProjectApiKeyMetadataItem = z.infer<typeof ProjectApiKeyMetadataItemSchema>;
export type ApiKeyLookupItem = z.infer<typeof ApiKeyLookupItemSchema>;

export function projectApiKeySortKey(keyId: string): string {
  return `${API_KEY_SORT_PREFIX}${ApiKeyIdSchema.parse(keyId)}`;
}

export function apiKeyLookupPartitionKey(keyId: string): string {
  return `API_KEY#${ApiKeyIdSchema.parse(keyId)}`;
}

export function parseProjectApiKeyMetadataItem(input: unknown): ProjectApiKeyMetadataItem {
  const parsed = ProjectApiKeyMetadataItemSchema.parse(input);
  if (
    parsed.pk !== `PROJECT#${parsed.publicProjectId}` ||
    parsed.sk !== projectApiKeySortKey(parsed.keyId)
  ) {
    throw new Error("Credential metadata keys are inconsistent");
  }
  return parsed;
}

export function parseApiKeyLookupItem(input: unknown): ApiKeyLookupItem {
  const parsed = ApiKeyLookupItemSchema.parse(input);
  if (parsed.pk !== apiKeyLookupPartitionKey(parsed.keyId)) {
    throw new Error("Credential lookup keys are inconsistent");
  }
  return parsed;
}

export function toCredentialItems(input: {
  readonly internalProjectId: string;
  readonly publicProjectId: string;
  readonly keyId: string;
  readonly secretHash: string;
  readonly createdAt: string;
}): { metadata: ProjectApiKeyMetadataItem; lookup: ApiKeyLookupItem } {
  const common = {
    internalProjectId: input.internalProjectId,
    publicProjectId: input.publicProjectId,
    keyId: input.keyId,
    status: "active" as const,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  return Object.freeze({
    metadata: parseProjectApiKeyMetadataItem({
      pk: `PROJECT#${PublicProjectIdSchema.parse(input.publicProjectId)}`,
      sk: projectApiKeySortKey(input.keyId),
      itemType: "api-key-metadata",
      ...common,
    }),
    lookup: parseApiKeyLookupItem({
      pk: apiKeyLookupPartitionKey(input.keyId),
      sk: API_KEY_LOOKUP_SORT_KEY,
      itemType: "api-key-lookup",
      secretHash: SecretHashSchema.parse(input.secretHash),
      ...common,
    }),
  });
}

export function assertCredentialRecordsMatch(
  metadataInput: unknown,
  lookupInput: unknown,
): { metadata: ProjectApiKeyMetadataItem; lookup: ApiKeyLookupItem } {
  const metadata = parseProjectApiKeyMetadataItem(metadataInput);
  const lookup = parseApiKeyLookupItem(lookupInput);
  const fields = [
    "internalProjectId",
    "publicProjectId",
    "keyId",
    "status",
    "createdAt",
    "updatedAt",
    "revokedAt",
    "replacedAt",
    "replacementKeyId",
  ] as const;
  if (fields.some((field) => metadata[field] !== lookup[field])) {
    throw new Error("Credential records are inconsistent");
  }
  return Object.freeze({ metadata, lookup });
}

export function toApiKeyMetadata(item: ProjectApiKeyMetadataItem): ApiKeyMetadata {
  return ApiKeyMetadataSchema.parse({
    keyId: item.keyId,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.revokedAt ? { revokedAt: item.revokedAt } : {}),
    ...(item.replacedAt ? { replacedAt: item.replacedAt } : {}),
    ...(item.replacementKeyId ? { replacementKeyId: item.replacementKeyId } : {}),
  });
}

export function withRevokedStatus<T extends ProjectApiKeyMetadataItem | ApiKeyLookupItem>(
  item: T,
  timestamp: string,
): T {
  if (item.status === "revoked" || item.status === "replaced") return item;
  return { ...item, status: "revoked", updatedAt: timestamp, revokedAt: timestamp };
}

export function withReplacedStatus<T extends ProjectApiKeyMetadataItem | ApiKeyLookupItem>(
  item: T,
  timestamp: string,
  replacementKeyId: string,
): T {
  return {
    ...item,
    status: "replaced",
    updatedAt: timestamp,
    replacedAt: timestamp,
    replacementKeyId: ApiKeyIdSchema.parse(replacementKeyId),
  };
}
