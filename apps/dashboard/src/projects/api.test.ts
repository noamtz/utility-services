import { describe, expect, it, vi } from "vitest";

import { ProjectApiError, createProjectApi } from "./api.js";

const project = {
  projectId: "prj_0123456789abcdefghijkl",
  name: "Documents",
  enabledUtilities: ["file-management"] as const,
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: "2026-08-23T08:00:00.000Z",
  updatedAt: "2026-08-23T08:00:00.000Z",
};
const summary = {
  projectId: project.projectId,
  name: project.name,
  enabledUtilities: project.enabledUtilities,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("project API", () => {
  it("gets a fresh access token and calls same-origin create/list/inspect paths", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("access-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: project, requestId: "req-1" }, 201))
      .mockResolvedValueOnce(
        jsonResponse({ data: { items: [summary], nextCursor: "next_1" }, requestId: "req-2" }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: project, requestId: "req-3" }));
    const api = createProjectApi({ getAccessToken, fetch });

    await expect(
      api.create({
        name: " Documents ",
        enabledUtilities: ["file-management"],
        fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
      }),
    ).resolves.toMatchObject({ name: "Documents" });
    await expect(api.list({ limit: 10, cursor: "next_1" })).resolves.toMatchObject({
      items: [summary],
    });
    await expect(api.inspect(project.projectId)).resolves.toEqual(project);

    expect(getAccessToken).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/v1/control/projects",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer access-token", "Content-Type": "application/json" },
      }),
    );
    expect(fetch.mock.calls[1]?.[0]).toBe("/v1/control/projects?limit=10&cursor=next_1");
    expect(fetch.mock.calls[2]?.[0]).toBe(`/v1/control/projects/${project.projectId}`);
  });

  it("rejects malformed success responses and safely maps error envelopes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { ...project, internalProjectId: "hidden" } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "PROJECT_NOT_FOUND", message: "Project not found" }, requestId: "req" },
          404,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ stack: "sensitive" }, 500));
    const api = createProjectApi({ getAccessToken: () => Promise.resolve("token"), fetch });

    await expect(api.inspect(project.projectId)).rejects.toMatchObject({
      code: "INVALID_PROJECT_RESPONSE",
    });
    await expect(api.inspect(project.projectId)).rejects.toEqual(
      expect.objectContaining({ code: "PROJECT_NOT_FOUND", statusCode: 404 }),
    );
    const failure = api.inspect(project.projectId);
    await expect(failure).rejects.toBeInstanceOf(ProjectApiError);
    await expect(failure).rejects.not.toThrow(/sensitive/);
  });

  it("maps an unavailable local session to a safe unauthorized error without fetching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createProjectApi({
      getAccessToken: () => Promise.reject(new Error("private refresh failure")),
      fetch,
    });

    await expect(api.list()).rejects.toEqual(
      expect.objectContaining({ code: "UNAUTHORIZED", statusCode: 401 }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
