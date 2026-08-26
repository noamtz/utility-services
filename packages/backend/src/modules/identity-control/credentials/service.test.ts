import { ApiKeyListQuerySchema } from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import type { OwnerContext } from "../auth/owner-context.js";
import type { InternalProject } from "../projects/model.js";
import { DUMMY_SECRET_HASH, type GeneratedProjectApiKey } from "./credential.js";
import { toCredentialItems } from "./model.js";
import {
  CredentialCollisionError,
  CredentialStateConflictError,
  type CredentialRepository,
} from "./repository.js";
import { createCredentialService } from "./service.js";

const timestamp = "2026-08-23T08:00:00.000Z";
const ownerA: OwnerContext = { ownerId: "owner-a" };
const ownerB: OwnerContext = { ownerId: "owner-b" };
const project: InternalProject = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  ownerId: ownerA.ownerId,
  name: "Credential project",
  status: "active",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: timestamp,
  updatedAt: timestamp,
};

function generated(suffix = "l"): GeneratedProjectApiKey {
  const keyId = `key_0123456789abcdefghijk${suffix}`;
  const secret = "s".repeat(43);
  return Object.freeze({ keyId, secret, apiKey: `rus_v1.${keyId}.${secret}` });
}

const stored = toCredentialItems({
  internalProjectId: project.internalProjectId,
  publicProjectId: project.publicProjectId,
  keyId: generated().keyId,
  secretHash: DUMMY_SECRET_HASH,
  createdAt: timestamp,
});

function repository(overrides: Partial<CredentialRepository> = {}): CredentialRepository {
  return {
    inspectProject: vi.fn().mockResolvedValue(project),
    inspectMetadata: vi.fn().mockResolvedValue(stored.metadata),
    list: vi.fn().mockResolvedValue({ items: [] }),
    getLookup: vi.fn().mockResolvedValue(undefined),
    getVerificationSnapshot: vi.fn().mockResolvedValue(undefined),
    issue: vi.fn().mockResolvedValue(undefined),
    revoke: vi
      .fn()
      .mockImplementation((item) =>
        Promise.resolve({ ...item, status: "revoked", revokedAt: timestamp }),
      ),
    replace: vi.fn().mockResolvedValue({ ...stored.metadata, status: "replaced" }),
    setOperationalStatus: vi.fn().mockResolvedValue(stored.metadata),
    ...overrides,
  };
}

function service(repo: CredentialRepository, generateCredential = () => generated()) {
  return createCredentialService({
    repository: repo,
    generateCredential,
    now: () => new Date(timestamp),
    collisionAttempts: 2,
  });
}

describe("credential lifecycle service", () => {
  it("issues a hash-only stored pair and returns plaintext once", async () => {
    const issue = vi.fn().mockResolvedValue(undefined);
    const repo = repository({ issue });
    const result = await service(repo).issue(ownerA, project.publicProjectId);

    expect(result.apiKey).toBe(generated().apiKey);
    expect(issue).toHaveBeenCalledOnce();
    const [, metadata, lookup] = issue.mock.calls[0] as Parameters<CredentialRepository["issue"]>;
    expect(metadata).not.toHaveProperty("secretHash");
    expect(lookup.secretHash).toHaveLength(43);
    expect(JSON.stringify([metadata, lookup])).not.toContain(generated().secret);
    expect(result.metadata).not.toHaveProperty("secretHash");
  });

  it("supports multiple active issuance and bounded confirmed-collision retries", async () => {
    const issue = vi
      .fn()
      .mockRejectedValueOnce(new CredentialCollisionError())
      .mockResolvedValue(undefined);
    const generator = vi
      .fn()
      .mockReturnValueOnce(generated("l"))
      .mockReturnValueOnce(generated("m"));
    const result = await service(repository({ issue }), generator).issue(
      ownerA,
      project.publicProjectId,
    );
    expect(result.metadata.keyId).toBe(generated("m").keyId);
    expect(generator).toHaveBeenCalledTimes(2);
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it("maps exhausted collisions and project-state failures safely", async () => {
    await expect(
      service(
        repository({ issue: vi.fn().mockRejectedValue(new CredentialCollisionError()) }),
      ).issue(ownerA, project.publicProjectId),
    ).rejects.toMatchObject({ statusCode: 500, code: "INTERNAL_ERROR" });
    await expect(
      service(
        repository({ issue: vi.fn().mockRejectedValue(new CredentialStateConflictError()) }),
      ).issue(ownerA, project.publicProjectId),
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });

  it("lists metadata with opaque cursors and no private fields", async () => {
    const list = vi.fn().mockResolvedValue({
      items: [stored.metadata],
      nextCursor: { keyId: stored.metadata.keyId },
    });
    const result = await service(repository({ list })).list(
      ownerA,
      project.publicProjectId,
      ApiKeyListQuerySchema.parse({}),
    );
    expect(result.items).toEqual([
      {
        keyId: stored.metadata.keyId,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    expect(result.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(result)).not.toMatch(/secret|internalProjectId|ownerId|PROJECT#/);
  });

  it("reconstructs list scope from the owned project and rejects malformed cursors", async () => {
    const list = vi.fn().mockResolvedValue({ items: [] });
    const lifecycle = service(repository({ list }));
    await expect(
      lifecycle.list(
        ownerA,
        project.publicProjectId,
        ApiKeyListQuerySchema.parse({ cursor: "e30" }),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    expect(list).not.toHaveBeenCalled();
  });

  it("returns identical not-found behavior for missing and wrong-owner projects", async () => {
    const missing = service(repository({ inspectProject: vi.fn().mockResolvedValue(undefined) }));
    const wrongOwner = service(
      repository({
        inspectProject: vi.fn().mockResolvedValue({ ...project, ownerId: ownerB.ownerId }),
      }),
    );
    for (const lifecycle of [missing, wrongOwner]) {
      await expect(lifecycle.issue(ownerA, project.publicProjectId)).rejects.toMatchObject({
        statusCode: 404,
        code: "NOT_FOUND",
        safeMessage: "Project not found",
      });
    }
  });

  it("revokes idempotently and recovers a terminal concurrent transition", async () => {
    const terminal = { ...stored.metadata, status: "revoked" as const, revokedAt: timestamp };
    const inspectMetadata = vi
      .fn()
      .mockResolvedValueOnce(stored.metadata)
      .mockResolvedValueOnce(terminal);
    const revoke = vi.fn().mockRejectedValue(new CredentialStateConflictError());
    const result = await service(repository({ inspectMetadata, revoke })).revoke(
      ownerA,
      project.publicProjectId,
      stored.metadata.keyId,
    );
    expect(result.metadata.status).toBe("revoked");
    expect(result).not.toHaveProperty("apiKey");
  });

  it("atomically replaces only active or suspended targets and returns the new secret", async () => {
    const replace = vi.fn().mockResolvedValue({ ...stored.metadata, status: "replaced" });
    const result = await service(repository({ replace }), () => generated("m")).replace(
      ownerA,
      project.publicProjectId,
      stored.metadata.keyId,
    );
    expect(replace).toHaveBeenCalledOnce();
    expect(result.apiKey).toBe(generated("m").apiKey);
    expect(result.metadata.keyId).toBe(generated("m").keyId);

    const revoked = { ...stored.metadata, status: "revoked" as const, revokedAt: timestamp };
    await expect(
      service(repository({ inspectMetadata: vi.fn().mockResolvedValue(revoked) })).replace(
        ownerA,
        project.publicProjectId,
        stored.metadata.keyId,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });

  it("does not use global lookup to reveal another project's key", async () => {
    const getLookup = vi.fn();
    await expect(
      service(
        repository({ inspectMetadata: vi.fn().mockResolvedValue(undefined), getLookup }),
      ).revoke(ownerA, project.publicProjectId, stored.metadata.keyId),
    ).rejects.toMatchObject({ statusCode: 404, safeMessage: "API key not found" });
    expect(getLookup).not.toHaveBeenCalled();
  });
});
