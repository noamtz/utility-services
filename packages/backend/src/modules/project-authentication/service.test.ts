import { describe, expect, it, vi } from "vitest";

import type { InternalProject } from "../identity-control/projects/model.js";
import { encodeSecretHash, hashApiKeySecret } from "../identity-control/credentials/credential.js";
import { toCredentialItems } from "../identity-control/credentials/model.js";
import {
  CorruptCredentialRecordError,
  type CredentialRepository,
  type CredentialVerificationSnapshot,
} from "../identity-control/credentials/repository.js";
import { createProjectAuthenticationService } from "./service.js";

const timestamp = "2026-08-23T08:00:00.000Z";
const keyId = "key_0123456789abcdefghijkl";
const secret = "s".repeat(43);
const project: InternalProject = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  ownerId: "private-owner",
  name: "Auth project",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: timestamp,
  updatedAt: timestamp,
};
const records = toCredentialItems({
  internalProjectId: project.internalProjectId,
  publicProjectId: project.publicProjectId,
  keyId,
  secretHash: encodeSecretHash(hashApiKeySecret(secret)),
  createdAt: timestamp,
});
const snapshot: CredentialVerificationSnapshot = { ...records, project };

function repository(overrides: Partial<CredentialRepository> = {}): CredentialRepository {
  return {
    inspectProject: vi.fn().mockResolvedValue(project),
    inspectMetadata: vi.fn().mockResolvedValue(records.metadata),
    list: vi.fn().mockResolvedValue({ items: [] }),
    getLookup: vi.fn().mockResolvedValue(records.lookup),
    getVerificationSnapshot: vi.fn().mockResolvedValue(snapshot),
    issue: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(records.metadata),
    replace: vi.fn().mockResolvedValue(records.metadata),
    ...overrides,
  };
}

async function authError(repo: CredentialRepository, credential = { keyId, secret }) {
  try {
    await createProjectAuthenticationService({ repository: repo }).authenticate(credential);
  } catch (error) {
    return error;
  }
  throw new Error("Expected authentication to fail");
}

describe("project authentication service", () => {
  it("returns a frozen trusted context built only from the verified snapshot", async () => {
    const context = await createProjectAuthenticationService({
      repository: repository(),
    }).authenticate({
      keyId,
      secret,
    });
    expect(context).toEqual({
      internalProjectId: project.internalProjectId,
      publicProjectId: project.publicProjectId,
      keyId,
      enabledUtilities: ["file-management"],
      fileManagement: project.fileManagement,
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(JSON.stringify(context)).not.toMatch(/secret|owner|\"pk\"/);
  });

  it("uses a fixed-size dummy comparison for an unknown parseable key", async () => {
    const compare = vi.fn((left: Buffer, right: Buffer) => left.length + right.length === 0);
    const repo = repository({ getLookup: vi.fn().mockResolvedValue(undefined) });
    await expect(
      createProjectAuthenticationService({
        repository: repo,
        compareDigests: compare,
      }).authenticate({
        keyId,
        secret,
      }),
    ).rejects.toMatchObject({ statusCode: 401, code: "UNAUTHORIZED" });
    expect(compare).toHaveBeenCalledOnce();
    expect(compare.mock.calls[0]?.[0]).toHaveLength(32);
    expect(compare.mock.calls[0]?.[1]).toHaveLength(32);
  });

  it.each(["revoked", "replaced", "suspended"] as const)(
    "rejects %s lookup state without loading the snapshot",
    async (status) => {
      const getVerificationSnapshot = vi.fn();
      const lookup = {
        ...records.lookup,
        status,
        ...(status === "revoked" ? { revokedAt: timestamp } : {}),
        ...(status === "replaced"
          ? { replacedAt: timestamp, replacementKeyId: "key_0123456789abcdefghijkm" }
          : {}),
      };
      const error = await authError(
        repository({ getLookup: vi.fn().mockResolvedValue(lookup), getVerificationSnapshot }),
      );
      expect(error).toMatchObject({
        statusCode: 401,
        code: "UNAUTHORIZED",
        safeMessage: "Authentication required",
      });
      expect(getVerificationSnapshot).not.toHaveBeenCalled();
    },
  );

  it("rejects a wrong secret after the timing-safe comparison", async () => {
    const compare = vi.fn((left: Buffer, right: Buffer) => left.equals(right));
    await expect(
      createProjectAuthenticationService({
        repository: repository(),
        compareDigests: compare,
      }).authenticate({
        keyId,
        secret: "x".repeat(43),
      }),
    ).rejects.toMatchObject({ statusCode: 401, code: "UNAUTHORIZED" });
    expect(compare).toHaveBeenCalledOnce();
  });

  it("maps corrupt lookup and snapshot records to the same safe rejection", async () => {
    const lookupError = await authError(
      repository({ getLookup: vi.fn().mockRejectedValue(new CorruptCredentialRecordError()) }),
    );
    const snapshotError = await authError(
      repository({
        getVerificationSnapshot: vi.fn().mockRejectedValue(new CorruptCredentialRecordError()),
      }),
    );
    expect(lookupError).toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
      safeMessage: "Authentication required",
    });
    expect(snapshotError).toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
      safeMessage: "Authentication required",
    });
  });

  it("fails closed for missing, disabled, and mismatched snapshots", async () => {
    const cases: Array<CredentialVerificationSnapshot | undefined> = [
      undefined,
      { ...snapshot, project: { ...project, enabledUtilities: [] as never } },
      {
        ...snapshot,
        project: { ...project, internalProjectId: "22222222-2222-4222-8222-222222222222" },
      },
      { ...snapshot, metadata: { ...records.metadata, status: "suspended" } },
    ];
    const errors = await Promise.all(
      cases.map((value) =>
        authError(repository({ getVerificationSnapshot: vi.fn().mockResolvedValue(value) })),
      ),
    );
    expect(errors).toHaveLength(4);
    expect(errors.every((error) => (error as { statusCode?: number }).statusCode === 401)).toBe(
      true,
    );
  });

  it("does not convert infrastructure failures into credential details", async () => {
    const failure = new Error("infrastructure unavailable");
    await expect(
      createProjectAuthenticationService({
        repository: repository({ getLookup: vi.fn().mockRejectedValue(failure) }),
      }).authenticate({ keyId, secret }),
    ).rejects.toBe(failure);
  });
});
