/* eslint-disable @typescript-eslint/unbound-method -- typed Vitest service doubles */
import type { TrustedProjectContext } from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { createDownloadService, type PublicProjectReader } from "./downloads.js";
import {
  createPendingFile,
  parseFileItem,
  trashPurgeSortKey,
  TRASH_PURGE_INDEX_PARTITION,
  TRASH_RETENTION_MILLISECONDS,
  type FileItem,
} from "./model.js";
import type { DownloadPresigner } from "./presigning.js";
import type { FileRepository } from "./repository.js";

const timestamp = "2026-08-23T08:00:00.000Z";
const fileId = "fil_0123456789abcdefghijkl";
const publicFileId = "pfil_0123456789abcdefghijkl";
const otherPublicFileId = "pfil_abcdefghijkl0123456789";
const signedUrl = "https://bucket.example.com/key?X-Amz-Signature=synthetic";

const project: TrustedProjectContext = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  keyId: "key_0123456789abcdefghijkl",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
};

function pending(visibility: "private" | "public" = "private"): FileItem {
  return createPendingFile({
    internalProjectId: project.internalProjectId,
    publicProjectId: project.publicProjectId,
    fileId,
    ...(visibility === "public" ? { publicFileId } : {}),
    name: "file.txt",
    mediaType: "text/plain",
    sizeBytes: 12n,
    visibility,
    uploadExpiresAt: "2026-08-23T08:15:00.000Z",
    failureEligibleAt: "2026-08-23T09:15:00.000Z",
    createdAt: timestamp,
  });
}

function ready(visibility: "private" | "public" = "private"): FileItem {
  const source = pending(visibility);
  const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...base } = source;
  void _pendingPk;
  void _pendingSk;
  return parseFileItem({
    ...base,
    status: "ready",
    completionEvidence: {
      completedAt: timestamp,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    },
    readyAt: timestamp,
  });
}

function trashed(visibility: "private" | "public" = "private"): FileItem {
  const source = ready(visibility);
  const trashedAt = "2026-08-23T09:00:00.000Z";
  const purgeAt = new Date(
    new Date(trashedAt).getTime() + TRASH_RETENTION_MILLISECONDS,
  ).toISOString();
  return parseFileItem({
    ...source,
    status: "trashed",
    trashedAt,
    purgeAt,
    gsi2pk: TRASH_PURGE_INDEX_PARTITION,
    gsi2sk: trashPurgeSortKey(purgeAt, source.internalProjectId, source.fileId),
    updatedAt: trashedAt,
    revision: source.revision + 1n,
  });
}

function repository(overrides: Partial<FileRepository> = {}): FileRepository {
  return {
    get: vi.fn().mockResolvedValue(ready()),
    getPublic: vi.fn().mockResolvedValue(ready("public")),
    list: vi.fn().mockResolvedValue({ items: [] }),
    reservePending: vi.fn(),
    claimCompletion: vi.fn(),
    finalizeReady: vi.fn(),
    claimFailure: vi.fn(),
    completeFailureCleanup: vi.fn(),
    finalizeFailed: vi.fn(),
    listDuePending: vi.fn().mockResolvedValue({ items: [] }),
    trash: vi.fn(),
    restore: vi.fn(),
    claimPermanentRemoval: vi.fn(),
    recordObjectRemoved: vi.fn(),
    finalizePermanentRemoval: vi.fn(),
    listDuePurge: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  };
}

function projects(overrides: Partial<PublicProjectReader> = {}): PublicProjectReader {
  return {
    inspect: vi.fn().mockResolvedValue({
      internalProjectId: project.internalProjectId,
      publicProjectId: project.publicProjectId,
      status: "active",
      fileManagement: { downloadUrlLifetimeMinutes: 5 },
    }),
    ...overrides,
  };
}

function presigner(overrides: Partial<DownloadPresigner> = {}): DownloadPresigner {
  return {
    authorizeGet: vi.fn().mockResolvedValue({ url: signedUrl }),
    ...overrides,
  };
}

describe("download service", () => {
  it.each(["private", "public"] as const)(
    "authorizes an owned ready %s file through the authenticated path",
    async (visibility) => {
      const repo = repository({ get: vi.fn().mockResolvedValue(ready(visibility)) });
      const signer = presigner();
      const service = createDownloadService({
        repository: repo,
        projects: projects(),
        presigner: signer,
        now: () => new Date(timestamp),
      });

      await expect(service.authorizePrivate(project, fileId)).resolves.toMatchObject({
        file: { fileId, visibility, status: "ready" },
        download: {
          method: "GET",
          url: signedUrl,
          expiresAt: "2026-08-23T08:05:00.000Z",
        },
      });
      expect(repo.get).toHaveBeenCalledWith(project.internalProjectId, fileId);
      expect(signer.authorizeGet).toHaveBeenCalledWith({
        objectKey: ready(visibility).objectKey,
        expiresInSeconds: 300,
      });
    },
  );

  it.each([
    ["missing", undefined],
    ["pending", pending()],
    ["failed", { ...pending(), status: "failed" }],
    ["trashed", trashed()],
    ["cross project", { ...ready(), internalProjectId: "22222222-2222-4222-8222-222222222222" }],
  ])("denies a %s private lookup without signing", async (_name, item) => {
    const signer = presigner();
    const service = createDownloadService({
      repository: repository({ get: vi.fn().mockResolvedValue(item) }),
      projects: projects(),
      presigner: signer,
    });

    await expect(service.authorizePrivate(project, fileId)).rejects.toMatchObject({
      statusCode: 404,
      code: "FILE_NOT_FOUND",
    });
    expect(signer.authorizeGet).not.toHaveBeenCalled();
  });

  it("authorizes only the exact ready public pair linked to the current project", async () => {
    const repo = repository();
    const signer = presigner();
    const service = createDownloadService({
      repository: repo,
      projects: projects(),
      presigner: signer,
      now: () => new Date(timestamp),
    });

    await expect(service.authorizePublic(project.publicProjectId, publicFileId)).resolves.toBe(
      signedUrl,
    );
    expect(repo.getPublic).toHaveBeenCalledWith(project.publicProjectId, publicFileId);
    expect(signer.authorizeGet).toHaveBeenCalledWith({
      objectKey: ready("public").objectKey,
      expiresInSeconds: 300,
    });
  });

  it.each([
    ["missing file", undefined, undefined],
    ["pending file", pending("public"), undefined],
    ["failed file", { ...pending("public"), status: "failed" }, undefined],
    ["trashed file", trashed("public"), undefined],
    ["private file", ready(), undefined],
    ["wrong file pair", { ...ready("public"), publicFileId: otherPublicFileId }, undefined],
    ["missing project", ready("public"), null],
    [
      "mismatched project identity",
      ready("public"),
      {
        internalProjectId: "22222222-2222-4222-8222-222222222222",
        publicProjectId: project.publicProjectId,
        status: "active",
        fileManagement: { downloadUrlLifetimeMinutes: 5 },
      },
    ],
  ])("denies a %s public lookup without signing", async (_name, item, projectOverride) => {
    const signer = presigner();
    const projectReader =
      projectOverride === undefined
        ? projects()
        : projects({ inspect: vi.fn().mockResolvedValue(projectOverride ?? undefined) });
    const service = createDownloadService({
      repository: repository({ getPublic: vi.fn().mockResolvedValue(item) }),
      projects: projectReader,
      presigner: signer,
    });

    await expect(
      service.authorizePublic(project.publicProjectId, publicFileId),
    ).rejects.toMatchObject({ statusCode: 404, code: "FILE_NOT_FOUND" });
    expect(signer.authorizeGet).not.toHaveBeenCalled();
  });

  it.each([
    [1, "2026-08-23T08:01:00.000Z", 60],
    [5, "2026-08-23T08:05:00.000Z", 300],
    [60, "2026-08-23T09:00:00.000Z", 3_600],
  ])("uses the current %d minute project lifetime", async (minutes, expiresAt, seconds) => {
    const signer = presigner();
    const service = createDownloadService({
      repository: repository(),
      projects: projects({
        inspect: vi.fn().mockResolvedValue({
          internalProjectId: project.internalProjectId,
          publicProjectId: project.publicProjectId,
          status: "active",
          fileManagement: { downloadUrlLifetimeMinutes: minutes },
        }),
      }),
      presigner: signer,
      now: () => new Date(timestamp),
    });
    const privateResult = await service.authorizePrivate(
      {
        ...project,
        fileManagement: { ...project.fileManagement, downloadUrlLifetimeMinutes: minutes },
      },
      fileId,
    );
    await service.authorizePublic(project.publicProjectId, publicFileId);

    expect(privateResult.download.expiresAt).toBe(expiresAt);
    expect(signer.authorizeGet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expiresInSeconds: seconds,
      }),
    );
    expect(signer.authorizeGet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expiresInSeconds: seconds,
      }),
    );
  });

  it("creates a fresh authorization after the clock advances", async () => {
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date(timestamp))
      .mockReturnValueOnce(new Date("2026-08-23T08:06:00.000Z"));
    const signer = presigner({
      authorizeGet: vi
        .fn()
        .mockResolvedValueOnce({ url: `${signedUrl}&issued=1` })
        .mockResolvedValueOnce({ url: `${signedUrl}&issued=2` }),
    });
    const service = createDownloadService({
      repository: repository(),
      projects: projects(),
      presigner: signer,
      now: clock,
    });

    const first = await service.authorizePrivate(project, fileId);
    const second = await service.authorizePrivate(project, fileId);
    expect(first.download).toMatchObject({
      url: `${signedUrl}&issued=1`,
      expiresAt: "2026-08-23T08:05:00.000Z",
    });
    expect(second.download).toMatchObject({
      url: `${signedUrl}&issued=2`,
      expiresAt: "2026-08-23T08:11:00.000Z",
    });
    expect(signer.authorizeGet).toHaveBeenCalledTimes(2);
  });

  it("denies a suspended project before public file lookup or signing", async () => {
    const repo = repository();
    const signer = presigner();
    const service = createDownloadService({
      repository: repo,
      projects: projects({
        inspect: vi.fn().mockResolvedValue({
          internalProjectId: project.internalProjectId,
          publicProjectId: project.publicProjectId,
          status: "suspended",
          fileManagement: { downloadUrlLifetimeMinutes: 5 },
        }),
      }),
      presigner: signer,
    });

    await expect(
      service.authorizePublic(project.publicProjectId, publicFileId),
    ).rejects.toMatchObject({ statusCode: 404, code: "FILE_NOT_FOUND" });
    expect(repo.getPublic).not.toHaveBeenCalled();
    expect(signer.authorizeGet).not.toHaveBeenCalled();
  });

  it("propagates signer failures without returning a capability", async () => {
    const failure = new Error("signer unavailable");
    const service = createDownloadService({
      repository: repository(),
      projects: projects(),
      presigner: presigner({ authorizeGet: vi.fn().mockRejectedValue(failure) }),
    });
    await expect(service.authorizePrivate(project, fileId)).rejects.toBe(failure);
    await expect(service.authorizePublic(project.publicProjectId, publicFileId)).rejects.toBe(
      failure,
    );
  });
});
