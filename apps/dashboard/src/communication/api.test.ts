import { describe, expect, it, vi } from "vitest";
import { createCommunicationApi } from "./api.js";
describe("communication api", () => {
  const connection = {
    connectionId: "con_1234567890123456789012",
    projectId: "prj_1234567890123456789012",
    provider: "green-api",
    instanceId: "i",
    status: "active",
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
  } as const;
  it("submits credentials only in the request body", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            connectionId: "con_1234567890123456789012",
            projectId: "prj_1234567890123456789012",
            provider: "green-api",
            instanceId: "i",
            status: "active",
            createdAt: "2026-11-09T00:00:00.000Z",
            updatedAt: "2026-11-09T00:00:00.000Z",
          },
          requestId: "request-id",
        }),
        { status: 201 },
      ),
    );
    const api = createCommunicationApi({ getAccessToken: () => Promise.resolve("token"), fetch });
    const connection = await api.register("prj_1234567890123456789012", {
      provider: "green-api",
      instanceId: "i",
      credential: "credential-material-that-is-long-enough",
    });
    expect(connection).not.toHaveProperty("credential");
    expect(String(fetch.mock.calls[0]![0])).not.toContain("credential");
  });
  it("loads only redacted project-scoped connection state", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [connection] }, requestId: "request-id" })),
      );
    const api = createCommunicationApi({ getAccessToken: () => Promise.resolve("token"), fetch });
    await expect(api.list(connection.projectId)).resolves.toEqual([connection]);
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      `/projects/${connection.projectId}/communication-connections`,
    );
  });
});
