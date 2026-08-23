import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { ApiKeyIdSchema, ProjectApiKeySchema } from "@utility-services/contracts";

export const API_KEY_ID_ENTROPY_BYTES = 16;
export const API_KEY_SECRET_ENTROPY_BYTES = 32;
export const API_KEY_DIGEST_BYTES = 32;
export const API_KEY_VERSION = "rus_v1" as const;
export const DUMMY_SECRET_HASH = Buffer.alloc(API_KEY_DIGEST_BYTES).toString("base64url");

export interface GeneratedProjectApiKey {
  readonly keyId: string;
  readonly secret: string;
  readonly apiKey: string;
}

export interface ParsedProjectApiKey {
  readonly keyId: string;
  readonly secret: string;
}

export type RandomBytesFactory = (size: number) => Buffer;
export type DigestComparator = (left: Buffer, right: Buffer) => boolean;

function exactEntropy(factory: RandomBytesFactory, size: number): Buffer {
  const bytes = factory(size);
  if (bytes.length !== size) {
    throw new Error("Credential entropy source returned an invalid length");
  }
  return bytes;
}

export function generateProjectApiKey(
  createRandomBytes: RandomBytesFactory = randomBytes,
): GeneratedProjectApiKey {
  const keyId = ApiKeyIdSchema.parse(
    `key_${exactEntropy(createRandomBytes, API_KEY_ID_ENTROPY_BYTES).toString("base64url")}`,
  );
  const secret = exactEntropy(createRandomBytes, API_KEY_SECRET_ENTROPY_BYTES).toString(
    "base64url",
  );
  const apiKey = ProjectApiKeySchema.parse(`${API_KEY_VERSION}.${keyId}.${secret}`);
  return Object.freeze({ keyId, secret, apiKey });
}

export function parseProjectApiKey(apiKey: string): ParsedProjectApiKey {
  const parsed = ProjectApiKeySchema.parse(apiKey);
  const [, keyId, secret] = parsed.split(".");
  return Object.freeze({ keyId: ApiKeyIdSchema.parse(keyId), secret: secret! });
}

export function hashApiKeySecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encodeSecretHash(digest: Buffer): string {
  if (digest.length !== API_KEY_DIGEST_BYTES) {
    throw new Error("Credential digest has an invalid length");
  }
  return digest.toString("base64url");
}

export function decodeSecretHash(encoded: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    throw new Error("Stored credential digest is invalid");
  }
  const digest = Buffer.from(encoded, "base64url");
  if (digest.length !== API_KEY_DIGEST_BYTES || digest.toString("base64url") !== encoded) {
    throw new Error("Stored credential digest is invalid");
  }
  return digest;
}

export function compareSecretHashes(
  left: Buffer,
  right: Buffer,
  compare: DigestComparator = timingSafeEqual,
): boolean {
  if (left.length !== API_KEY_DIGEST_BYTES || right.length !== API_KEY_DIGEST_BYTES) {
    throw new Error("Credential digest has an invalid length");
  }
  return compare(left, right);
}
