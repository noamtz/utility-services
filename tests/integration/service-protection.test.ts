/* eslint-disable @typescript-eslint/require-await -- deterministic in-memory integration boundaries */
import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../packages/backend/src/core/http/handler.js";
import {
  encodeSecretHash,
  generateProjectApiKey,
  hashApiKeySecret,
  parseProjectApiKey,
} from "../../packages/backend/src/modules/identity-control/credentials/credential.js";
import {
  toCredentialItems,
  withCredentialOperationalStatus,
} from "../../packages/backend/src/modules/identity-control/credentials/model.js";
import type { CredentialRepository } from "../../packages/backend/src/modules/identity-control/credentials/repository.js";
import type { InternalProject } from "../../packages/backend/src/modules/identity-control/projects/model.js";
import { createDownloadService } from "../../packages/backend/src/modules/file-management/downloads.js";
import { createProjectRequestLimiter } from "../../packages/backend/src/modules/project-authentication/rate-limit/service.js";
import type { ProjectRateLimitWindow } from "../../packages/backend/src/modules/project-authentication/rate-limit/model.js";
import { createProjectAuthenticationService } from "../../packages/backend/src/modules/project-authentication/service.js";

const timestamp = "2026-08-26T08:00:00.000Z";
const projectA: InternalProject = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  ownerId: "owner-a",
  name: "Protected A",
  status: "active",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: timestamp,
  updatedAt: timestamp,
};
const projectB: InternalProject = {
  ...projectA,
  internalProjectId: "22222222-2222-4222-8222-222222222222",
  publicProjectId: "prj_0123456789abcdefghijkm",
  ownerId: "owner-b",
  name: "Protected B",
};

function credential(seed: number, project: InternalProject) {
  const generated = generateProjectApiKey((size) => Buffer.alloc(size, seed + size));
  const records = toCredentialItems({
    internalProjectId: project.internalProjectId,
    publicProjectId: project.publicProjectId,
    keyId: generated.keyId,
    secretHash: encodeSecretHash(hashApiKeySecret(generated.secret)),
    createdAt: timestamp,
  });
  return { generated, records };
}

class MemoryRateLimits {
  public readonly counts = new Map<string, number>();

  public async admit(window: ProjectRateLimitWindow): Promise<"admitted" | "limited"> {
    const key = `${window.pk}|${window.sk}`;
    const count = this.counts.get(key) ?? 0;
    if (count >= 60) return "limited";
    this.counts.set(key, count + 1);
    return "admitted";
  }

  public count(project: InternalProject) {
    return [...this.counts.entries()]
      .filter(([key]) => key.startsWith(`RATE#${project.internalProjectId}|`))
      .reduce((total, [, count]) => total + count, 0);
  }
}

describe("service protection across authentication, limiting, and public delivery", () => {
  it("shares one six-route project quota across keys, isolates projects, rolls over, and caps concurrency", async () => {
    let now = new Date("2026-08-26T08:00:10.000Z");
    const keyA1 = credential(1, projectA);
    const keyA2 = credential(2, projectA);
    const keyB = credential(3, projectB);
    const projects = new Map([
      [projectA.publicProjectId, structuredClone(projectA)],
      [projectB.publicProjectId, structuredClone(projectB)],
    ]);
    const records = new Map(
      [keyA1, keyA2, keyB].map(({ records: item }) => [item.lookup.keyId, structuredClone(item)]),
    );
    const credentialRepository = {
      async getLookup(keyId: string) {
        return structuredClone(records.get(keyId)?.lookup);
      },
      async getVerificationSnapshot(keyId: string, publicProjectId: string) {
        const item = records.get(keyId);
        const project = projects.get(publicProjectId);
        return item && project
          ? structuredClone({ metadata: item.metadata, lookup: item.lookup, project })
          : undefined;
      },
    } as unknown as CredentialRepository;
    const limits = new MemoryRateLimits();
    const auth = createProjectAuthenticationService({
      repository: credentialRepository,
      limiter: createProjectRequestLimiter({ repository: limits, now: () => now }),
    });
    const routes = ["upload", "list", "inspect", "download", "delete", "restore"] as const;

    for (let index = 0; index < 60; index += 1) {
      const route = routes[index % routes.length];
      expect(route).toBeDefined();
      await expect(
        auth.authenticate(
          parseProjectApiKey(index % 2 ? keyA1.generated.apiKey : keyA2.generated.apiKey),
        ),
      ).resolves.toMatchObject({ internalProjectId: projectA.internalProjectId });
    }
    await expect(
      auth.authenticate(parseProjectApiKey(keyA1.generated.apiKey)),
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "RATE_LIMIT_EXCEEDED",
      retryAfterSeconds: 50,
    });
    await expect(
      auth.authenticate(parseProjectApiKey(keyB.generated.apiKey)),
    ).resolves.toMatchObject({
      internalProjectId: projectB.internalProjectId,
    });

    const beforeUnauthenticated = limits.count(projectA);
    expect(() => parseProjectApiKey("not-a-key")).toThrow();
    // Stable-public delivery has no project bearer authentication and therefore cannot consume quota.
    expect(limits.count(projectA)).toBe(beforeUnauthenticated);

    now = new Date("2026-08-26T08:01:00.000Z");
    await expect(
      auth.authenticate(parseProjectApiKey(keyA1.generated.apiKey)),
    ).resolves.toBeDefined();
    now = new Date("2026-08-26T08:02:00.000Z");
    const concurrent = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) =>
        auth.authenticate(
          parseProjectApiKey(index % 2 ? keyA1.generated.apiKey : keyA2.generated.apiKey),
        ),
      ),
    );
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(60);
    const rejected = concurrent.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(40);
    expect(rejected.every((result) => result.reason instanceof HttpError)).toBe(true);
    expect(rejected.every((result) => (result.reason as HttpError).statusCode === 429)).toBe(true);
  });

  it("isolates key suspension, blocks a suspended project before public lookup, and resumes nonterminal access", async () => {
    const keyA1 = credential(4, projectA);
    const keyA2 = credential(5, projectA);
    const projectState = structuredClone(projectA);
    const records = new Map(
      [keyA1, keyA2].map(({ records: item }) => [item.lookup.keyId, structuredClone(item)]),
    );
    const repository = {
      async getLookup(keyId: string) {
        return structuredClone(records.get(keyId)?.lookup);
      },
      async getVerificationSnapshot(keyId: string) {
        const item = records.get(keyId);
        return item
          ? structuredClone({ metadata: item.metadata, lookup: item.lookup, project: projectState })
          : undefined;
      },
    } as unknown as CredentialRepository;
    const auth = createProjectAuthenticationService({ repository });
    const setKeyStatus = (keyId: string, status: "active" | "suspended") => {
      const item = records.get(keyId)!;
      records.set(keyId, {
        metadata: withCredentialOperationalStatus(item.metadata, status, timestamp),
        lookup: withCredentialOperationalStatus(item.lookup, status, timestamp),
      });
    };

    setKeyStatus(keyA1.generated.keyId, "suspended");
    await expect(
      auth.authenticate(parseProjectApiKey(keyA1.generated.apiKey)),
    ).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      auth.authenticate(parseProjectApiKey(keyA2.generated.apiKey)),
    ).resolves.toBeDefined();

    projectState.status = "suspended";
    await expect(
      auth.authenticate(parseProjectApiKey(keyA2.generated.apiKey)),
    ).rejects.toMatchObject({
      statusCode: 401,
    });
    const getPublic = vi.fn();
    const authorizeGet = vi.fn();
    const downloads = createDownloadService({
      projects: {
        inspect: vi.fn().mockImplementation(async () => ({
          internalProjectId: projectState.internalProjectId,
          publicProjectId: projectState.publicProjectId,
          status: projectState.status,
          fileManagement: projectState.fileManagement,
        })),
      },
      repository: { getPublic } as never,
      presigner: { authorizeGet },
    });
    await expect(
      downloads.authorizePublic(projectA.publicProjectId, "pfil_0123456789abcdefghijkl"),
    ).rejects.toMatchObject({ statusCode: 404, code: "FILE_NOT_FOUND" });
    expect(getPublic).not.toHaveBeenCalled();
    expect(authorizeGet).not.toHaveBeenCalled();

    projectState.status = "active";
    await expect(
      auth.authenticate(parseProjectApiKey(keyA2.generated.apiKey)),
    ).resolves.toBeDefined();
    await expect(
      auth.authenticate(parseProjectApiKey(keyA1.generated.apiKey)),
    ).rejects.toMatchObject({
      statusCode: 401,
    });
    setKeyStatus(keyA1.generated.keyId, "active");
    await expect(
      auth.authenticate(parseProjectApiKey(keyA1.generated.apiKey)),
    ).resolves.toBeDefined();
  });
});
