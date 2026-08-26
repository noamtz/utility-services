import { describe, expect, it, vi } from "vitest";

import { executeSuspension, parseSuspensionArguments } from "./set-suspension.mjs";

const projectId = "prj_0123456789abcdefghijkl";
const keyId = "key_0123456789abcdefghijkl";

function operations(status = "active") {
  return {
    inspectProject: vi.fn().mockResolvedValue({ status }),
    inspectKey: vi.fn().mockResolvedValue({ status }),
    setProjectStatus: vi.fn().mockResolvedValue(undefined),
    setKeyStatus: vi.fn().mockResolvedValue(undefined),
  };
}

describe("suspension operator", () => {
  it("defaults to dry-run and requires exact apply confirmation", () => {
    expect(
      parseSuspensionArguments([
        "--stage-name",
        "dev-rus10",
        "--target",
        "project",
        "--project-id",
        projectId,
        "--action",
        "suspend",
      ]),
    ).toMatchObject({ apply: false, target: "project" });
    expect(() =>
      parseSuspensionArguments([
        "--stage-name",
        "production",
        "--target",
        "project",
        "--project-id",
        projectId,
        "--action",
        "suspend",
        "--apply",
      ]),
    ).toThrow("requires --confirm");
    expect(
      parseSuspensionArguments([
        "--stage-name",
        "production",
        "--target",
        "project",
        "--project-id",
        projectId,
        "--action",
        "suspend",
        "--apply",
        "--confirm",
        "APPLY:production:project:suspend",
      ]),
    ).toMatchObject({ apply: true, stage: "production" });
  });

  it("reports dry-run safely without mutation", async () => {
    const deps = operations();
    const write = vi.fn();
    await expect(
      executeSuspension(
        [
          "--stage-name",
          "dev-rus10",
          "--target",
          "key",
          "--project-id",
          projectId,
          "--key-id",
          keyId,
          "--action",
          "suspend",
        ],
        deps,
        write,
      ),
    ).resolves.toMatchObject({ applied: false, status: "suspended" });
    expect(deps.setKeyStatus).not.toHaveBeenCalled();
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/secret|hash|table/i);
  });

  it("applies a confirmed key transition and keeps desired state idempotent", async () => {
    const deps = operations();
    await executeSuspension(
      [
        "--stage-name",
        "dev-rus10",
        "--target",
        "key",
        "--project-id",
        projectId,
        "--key-id",
        keyId,
        "--action",
        "suspend",
        "--apply",
        "--confirm",
        "APPLY:dev-rus10:key:suspend",
      ],
      deps,
      vi.fn(),
    );
    expect(deps.setKeyStatus).toHaveBeenCalledWith(projectId, keyId, "active", "suspended");

    const already = operations("suspended");
    await expect(
      executeSuspension(
        [
          "--stage-name",
          "dev-rus10",
          "--target",
          "key",
          "--project-id",
          projectId,
          "--key-id",
          keyId,
          "--action",
          "suspend",
          "--apply",
          "--confirm",
          "APPLY:dev-rus10:key:suspend",
        ],
        already,
        vi.fn(),
      ),
    ).resolves.toMatchObject({ changed: false, applied: false });
  });

  it("rejects terminal keys and invalid target arguments", async () => {
    await expect(
      executeSuspension(
        [
          "--stage-name",
          "dev-rus10",
          "--target",
          "key",
          "--project-id",
          projectId,
          "--key-id",
          keyId,
          "--action",
          "resume",
        ],
        operations("revoked"),
        vi.fn(),
      ),
    ).rejects.toThrow("Terminal credential state");
    expect(() =>
      parseSuspensionArguments([
        "--stage-name",
        "dev-rus10",
        "--target",
        "key",
        "--project-id",
        projectId,
        "--action",
        "resume",
      ]),
    ).toThrow("--key-id is required");
  });
});
