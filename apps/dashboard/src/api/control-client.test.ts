import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ControlApiError, createControlClient } from "./control-client.js";

describe("control client", () => {
  it("adds a fresh Cognito access token and validates the response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ value: "ok" }), { status: 200 }));
    const client = createControlClient({ getAccessToken: () => Promise.resolve("token"), fetch });
    await expect(client.request("/control", z.object({ value: z.literal("ok") }))).resolves.toEqual(
      { value: "ok" },
    );
    expect(fetch).toHaveBeenCalledWith(
      "/control",
      expect.objectContaining({ headers: { Authorization: "Bearer token" } }),
    );
  });

  it("maps safe error envelopes without exposing malformed bodies", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "NOT_FOUND", message: "Project not found" },
            requestId: "r",
          }),
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ stack: "private" }), { status: 500 }));
    const client = createControlClient({ getAccessToken: () => Promise.resolve("token"), fetch });
    await expect(client.request("/one", z.unknown())).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    const failure = client.request("/two", z.unknown());
    await expect(failure).rejects.toBeInstanceOf(ControlApiError);
    await expect(failure).rejects.not.toThrow(/private/u);
  });

  it("ends the session on a 401 and rejects malformed success payloads", async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(undefined);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "UNAUTHORIZED", message: "Authentication required" },
            requestId: "r",
          }),
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: "wrong" }), { status: 200 }));
    const client = createControlClient({
      getAccessToken: () => Promise.resolve("token"),
      fetch,
      onUnauthorized,
    });
    await expect(client.request("/one", z.unknown())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    await expect(
      client.request("/two", z.object({ value: z.literal("ok") })),
    ).rejects.toMatchObject({
      code: "INVALID_CONTROL_RESPONSE",
    });
  });
});
