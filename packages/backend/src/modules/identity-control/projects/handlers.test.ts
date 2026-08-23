import type { Project, ProjectListPayload } from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../../core/http/handler.js";
import {
  createCreateProjectHandler,
  createInspectProjectHandler,
  createListProjectsHandler,
} from "./handlers.js";
import type { ProjectService } from "./service.js";

const timestamp = "2026-08-23T08:00:00.000Z";
const publicProject: Project = {
  projectId: "prj_0123456789abcdefghijkl",
  name: "Handler project",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: timestamp,
  updatedAt: timestamp,
};

function event(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: "2.0",
    requestContext: {
      requestId: "handler-request-1",
      http: { method: "POST", path: "/v1/control/projects" },
      authorizer: {
        jwt: { claims: { sub: "owner-1", token_use: "access", email: "private@example.com" } },
      },
    },
    headers: { authorization: "Bearer private-token" },
    ...overrides,
  };
}

function service(overrides: Partial<ProjectService> = {}): ProjectService {
  return {
    create: vi.fn().mockResolvedValue(publicProject),
    list: vi.fn().mockResolvedValue({ items: [] } satisfies ProjectListPayload),
    inspect: vi.fn().mockResolvedValue(publicProject),
    ...overrides,
  };
}

function body(response: { body?: string | undefined }): unknown {
  return JSON.parse(response.body ?? "null") as unknown;
}

describe("project handlers", () => {
  it("creates for the verified owner with a 201 public envelope", async () => {
    const create = vi.fn().mockResolvedValue(publicProject);
    const handler = createCreateProjectHandler(service({ create }));

    const response = await handler(
      event({
        body: JSON.stringify({
          name: "Handler project",
          enabledUtilities: ["file-management"],
        }),
      }),
    );

    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(
      { ownerId: "owner-1" },
      {
        name: "Handler project",
        enabledUtilities: ["file-management"],
        fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
      },
    );
    expect(body(response)).toEqual({ data: publicProject, requestId: "handler-request-1" });
    expect(JSON.stringify(body(response))).not.toMatch(/owner-1|private-token|internalProjectId/);
  });

  it("rejects malformed create input before calling the service", async () => {
    const create = vi.fn().mockResolvedValue(publicProject);
    const handler = createCreateProjectHandler(service({ create }));

    const response = await handler(
      event({ body: JSON.stringify({ name: "", enabledUtilities: ["other"] }) }),
    );

    expect(response.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { requestId: "handler-request-1", http: { method: "GET", path: "/v1/control/projects" } },
    {
      requestId: "handler-request-1",
      http: { method: "GET", path: "/v1/control/projects" },
      authorizer: { jwt: { claims: { sub: "owner-1", token_use: "id" } } },
    },
  ])("rejects absent or non-access owner context", async (requestContext) => {
    const list = vi.fn().mockResolvedValue({ items: [] });
    const handler = createListProjectsHandler(service({ list }));

    const response = await handler(event({ requestContext }));

    expect(response.statusCode).toBe(401);
    expect(body(response)).toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
      requestId: "handler-request-1",
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("parses list pagination and returns a strict payload", async () => {
    const list = vi.fn().mockResolvedValue({ items: [] });
    const handler = createListProjectsHandler(service({ list }));

    const response = await handler(event({ queryStringParameters: { limit: "50" } }));

    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith({ ownerId: "owner-1" }, { limit: 50 });
    expect(body(response)).toEqual({ data: { items: [] }, requestId: "handler-request-1" });
  });

  it("maps wrong-owner inspect to the same safe not-found envelope", async () => {
    const inspect = vi.fn().mockRejectedValue(new HttpError(404, "NOT_FOUND", "Project not found"));
    const handler = createInspectProjectHandler(service({ inspect }));

    const response = await handler(
      event({ pathParameters: { projectId: publicProject.projectId } }),
    );

    expect(response.statusCode).toBe(404);
    expect(body(response)).toEqual({
      error: { code: "NOT_FOUND", message: "Project not found" },
      requestId: "handler-request-1",
    });
  });

  it("logs no headers, tokens, claims, subjects, or request body", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = createCreateProjectHandler(service(), logger);

    await handler(
      event({
        body: JSON.stringify({
          name: "Sensitive body name",
          enabledUtilities: ["file-management"],
        }),
      }),
    );

    const serializedLogs = JSON.stringify(logger.info.mock.calls);
    expect(serializedLogs).not.toMatch(/private-token|private@example|owner-1|Sensitive body name/);
    expect(serializedLogs).toContain("handler-request-1");
  });
});
