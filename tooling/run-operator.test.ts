import { resolveInstallationTarget } from "../infra/config/installation-target.js";
const target = resolveInstallationTarget("israel", "dev-plan");
import { describe, expect, it, vi } from "vitest";

import { resolveTrustedAwsCliPath } from "./aws-access.mjs";
import { parseOperatorInvocation, runOperator } from "./run-operator.mjs";

const identity = JSON.stringify({
  Account: target.accountId,
  Arn: target.principalArn,
});

describe("operator wrapper", () => {
  it("accepts only allowlisted operations with one explicit stage", () => {
    expect(
      parseOperatorInvocation([
        "set-suspension",
        "--installation-target=israel",
        "--stage",
        "dev-israel-rus10",
        "--target",
        "project",
      ]),
    ).toMatchObject({
      operation: "set-suspension",
      stage: { name: "dev-israel-rus10" },
      toolArgs: ["--target", "project"],
    });
    expect(() => parseOperatorInvocation(["arbitrary", "--stage", "dev-israel-rus10"])).toThrow();
    expect(() => parseOperatorInvocation(["set-suspension"])).toThrow();
    expect(() =>
      parseOperatorInvocation([
        "set-suspension",
        "--installation-target=israel",
        "--stage",
        "dev-israel-rus10",
        "--table-name",
        "Other",
      ]),
    ).toThrow("Physical resource names");
  });

  it("preflights identity and invokes pinned SST shell without a command shell", () => {
    const awsCliPath = resolveTrustedAwsCliPath();
    const spawn = vi.fn((command: string, args?: readonly string[], options?: unknown) => {
      void args;
      void options;
      return command === awsCliPath ? { status: 0, stdout: identity } : { status: 0 };
    });
    expect(
      runOperator(
        [
          "set-suspension",
          "--installation-target=israel",
          "--stage",
          "dev-israel-rus10",
          "--target",
          "project",
        ],
        spawn as unknown as Parameters<typeof runOperator>[1],
      ),
    ).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1]?.[1]).not.toContain("--installation-target=israel");
    expect(spawn.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["shell", "--stage", "dev-israel-rus10", "--target", "project"]),
    );
    expect(spawn.mock.calls[1]?.[2]).toMatchObject({ shell: false, stdio: "inherit" });
  });

  it("stops before SST when identity is wrong", () => {
    const spawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ Account: "000000000000", Arn: "arn:other" }),
    });
    expect(() =>
      runOperator(
        ["set-suspension", "--installation-target=israel", "--stage", "dev-israel-rus10"],
        spawn,
      ),
    ).toThrow("identity mismatch");
    expect(spawn).toHaveBeenCalledOnce();
  });
});
