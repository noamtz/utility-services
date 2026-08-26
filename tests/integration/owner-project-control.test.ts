import {
  ErrorEnvelopeSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
} from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createCreateProjectHandler,
  createInspectProjectHandler,
  createListProjectsHandler,
} from "../../packages/backend/src/modules/identity-control/projects/handlers.js";
import {
  toProjectMetadataItem,
  type InternalProject,
} from "../../packages/backend/src/modules/identity-control/projects/model.js";
import type {
  ListProjectsInput,
  ProjectRepository,
} from "../../packages/backend/src/modules/identity-control/projects/repository.js";
import { createProjectService } from "../../packages/backend/src/modules/identity-control/projects/service.js";

const ownerA = "owner-a-private-subject";
const ownerB = "owner-b-private-subject";
const bearer = "private-bearer-material";

function event(ownerId: string | undefined, overrides: Record<string, unknown> = {}): unknown {
  const authorizer = ownerId
    ? { jwt: { claims: { sub: ownerId, token_use: "access", email: "private@example.com" } } }
    : undefined;
  return {
    version: "2.0",
    requestContext: {
      requestId: "integration-request",
      http: { method: "GET", path: "/v1/control/projects" },
      ...(authorizer ? { authorizer } : {}),
    },
    headers: { authorization: `Bearer ${bearer}` },
    ...overrides,
  };
}

function parsed(response: { body?: string | undefined }): unknown {
  return JSON.parse(response.body ?? "null") as unknown;
}

function createMemoryRepository(): ProjectRepository {
  const projects = new Map<string, InternalProject>();
  return {
    create(project) {
      if (projects.has(project.publicProjectId)) throw new Error("test ID collision");
      projects.set(project.publicProjectId, structuredClone(project));
      return Promise.resolve();
    },
    list(input: ListProjectsInput) {
      const owned = [...projects.values()]
        .filter((project) => project.ownerId === input.ownerId)
        .sort((left, right) => right.publicProjectId.localeCompare(left.publicProjectId));
      const start = input.startAfter
        ? owned.findIndex((project) => project.publicProjectId === input.startAfter?.projectId) + 1
        : 0;
      const page = owned.slice(start, start + input.limit);
      const last = page.at(-1);
      return Promise.resolve({
        items: page.map(toProjectMetadataItem),
        ...(start + page.length < owned.length && last
          ? {
              nextCursor: {
                projectId: last.publicProjectId,
                createdAt: last.createdAt,
              },
            }
          : {}),
      });
    },
    inspect(publicProjectId) {
      const project = projects.get(publicProjectId);
      return Promise.resolve(project ? structuredClone(project) : undefined);
    },
    setOperationalStatus(publicProjectId, expectedStatus, nextStatus, changedAt) {
      const project = projects.get(publicProjectId);
      if (!project || project.status !== expectedStatus) throw new Error("test state conflict");
      projects.set(publicProjectId, {
        ...project,
        status: nextStatus,
        updatedAt: changedAt,
      });
      return Promise.resolve();
    },
  };
}

function assembled() {
  let sequence = 0;
  const repository = createMemoryRepository();
  const service = createProjectService({
    repository,
    generateIds: () => {
      const suffix = String(sequence++);
      return {
        internalProjectId: `11111111-1111-4111-8111-11111111111${suffix}`,
        publicProjectId: `prj_0123456789abcdefghijk${suffix}`,
      };
    },
    now: () => new Date("2026-08-23T08:00:00.000Z"),
  });
  const logger = { info: vi.fn(), error: vi.fn() };
  return {
    create: createCreateProjectHandler(service, logger),
    list: createListProjectsHandler(service, logger),
    inspect: createInspectProjectHandler(service, logger),
    logger,
  };
}

describe("owner project control integration", () => {
  it("creates, paginates, and inspects projects only through the verified owner subject", async () => {
    const handlers = assembled();
    const createA1 = await handlers.create(
      event(ownerA, {
        headers: { authorization: `Bearer ${bearer}`, "x-owner-id": ownerB },
        body: JSON.stringify({ name: "Owner A default", enabledUtilities: ["file-management"] }),
      }),
    );
    const createA2 = await handlers.create(
      event(ownerA, {
        body: JSON.stringify({
          name: "Owner A boundaries",
          enabledUtilities: ["file-management"],
          fileManagement: { uploadUrlLifetimeMinutes: 1, downloadUrlLifetimeMinutes: 60 },
        }),
      }),
    );
    const createB = await handlers.create(
      event(ownerB, {
        body: JSON.stringify({ name: "Owner B", enabledUtilities: ["file-management"] }),
      }),
    );

    expect(createA1.statusCode).toBe(201);
    expect(ProjectResponseSchema.parse(parsed(createA1)).data.fileManagement).toEqual({
      uploadUrlLifetimeMinutes: 15,
      downloadUrlLifetimeMinutes: 5,
    });
    expect(ProjectResponseSchema.parse(parsed(createA2)).data.fileManagement).toEqual({
      uploadUrlLifetimeMinutes: 1,
      downloadUrlLifetimeMinutes: 60,
    });

    const firstPage = await handlers.list(event(ownerA, { queryStringParameters: { limit: "1" } }));
    const firstData = ProjectListResponseSchema.parse(parsed(firstPage)).data;
    expect(firstData.items).toHaveLength(1);
    expect(firstData.nextCursor).toBeDefined();
    const secondPage = await handlers.list(
      event(ownerA, {
        queryStringParameters: { limit: "1", cursor: firstData.nextCursor },
      }),
    );
    const ownerAItems = [
      ...firstData.items,
      ...ProjectListResponseSchema.parse(parsed(secondPage)).data.items,
    ];
    expect(ownerAItems.map((project) => project.name).sort()).toEqual([
      "Owner A boundaries",
      "Owner A default",
    ]);

    const ownerBProjectId = ProjectResponseSchema.parse(parsed(createB)).data.projectId;
    const wrongOwner = await handlers.inspect(
      event(ownerA, { pathParameters: { projectId: ownerBProjectId } }),
    );
    const missing = await handlers.inspect(
      event(ownerA, { pathParameters: { projectId: "prj_zzzzzzzzzzzzzzzzzzzzzz" } }),
    );
    expect(wrongOwner.statusCode).toBe(404);
    expect(parsed(wrongOwner)).toEqual(parsed(missing));

    const ownId = ownerAItems[0]!.projectId;
    const own = await handlers.inspect(event(ownerA, { pathParameters: { projectId: ownId } }));
    expect(ProjectResponseSchema.parse(parsed(own)).data.projectId).toBe(ownId);

    const evidence = JSON.stringify([
      parsed(createA1),
      parsed(createA2),
      parsed(createB),
      parsed(firstPage),
      parsed(secondPage),
      parsed(own),
      handlers.logger.info.mock.calls,
      handlers.logger.error.mock.calls,
    ]);
    expect(evidence).not.toMatch(
      /owner-a-private|owner-b-private|private-bearer|private@example|internalProjectId|gsi1|PROJECT#|UTILITY#/,
    );
  });

  it("fails closed for caller owner overrides, malformed input, cursors, and token claims", async () => {
    const handlers = assembled();
    const cases = [
      await handlers.create(
        event(ownerA, {
          body: JSON.stringify({
            name: "Override",
            ownerId: ownerB,
            enabledUtilities: ["file-management"],
          }),
        }),
      ),
      await handlers.create(
        event(ownerA, { body: JSON.stringify({ name: "", enabledUtilities: ["other"] }) }),
      ),
      await handlers.create(
        event(ownerA, {
          body: JSON.stringify({
            name: "Invalid settings",
            enabledUtilities: ["file-management"],
            fileManagement: { uploadUrlLifetimeMinutes: 0, downloadUrlLifetimeMinutes: 61 },
          }),
        }),
      ),
      await handlers.list(event(ownerA, { queryStringParameters: { cursor: "e30" } })),
      await handlers.list(event(undefined)),
      await handlers.list(
        event(undefined, {
          requestContext: {
            requestId: "integration-request",
            http: { method: "GET", path: "/v1/control/projects" },
            authorizer: { jwt: { claims: { sub: ownerA, token_use: "id" } } },
          },
        }),
      ),
    ];

    expect(cases.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 401, 401]);
    for (const response of cases) {
      expect(() => ErrorEnvelopeSchema.parse(parsed(response))).not.toThrow();
      expect(JSON.stringify(parsed(response))).not.toMatch(
        /owner-a-private|owner-b-private|claims|token_use/,
      );
    }
  });
});
