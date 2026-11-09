import { describe, expect, it, vi } from "vitest";
import { parseInstallationArguments } from "./installation-arguments.mjs";
import { runSst } from "./run-sst.mjs";
import { runOperator } from "./run-operator.mjs";

describe("explicit wrapper selectors", () => {
  it.each([
    ["--installation-target", "israel", "--stage", "dev-rus02"],
    ["--stage=dev-rus02", "--installation-target=israel"],
  ])("consumes either selector syntax and preserves operator business target", (...args) => {
    expect(parseInstallationArguments([...args, "--target", "project"])).toMatchObject({
      installation: { name: "israel" },
      stage: { name: "dev-rus02" },
      args: ["--target", "project"],
    });
  });

  const valid = ["--installation-target=israel", "--stage=dev-rus02"];
  it.each([
    [],
    ["--stage=dev-rus02"],
    ["--installation-target=israel"],
    [...valid, "--stage=dev-plan"],
    [...valid, "--installation-target=israel"],
    ["--installation-target", "--stage", "dev-rus02"],
    [...valid, "--installation-target="],
    ["--installation-target=unknown", "--stage=dev-rus02"],
    [...valid, "--region=eu-central-1"],
    [...valid, "--profile", "default"],
    [...valid, "--config", "other.ts"],
    [...valid, "-s", "production"],
    [...valid, "--", "--stage=production"],
    [...valid, ""],
  ])("fails before any process starts for unsafe selectors %j", (...args) => {
    const spawn = vi.fn();
    expect(() => runSst(["diff", ...args], spawn)).toThrow();
    expect(() => runOperator(["set-suspension", ...args], spawn)).toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });
});
