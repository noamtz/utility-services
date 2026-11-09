import { resolveInstallationTarget } from "../infra/config/installation-target.js";
const target = resolveInstallationTarget("israel", "dev-plan");
import { describe, expect, it, vi } from "vitest";

import {
  AWS_CLI_POLICY,
  createAwsEnvironment,
  resolveTrustedAwsCliPath,
  verifyAwsIdentity,
} from "./aws-access.mjs";

describe("AWS access policy", () => {
  it("pins the required profile, region, and Windows CA bundle", () => {
    expect(createAwsEnvironment(target, {}, "win32")).toMatchObject({
      AWS_PROFILE: "ntz-cli",
      AWS_REGION: "il-central-1",
      AWS_DEFAULT_REGION: "il-central-1",
      AWS_CA_BUNDLE: AWS_CLI_POLICY.windowsCaBundle,
    });
  });

  it("accepts only the exact account and principal", () => {
    const valid = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        Account: target.accountId,
        Arn: target.principalArn,
      }),
    });
    expect(
      verifyAwsIdentity(
        target,
        valid,
        createAwsEnvironment(target, {}),
        "C:\\repo",
        AWS_CLI_POLICY.windowsCliPath,
      ),
    ).toEqual({
      accountId: target.accountId,
      principalArn: target.principalArn,
    });
    expect(valid.mock.calls[0]?.[0]).toBe(AWS_CLI_POLICY.windowsCliPath);

    const invalid = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ Account: "000000000000", Arn: "arn:other" }),
    });
    expect(() =>
      verifyAwsIdentity(
        target,
        invalid,
        createAwsEnvironment(target, {}),
        "C:\\repo",
        AWS_CLI_POLICY.windowsCliPath,
      ),
    ).toThrow("identity mismatch");
  });

  it("resolves only absolute trusted CLI paths", () => {
    expect(resolveTrustedAwsCliPath("win32")).toBe(AWS_CLI_POLICY.windowsCliPath);
    expect(resolveTrustedAwsCliPath("linux")).toBe(AWS_CLI_POLICY.posixCliPath);
    expect(resolveTrustedAwsCliPath("darwin")).toBe(AWS_CLI_POLICY.posixCliPath);
  });
});

describe("AWS preflight failure isolation", () => {
  it("scrubs alternate credential sources and Windows case variants without mutating the caller", () => {
    const source = {
      PATH: "keep",
      AWS_ACCESS_KEY_ID: "not-a-real-key",
      aws_secret_access_key: "hidden",
      AWS_SESSION_TOKEN: "hidden",
      AWS_WEB_IDENTITY_TOKEN_FILE: "other",
      AWS_ROLE_ARN: "other",
      AWS_CONFIG_FILE: "other",
      AWS_SHARED_CREDENTIALS_FILE: "other",
      AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://other",
      AWS_ENDPOINT_URL: "http://other",
      AWS_PROFILE: "default",
      AWS_REGION: "eu-central-1",
      SST_STAGE: "production",
      NODE_OPTIONS: "unsafe",
      RUS_INSTALLATION_TARGET: "other",
    };
    const result = createAwsEnvironment(target, source, "linux");
    expect(result).toMatchObject({
      PATH: "keep",
      AWS_PROFILE: "ntz-cli",
      AWS_REGION: "il-central-1",
      RUS_INSTALLATION_TARGET: "israel",
      RUS_INSTALLATION_STAGE: "dev-plan",
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
    });
    expect(JSON.stringify(result)).not.toMatch(/hidden|other|unsafe|not-a-real-key/);
    expect(source.AWS_PROFILE).toBe("default");
  });

  it.each([
    { Account: "000000000000", Arn: target.principalArn },
    { Account: target.accountId, Arn: "arn:aws:iam::162067902192:user/other" },
    { Account: target.accountId, Arn: "arn:aws:sts::162067902192:assumed-role/other/session" },
    null,
  ])("rejects wrong or missing identity fields without exposing the response", (identity) => {
    const spawn = vi.fn().mockReturnValue({ status: 0, stdout: JSON.stringify(identity) });
    expect(() =>
      verifyAwsIdentity(target, spawn, createAwsEnvironment(target, {}), "repo"),
    ).toThrow("identity mismatch");
    expect(spawn).toHaveBeenCalledOnce();
  });

  it.each([
    [{ status: 1, stdout: "private-token" }, "authentication failed"],
    [{ status: null, error: new Error("private-token") }, "authentication failed"],
    [{ status: 0, stdout: "private-token" }, "unreadable caller identity"],
  ] as const)("fails safely on process or JSON errors", (result, message) => {
    const spawn = vi.fn().mockReturnValue(result);
    expect(() =>
      verifyAwsIdentity(target, spawn, createAwsEnvironment(target, {}), "repo"),
    ).toThrow(message);
    expect(() =>
      verifyAwsIdentity(target, spawn, createAwsEnvironment(target, {}), "repo"),
    ).not.toThrow("private-token");
  });

  it("refuses tampered region, profile or policy before STS", () => {
    const spawn = vi.fn();
    const environment = createAwsEnvironment(target, {});
    expect(() =>
      verifyAwsIdentity(target, spawn, { ...environment, AWS_REGION: "eu-central-1" }, "repo"),
    ).toThrow("mismatch");
    expect(() =>
      verifyAwsIdentity(target, spawn, { ...environment, AWS_PROFILE: "default" }, "repo"),
    ).toThrow("mismatch");
    expect(() => createAwsEnvironment({ ...target, region: "eu-central-1" }, {})).toThrow(
      "mismatch",
    );
    expect(() => createAwsEnvironment({ ...target, accountId: "000000000000" }, {})).toThrow(
      "mismatch",
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});
