import { describe, expect, it, vi } from "vitest";

import { AWS_ACCESS_POLICY } from "./aws-access.mjs";
import { parseOperatorInvocation, runOperator } from "./run-operator.mjs";

const identity = JSON.stringify({
  Account: AWS_ACCESS_POLICY.accountId,
  Arn: AWS_ACCESS_POLICY.principalArn,
});

describe("operator wrapper", () => {
  it("accepts only allowlisted operations with one explicit stage", () => {
    expect(
      parseOperatorInvocation(["set-suspension", "--stage", "dev-rus10", "--target", "project"]),
    ).toMatchObject({
      operation: "set-suspension",
      stage: { name: "dev-rus10" },
      toolArgs: ["--target", "project"],
    });
    expect(() => parseOperatorInvocation(["arbitrary", "--stage", "dev-rus10"])).toThrow();
    expect(() => parseOperatorInvocation(["set-suspension"])).toThrow();
    expect(() =>
      parseOperatorInvocation(["set-suspension", "--stage", "dev-rus10", "--table-name", "Other"]),
    ).toThrow("Physical resource names");
  });

  it("preflights identity and invokes pinned SST shell without a command shell", () => {
    const spawn = vi.fn((command: string, args?: readonly string[], options?: unknown) => {
      void args;
      void options;
      return command === "aws" ? { status: 0, stdout: identity } : { status: 0 };
    });
    expect(
      runOperator(
        ["set-suspension", "--stage", "dev-rus10", "--target", "project"],
        spawn as unknown as Parameters<typeof runOperator>[1],
      ),
    ).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["shell", "--stage", "dev-rus10", "--target", "project"]),
    );
    expect(spawn.mock.calls[1]?.[2]).toMatchObject({ shell: false, stdio: "inherit" });
  });

  it("stops before SST when identity is wrong", () => {
    const spawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ Account: "000000000000", Arn: "arn:other" }),
    });
    expect(() => runOperator(["set-suspension", "--stage", "dev-rus10"], spawn)).toThrow(
      "identity mismatch",
    );
    expect(spawn).toHaveBeenCalledOnce();
  });
});
