import { describe, expect, it, vi } from "vitest";

import { ProjectApiError, createProjectApi } from "./api.js";

const project = {
  projectId: "prj_0123456789abcdefghijkl",
  name: "Documents",
  enabledUtilities: ["file-management"] as const,
  fileManagement: {
    uploadUrlLifetimeMinutes: 15,
    downloadUrlLifetimeMinutes: 5,
    storageQuotaBytes: 5 * 2 ** 30,
    trashRetentionDays: 14,
  },
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
  it("gets a fresh access token and calls same-origin project paths", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("access-token");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: project, requestId: "req-1" }, 201))
      .mockResolvedValueOnce(
        jsonResponse({ data: { items: [summary], nextCursor: "next_1" }, requestId: "req-2" }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: project, requestId: "req-3" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            minStorageQuotaBytes: 1,
            maxStorageQuotaBytes: 10 * 2 ** 30,
            minTrashRetentionDays: 1,
            maxTrashRetentionDays: 90,
          },
          requestId: "req-4",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: project, requestId: "req-5" }));
    const api = createProjectApi({ getAccessToken, fetch });

    await expect(
      api.create({
        name: " Documents ",
        enabledUtilities: ["file-management"],
        fileManagement: project.fileManagement,
      }),
    ).resolves.toMatchObject({ name: "Documents" });
    await expect(api.list({ limit: 10, cursor: "next_1" })).resolves.toMatchObject({
      items: [summary],
    });
    await expect(api.inspect(project.projectId)).resolves.toEqual(project);
    await expect(api.getFileManagementPolicyLimits()).resolves.toMatchObject({
      maxTrashRetentionDays: 90,
    });
    await expect(
      api.updateFileManagementPolicy(project.projectId, {
        storageQuotaBytes: 5 * 2 ** 30,
        trashRetentionDays: 14,
      }),
    ).resolves.toEqual(project);

    expect(getAccessToken).toHaveBeenCalledTimes(5);
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
    expect(fetch.mock.calls[3]?.[0]).toBe("/v1/control/file-management-policy-limits");
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      `/v1/control/projects/${project.projectId}/file-management-policy`,
      expect.objectContaining({ method: "PATCH" }),
    );
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
