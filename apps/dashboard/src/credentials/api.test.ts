import { describe, expect, it, vi } from "vitest";

import type { ControlClient } from "../api/control-client.js";
import { createCredentialApi } from "./api.js";

describe("credential API", () => {
  it("uses only owner control paths for the complete key lifecycle", async () => {
    const request = vi.fn().mockResolvedValue({ data: { items: [] }, requestId: "r" });
    const api = createCredentialApi({ request } as ControlClient);
    await api.list("prj_0123456789abcdefghijkl");
    expect(request).toHaveBeenCalledWith(
      "/v1/control/projects/prj_0123456789abcdefghijkl/api-keys?limit=20",
      expect.anything(),
    );
    expect(JSON.stringify(request.mock.calls)).not.toContain("/v1/files");
  });

  it("forwards pagination and every mutation through the selected project path", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: { items: [], nextCursor: "next_1" }, requestId: "r1" })
      .mockResolvedValueOnce({ data: { apiKey: "issued" }, requestId: "r2" })
      .mockResolvedValueOnce({ data: { metadata: {} }, requestId: "r3" })
      .mockResolvedValueOnce({ data: { apiKey: "replacement" }, requestId: "r4" });
    const api = createCredentialApi({ request } as ControlClient);
    await api.list("prj_0123456789abcdefghijkl", { limit: 10, cursor: "next_1" });
    await api.issue("prj_0123456789abcdefghijkl");
    await api.revoke("prj_0123456789abcdefghijkl", "key_0123456789abcdefghijkl");
    await api.replace("prj_0123456789abcdefghijkl", "key_0123456789abcdefghijkl");
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/v1/control/projects/prj_0123456789abcdefghijkl/api-keys?limit=10&cursor=next_1",
      expect.anything(),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/v1/control/projects/prj_0123456789abcdefghijkl/api-keys",
      expect.anything(),
      { method: "POST" },
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/v1/control/projects/prj_0123456789abcdefghijkl/api-keys/key_0123456789abcdefghijkl",
      expect.anything(),
      { method: "DELETE" },
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      "/v1/control/projects/prj_0123456789abcdefghijkl/api-keys/key_0123456789abcdefghijkl/replace",
      expect.anything(),
      { method: "POST" },
    );
  });
});
