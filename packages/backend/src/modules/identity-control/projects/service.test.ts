import { CreateProjectRequestSchema, ProjectListQuerySchema } from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../../core/http/handler.js";
import { toProjectMetadataItem, type InternalProject } from "./model.js";
import {
  ProjectCollisionError,
  type ListProjectsInput,
  type ProjectRepository,
} from "./repository.js";
import { createProjectService } from "./service.js";

const ownerA = { ownerId: "owner-a" } as const;
const ownerB = { ownerId: "owner-b" } as const;
const timestamp = "2026-08-23T08:00:00.000Z";

function ids(suffix = "0") {
  return {
    internalProjectId: `11111111-1111-4111-8111-11111111111${suffix}`,
    publicProjectId: `prj_0123456789abcdefghijk${suffix}`,
  };
}

function project(ownerId: string, suffix = "0"): InternalProject {
  return {
    ...ids(suffix),
    ownerId,
    name: `Project ${suffix}`,
    enabledUtilities: ["file-management"],
    fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function repository(overrides: Partial<ProjectRepository> = {}): ProjectRepository {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ items: [] }),
    inspect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("project service", () => {
  it("creates a server-identified project with parsed defaults and no internal fields", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const repo = repository({ create });
    const service = createProjectService({
      repository: repo,
      generateIds: () => ids(),
      now: () => new Date(timestamp),
    });
    const request = CreateProjectRequestSchema.parse({
      name: "  My project  ",
      enabledUtilities: ["file-management"],
    });

    const result = await service.create(ownerA, request);

    expect(create).toHaveBeenCalledWith({ ...project("owner-a"), name: "My project" });
    expect(result).toEqual({
      projectId: ids().publicProjectId,
      name: "My project",
      enabledUtilities: ["file-management"],
      fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(result).not.toHaveProperty("ownerId");
    expect(result).not.toHaveProperty("internalProjectId");
  });

  it("preserves independent lifetime boundary values", async () => {
    const service = createProjectService({
      repository: repository(),
      generateIds: () => ids(),
      now: () => new Date(timestamp),
    });
    const request = CreateProjectRequestSchema.parse({
      name: "Boundaries",
      enabledUtilities: ["file-management"],
      fileManagement: { uploadUrlLifetimeMinutes: 1, downloadUrlLifetimeMinutes: 60 },
    });

    await expect(service.create(ownerA, request)).resolves.toMatchObject({
      fileManagement: { uploadUrlLifetimeMinutes: 1, downloadUrlLifetimeMinutes: 60 },
    });
  });

  it("retries public-ID collisions up to a bounded limit", async () => {
    const repo = repository({
      create: vi
        .fn()
        .mockRejectedValueOnce(new ProjectCollisionError())
        .mockResolvedValueOnce(undefined),
    });
    const generateIds = vi.fn().mockReturnValueOnce(ids("0")).mockReturnValueOnce(ids("1"));
    const service = createProjectService({
      repository: repo,
      generateIds,
      now: () => new Date(timestamp),
      collisionAttempts: 2,
    });

    await expect(
      service.create(
        ownerA,
        CreateProjectRequestSchema.parse({ name: "Retry", enabledUtilities: ["file-management"] }),
      ),
    ).resolves.toMatchObject({ projectId: ids("1").publicProjectId });
    expect(generateIds).toHaveBeenCalledTimes(2);
  });

  it("maps exhausted collisions to a safe internal error", async () => {
    const repo = repository({ create: vi.fn().mockRejectedValue(new ProjectCollisionError()) });
    const service = createProjectService({
      repository: repo,
      generateIds: () => ids(),
      now: () => new Date(timestamp),
      collisionAttempts: 2,
    });

    await expect(
      service.create(
        ownerA,
        CreateProjectRequestSchema.parse({ name: "Retry", enabledUtilities: ["file-management"] }),
      ),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: "INTERNAL_ERROR",
      safeMessage: "An unexpected error occurred",
    });
  });

  it("lists only the trusted owner and returns summary cursors", async () => {
    const metadata = toProjectMetadataItem(project("owner-a"));
    const list = vi.fn().mockResolvedValue({
      items: [metadata],
      nextCursor: { projectId: metadata.publicProjectId, createdAt: metadata.createdAt },
    });
    const service = createProjectService({ repository: repository({ list }) });

    const result = await service.list(ownerA, ProjectListQuerySchema.parse({ limit: "20" }));

    expect(list).toHaveBeenCalledWith({ ownerId: "owner-a", limit: 20 });
    expect(result.items[0]).not.toHaveProperty("ownerId");
    expect(result.items[0]).not.toHaveProperty("internalProjectId");
    expect(result.items[0]).not.toHaveProperty("fileManagement");
    expect(result.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("decodes a cursor but reconstructs owner scope through the repository input", async () => {
    const list = vi.fn().mockResolvedValue({ items: [] });
    const service = createProjectService({ repository: repository({ list }) });
    const firstResult = await createProjectService({
      repository: repository({
        list: vi.fn().mockResolvedValue({
          items: [],
          nextCursor: { projectId: ids().publicProjectId, createdAt: timestamp },
        }),
      }),
    }).list(ownerA, ProjectListQuerySchema.parse({}));

    await service.list(ownerB, ProjectListQuerySchema.parse({ cursor: firstResult.nextCursor }));

    const input = list.mock.calls[0]?.[0] as ListProjectsInput;
    expect(input.ownerId).toBe("owner-b");
    expect(input.startAfter).toEqual({ projectId: ids().publicProjectId, createdAt: timestamp });
  });

  it("maps malformed opaque cursor contents to a safe validation error", async () => {
    const service = createProjectService({ repository: repository() });

    await expect(
      service.list(ownerA, ProjectListQuerySchema.parse({ cursor: "e30" })),
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
  });

  it("returns identical not-found errors for missing and wrong-owner projects", async () => {
    const missingService = createProjectService({ repository: repository() });
    const wrongOwnerService = createProjectService({
      repository: repository({ inspect: vi.fn().mockResolvedValue(project("owner-b")) }),
    });

    const errors: HttpError[] = [];
    for (const service of [missingService, wrongOwnerService]) {
      try {
        await service.inspect(ownerA, ids().publicProjectId);
      } catch (error) {
        errors.push(error as HttpError);
      }
    }

    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
      safeMessage: "Project not found",
    });
    expect(errors[1]).toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
      safeMessage: "Project not found",
    });
  });

  it("returns the public detail for an owned project", async () => {
    const service = createProjectService({
      repository: repository({ inspect: vi.fn().mockResolvedValue(project("owner-a")) }),
    });

    const result = await service.inspect(ownerA, ids().publicProjectId);

    expect(result.projectId).toBe(ids().publicProjectId);
    expect(JSON.stringify(result)).not.toContain("owner-a");
    expect(JSON.stringify(result)).not.toContain("11111111");
  });
});
