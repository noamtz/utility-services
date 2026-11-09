import { resolveInstallationTarget } from "../infra/config/installation-target.js";
const target = resolveInstallationTarget("israel", "dev-plan");
import { describe, expect, it, vi } from "vitest";

import { resolveTrustedAwsCliPath } from "./aws-access.mjs";
import { AWS_CLI_POLICY, createAwsEnvironment } from "./aws-access.mjs";
import { parseSstInvocation, runSst } from "./run-sst.mjs";

const validIdentity = JSON.stringify({
  Account: target.accountId,
  Arn: target.principalArn,
});

describe("parseSstInvocation", () => {
  it.each([
    [["install", "--stage", "dev-plan"], "install", "dev-plan"],
    [["diff", "--json", "--stage=pr-42"], "diff", "pr-42"],
    [["deploy", "--stage", "dev-plan"], "deploy", "dev-plan"],
    [["dev", "--stage", "dev-israel-noam"], "dev", "dev-israel-noam"],
  ] as const)("accepts an allowlisted command", (argv, command, stage) => {
    expect(parseSstInvocation([...argv, "--installation-target=israel"])).toMatchObject({
      command,
      stage: { name: stage },
    });
  });

  const unsafeInvocations: string[][] = [
    [],
    ["remove", "--stage", "dev-plan"],
    ["diff"],
    ["diff", "--stage", "dev-one", "--stage=dev-two"],
    ["diff", "--stage", "main"],
    ["dev", "--stage", "production"],
    ["deploy", "--stage", "production"],
  ];

  it.each(unsafeInvocations.map((argv) => [argv] as const))(
    "rejects unsafe invocation %j",
    (argv) => {
      expect(() => parseSstInvocation([...argv, "--installation-target=israel"])).toThrow();
    },
  );
});

describe("runSst", () => {
  it("does not spawn SST when validation fails", () => {
    const spawn = vi.fn();

    expect(() =>
      runSst([...["remove", "--stage", "dev-plan"], "--installation-target", "israel"], spawn),
    ).toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns the pinned local CLI without a shell and preserves arguments", () => {
    const awsCliPath = resolveTrustedAwsCliPath();
    const spawn = vi.fn((...parameters: [string, string[], object]) => {
      expect(parameters).toHaveLength(3);
      return parameters[0] === awsCliPath ? { status: 0, stdout: validIdentity } : { status: 0 };
    });

    expect(
      runSst(
        [...["diff", "--json", "--stage", "dev-plan"], "--installation-target", "israel"],
        spawn,
      ),
    ).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1]?.[1]).not.toContain("--installation-target");
    expect(spawn.mock.calls[0]?.[0]).toBe(awsCliPath);
    expect(spawn.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["sts", "get-caller-identity", "--profile", "ntz-cli"]),
    );
    expect(spawn.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["diff", "--json", "--stage", "dev-plan"]),
    );
    const sstOptions = spawn.mock.calls[1]?.[2] as {
      shell?: boolean;
      stdio?: unknown;
      env?: NodeJS.ProcessEnv;
    };
    expect(sstOptions).toMatchObject({
      shell: false,
      stdio: "inherit",
    });
    expect(sstOptions.env).toMatchObject({
      AWS_PROFILE: "ntz-cli",
      AWS_REGION: "il-central-1",
    });
  });

  it("rejects the wrong AWS account before SST can run", () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({
        Account: "000000000000",
        Arn: "arn:aws:iam::000000000000:user/other",
      }),
    }));

    expect(() =>
      runSst([...["diff", "--stage", "dev-plan"], "--installation-target", "israel"], spawn),
    ).toThrow("AWS identity mismatch");
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("keeps provider installation local and skips the AWS identity call", () => {
    const spawn = vi.fn((...parameters: [string, string[], object]) => {
      expect(parameters).toHaveLength(3);
      return { status: 0 };
    });

    expect(
      runSst([...["install", "--stage", "dev-plan"], "--installation-target", "israel"], spawn),
    ).toBe(0);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[0]).not.toBe(resolveTrustedAwsCliPath());
  });
});

describe("createAwsEnvironment", () => {
  it("pins the project profile, region, and standard Windows CLI CA bundle", () => {
    expect(createAwsEnvironment(target, {}, "win32")).toMatchObject({
      AWS_PROFILE: "ntz-cli",
      AWS_REGION: "il-central-1",
      AWS_DEFAULT_REGION: "il-central-1",
      AWS_CA_BUNDLE: AWS_CLI_POLICY.windowsCaBundle,
    });
  });

  it("preserves an explicit CA bundle override", () => {
    expect(
      createAwsEnvironment(target, { AWS_CA_BUNDLE: "D:\\trusted.pem" }, "win32"),
    ).toMatchObject({
      AWS_PROFILE: "ntz-cli",
      AWS_CA_BUNDLE: "D:\\trusted.pem",
    });
  });
});
