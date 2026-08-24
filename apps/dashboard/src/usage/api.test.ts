import { describe, expect, it, vi } from "vitest";

import type { ControlClient } from "../api/control-client.js";
import { createUsageApi } from "./api.js";

describe("usage API", () => {
  it("reads current month through the selected owner project route", async () => {
    const request = vi.fn().mockResolvedValue({ data: { period: "2026-08" }, requestId: "r" });
    const api = createUsageApi({ request } as ControlClient);
    await expect(api.currentMonth("prj_0123456789abcdefghijkl")).resolves.toEqual({
      period: "2026-08",
    });
    expect(request).toHaveBeenCalledWith(
      "/v1/control/projects/prj_0123456789abcdefghijkl/usage/current-month",
      expect.anything(),
    );
  });
});
