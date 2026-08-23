import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  API_KEY_DIGEST_BYTES,
  API_KEY_ID_ENTROPY_BYTES,
  API_KEY_SECRET_ENTROPY_BYTES,
  DUMMY_SECRET_HASH,
  compareSecretHashes,
  decodeSecretHash,
  encodeSecretHash,
  generateProjectApiKey,
  hashApiKeySecret,
  parseProjectApiKey,
} from "./credential.js";

describe("project credential primitive", () => {
  it("uses independent exact-length entropy and round-trips the versioned shape", () => {
    const entropy = vi
      .fn()
      .mockReturnValueOnce(Buffer.alloc(API_KEY_ID_ENTROPY_BYTES, 1))
      .mockReturnValueOnce(Buffer.alloc(API_KEY_SECRET_ENTROPY_BYTES, 2));

    const generated = generateProjectApiKey(entropy);

    expect(entropy.mock.calls).toEqual([[16], [32]]);
    expect(generated.apiKey).toMatch(/^rus_v1\.key_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(parseProjectApiKey(generated.apiKey)).toEqual({
      keyId: generated.keyId,
      secret: generated.secret,
    });
    expect(Object.isFrozen(generated)).toBe(true);
  });

  it.each([15, 17, 31, 33])(
    "rejects entropy output length %i without value-bearing errors",
    (size) => {
      const errorFactory = (requested: number) => Buffer.alloc(requested === 16 ? size : 32);
      expect(() => generateProjectApiKey(errorFactory)).toThrow(
        "Credential entropy source returned an invalid length",
      );
    },
  );

  it("hashes with SHA-256 and uses a canonical fixed-size encoding", () => {
    const digest = hashApiKeySecret("known-secret");
    expect(digest.toString("hex")).toBe(createHash("sha256").update("known-secret").digest("hex"));
    const encoded = encodeSecretHash(digest);
    expect(encoded).toHaveLength(43);
    expect(decodeSecretHash(encoded)).toEqual(digest);
    expect(decodeSecretHash(DUMMY_SECRET_HASH)).toHaveLength(API_KEY_DIGEST_BYTES);
  });

  it("compares only fixed-size digests through the injected timing-safe seam", () => {
    const comparator = vi.fn((left: Buffer, right: Buffer) => left.equals(right));
    const equal = Buffer.alloc(32, 1);
    const different = Buffer.alloc(32, 2);
    expect(compareSecretHashes(equal, Buffer.from(equal), comparator)).toBe(true);
    expect(compareSecretHashes(equal, different, comparator)).toBe(false);
    expect(comparator).toHaveBeenCalledTimes(2);
    expect(() => compareSecretHashes(Buffer.alloc(31), equal, comparator)).toThrow(
      "Credential digest has an invalid length",
    );
    expect(comparator).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed credentials and digest encodings without echoing values", () => {
    expect(() => parseProjectApiKey("not-a-key")).toThrow("API key is invalid");
    expect(() => decodeSecretHash("not-a-hash")).toThrow("Stored credential digest is invalid");
    expect(() => encodeSecretHash(Buffer.alloc(31))).toThrow(
      "Credential digest has an invalid length",
    );
  });
});
