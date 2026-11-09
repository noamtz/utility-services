import { describe, expect, it, vi } from "vitest";

vi.mock("sst", () => ({
  Resource: new Proxy(
    { ControlTable: { name: "control-table" } },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        throw new Error(`${String(key)} is not linked`);
      },
    },
  ),
}));

describe("project runtime resource links", () => {
  it("loads base control handlers without a FileTable link", async () => {
    await expect(import("./runtime.js")).resolves.toHaveProperty("createProjectHandler");
  });

  it("requires a FileTable link only for the policy update handler", async () => {
    await expect(import("./update-policy-runtime.js")).rejects.toThrow("FileTable is not linked");
  });
});
