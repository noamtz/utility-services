import { describe, expect, it } from "vitest";

import { DUMMY_SECRET_HASH } from "./credential.js";
import {
  apiKeyLookupPartitionKey,
  assertCredentialRecordsMatch,
  parseApiKeyLookupItem,
  parseProjectApiKeyMetadataItem,
  projectApiKeySortKey,
  toApiKeyMetadata,
  toCredentialItems,
  withReplacedStatus,
  withRevokedStatus,
  withCredentialOperationalStatus,
} from "./model.js";

const createdAt = "2026-08-23T08:00:00.000Z";
const project = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  keyId: "key_0123456789abcdefghijkl",
  secretHash: DUMMY_SECRET_HASH,
  createdAt,
};

describe("credential stored model", () => {
  it("creates canonical dual records with the digest only in lookup", () => {
    const records = toCredentialItems(project);
    expect(records.metadata.pk).toBe(`PROJECT#${project.publicProjectId}`);
    expect(records.metadata.sk).toBe(`API_KEY#${project.keyId}`);
    expect(records.lookup.pk).toBe(`API_KEY#${project.keyId}`);
    expect(records.lookup.sk).toBe("LOOKUP");
    expect(records.lookup.secretHash).toBe(DUMMY_SECRET_HASH);
    expect(records.metadata).not.toHaveProperty("secretHash");
    expect(JSON.stringify(records)).not.toContain("apiKey");
    expect(JSON.stringify(records)).not.toContain('secret"');
  });

  it("centralizes and validates canonical keys", () => {
    expect(projectApiKeySortKey(project.keyId)).toBe(`API_KEY#${project.keyId}`);
    expect(apiKeyLookupPartitionKey(project.keyId)).toBe(`API_KEY#${project.keyId}`);
    const records = toCredentialItems(project);
    expect(() =>
      parseProjectApiKeyMetadataItem({ ...records.metadata, sk: "API_KEY#other" }),
    ).toThrow("Credential metadata keys are inconsistent");
    expect(() => parseApiKeyLookupItem({ ...records.lookup, pk: "API_KEY#other" })).toThrow(
      "Credential lookup keys are inconsistent",
    );
  });

  it("enforces status-specific lifecycle timestamps", () => {
    const { metadata, lookup } = toCredentialItems(project);
    const revokedMetadata = withRevokedStatus(metadata, createdAt);
    const revokedLookup = withRevokedStatus(lookup, createdAt);
    expect(assertCredentialRecordsMatch(revokedMetadata, revokedLookup).metadata.status).toBe(
      "revoked",
    );
    const replacement = "key_0123456789abcdefghijkm";
    expect(
      assertCredentialRecordsMatch(
        withReplacedStatus(metadata, createdAt, replacement),
        withReplacedStatus(lookup, createdAt, replacement),
      ).metadata.status,
    ).toBe("replaced");
    expect(() =>
      parseProjectApiKeyMetadataItem({ ...metadata, status: "revoked", revokedAt: undefined }),
    ).toThrow("Credential lifecycle fields are inconsistent");
  });

  it("rejects plaintext, invalid lifecycle combinations, and cross-record mismatches", () => {
    const { metadata, lookup } = toCredentialItems(project);
    expect(() => parseProjectApiKeyMetadataItem({ ...metadata, apiKey: "private" })).toThrow();
    expect(() => parseApiKeyLookupItem({ ...lookup, secret: "private" })).toThrow();
    expect(() =>
      parseProjectApiKeyMetadataItem({ ...metadata, status: "replaced", replacedAt: createdAt }),
    ).toThrow("Credential lifecycle fields are inconsistent");
    expect(() =>
      assertCredentialRecordsMatch(metadata, { ...lookup, status: "suspended" }),
    ).toThrow("Credential records are inconsistent");
  });

  it("projects only public lifecycle metadata", () => {
    const { metadata } = toCredentialItems(project);
    expect(toApiKeyMetadata(metadata)).toEqual({
      keyId: project.keyId,
      status: "active",
      createdAt,
      updatedAt: createdAt,
    });
    expect(JSON.stringify(toApiKeyMetadata(metadata))).not.toMatch(
      /internalProjectId|publicProjectId|pk|secret/,
    );
  });

  it("transitions only reversible credential operational states", () => {
    const { metadata } = toCredentialItems(project);
    const suspended = withCredentialOperationalStatus(metadata, "suspended", createdAt);
    expect(suspended.status).toBe("suspended");
    expect(withCredentialOperationalStatus(suspended, "active", createdAt).status).toBe("active");
    expect(() =>
      withCredentialOperationalStatus(
        { ...metadata, status: "revoked", revokedAt: createdAt },
        "active",
        createdAt,
      ),
    ).toThrow("Terminal credential state cannot be changed");
  });
});
