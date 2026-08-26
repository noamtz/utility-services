import { describe, expect, it, vi } from "vitest";

import {
  AWS_ACCESS_POLICY,
  createAwsEnvironment,
  resolveTrustedAwsCliPath,
  verifyAwsIdentity,
} from "./aws-access.mjs";

describe("AWS access policy", () => {
  it("pins the required profile, region, and Windows CA bundle", () => {
    expect(createAwsEnvironment({}, "win32")).toMatchObject({
      AWS_PROFILE: "ntz-cli",
      AWS_REGION: "il-central-1",
      AWS_DEFAULT_REGION: "il-central-1",
      AWS_CA_BUNDLE: AWS_ACCESS_POLICY.windowsCaBundle,
    });
  });

  it("accepts only the exact account and principal", () => {
    const valid = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        Account: AWS_ACCESS_POLICY.accountId,
        Arn: AWS_ACCESS_POLICY.principalArn,
      }),
    });
    expect(verifyAwsIdentity(valid, {}, "C:\\repo", AWS_ACCESS_POLICY.windowsCliPath)).toEqual({
      accountId: AWS_ACCESS_POLICY.accountId,
      principalArn: AWS_ACCESS_POLICY.principalArn,
    });
    expect(valid.mock.calls[0]?.[0]).toBe(AWS_ACCESS_POLICY.windowsCliPath);

    const invalid = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ Account: "000000000000", Arn: "arn:other" }),
    });
    expect(() =>
      verifyAwsIdentity(invalid, {}, "C:\\repo", AWS_ACCESS_POLICY.windowsCliPath),
    ).toThrow("identity mismatch");
  });

  it("resolves only absolute trusted CLI paths", () => {
    expect(resolveTrustedAwsCliPath("win32")).toBe(AWS_ACCESS_POLICY.windowsCliPath);
    expect(resolveTrustedAwsCliPath("linux")).toBe(AWS_ACCESS_POLICY.posixCliPath);
    expect(resolveTrustedAwsCliPath("darwin")).toBe(AWS_ACCESS_POLICY.posixCliPath);
  });
});
