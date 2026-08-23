import { describe, expect, it } from "vitest";

import {
  ApiKeyListPayloadSchema,
  ApiKeyListQuerySchema,
  ApiKeyMetadataSchema,
  ApiKeyPathSchema,
  DEFAULT_API_KEY_LIST_LIMIT,
  IssuedApiKeySchema,
  ProjectApiKeySchema,
  RevokedApiKeySchema,
} from "./contract.js";

const projectId = "prj_0123456789abcdefghijkl";
const keyId = "key_0123456789abcdefghijkl";
const apiKey = `rus_v1.${keyId}.${"a".repeat(43)}`;
const timestamp = "2026-08-23T08:00:00.000Z";
const metadata = { keyId, status: "active", createdAt: timestamp, updatedAt: timestamp } as const;

describe("API key contracts", () => {
  it("accepts only the versioned split credential grammar", () => {
    expect(ProjectApiKeySchema.parse(apiKey)).toBe(apiKey);
    for (const candidate of [
      `rus_v2.${keyId}.${"a".repeat(43)}`,
      `rus_v1.${keyId}.${"a".repeat(42)}`,
      `rus_v1.${keyId}.${"a".repeat(43)}.extra`,
      `rus_v1.key_${"!".repeat(22)}.${"a".repeat(43)}`,
    ]) {
      expect(ProjectApiKeySchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("parses strict project/key paths and bounded list queries", () => {
    expect(ApiKeyPathSchema.parse({ projectId, keyId })).toEqual({ projectId, keyId });
    expect(ApiKeyPathSchema.safeParse({ projectId, keyId, ownerId: "caller" }).success).toBe(false);
    expect(ApiKeyListQuerySchema.parse({})).toEqual({ limit: DEFAULT_API_KEY_LIST_LIMIT });
    expect(ApiKeyListQuerySchema.parse({ limit: "50", cursor: "next_page" })).toEqual({
      limit: 50,
      cursor: "next_page",
    });
    expect(ApiKeyListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(ApiKeyListQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(ApiKeyListQuerySchema.safeParse({ cursor: "not a cursor" }).success).toBe(false);
  });

  it("keeps metadata, lists, and revoke responses secret-free and strict", () => {
    expect(ApiKeyMetadataSchema.parse(metadata)).toEqual(metadata);
    for (const privateField of [
      "apiKey",
      "secret",
      "secretHash",
      "ownerId",
      "internalProjectId",
      "pk",
    ] as const) {
      expect(
        ApiKeyMetadataSchema.safeParse({ ...metadata, [privateField]: "private" }).success,
      ).toBe(false);
    }
    expect(ApiKeyListPayloadSchema.parse({ items: [metadata], nextCursor: "next" })).toEqual({
      items: [metadata],
      nextCursor: "next",
    });
    expect(RevokedApiKeySchema.parse({ metadata })).toEqual({ metadata });
    expect(RevokedApiKeySchema.safeParse({ metadata, apiKey }).success).toBe(false);
  });

  it("isolates one-time plaintext to issue and replace payloads", () => {
    expect(IssuedApiKeySchema.parse({ apiKey, metadata })).toEqual({ apiKey, metadata });
    expect(IssuedApiKeySchema.safeParse({ apiKey, metadata, secretHash: "private" }).success).toBe(
      false,
    );
  });

  it("validates lifecycle metadata states without widening the public shape", () => {
    expect(
      ApiKeyMetadataSchema.parse({
        ...metadata,
        status: "replaced",
        replacedAt: timestamp,
        replacementKeyId: "key_0123456789abcdefghijkm",
      }),
    ).toMatchObject({ status: "replaced" });
    expect(ApiKeyMetadataSchema.safeParse({ ...metadata, status: "expired" }).success).toBe(false);
  });
});
