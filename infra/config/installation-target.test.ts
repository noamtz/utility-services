import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSTALLATION_TARGETS,
  resolveInstallationEnvironment,
  resolveInstallationTarget,
  resolveSstAppInstallation,
} from "./installation-target.js";

afterEach(() => vi.unstubAllEnvs());

describe("installation identity and stage policy", () => {
  it("preserves the existing installation and deeply freezes the binding", () => {
    const target = resolveInstallationTarget("israel", "dev-rus02");
    expect(target).toMatchObject({
      name: "israel",
      accountId: "162067902192",
      region: "il-central-1",
      profile: "ntz-cli",
      principalArn: "arn:aws:iam::162067902192:user/ntz-cli",
      stage: { name: "dev-rus02", kind: "development" },
    });
    for (const value of [
      INSTALLATION_TARGETS,
      INSTALLATION_TARGETS[0],
      target,
      target.stage,
      target.stages,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(() => Object.assign(target, { region: "eu-central-1" })).toThrow();
    expect(() => Object.assign(target.stage, { name: "production" })).toThrow();
  });

  it.each(["dev-plan", "production", "dev-israel-wcu01", "pr-27"])(
    "binds %s explicitly to Israel",
    (stage) => {
      expect(resolveInstallationTarget("israel", stage).stage.name).toBe(stage);
    },
  );

  it.each([
    [undefined, "dev-rus02"],
    ["", "dev-rus02"],
    ["frankfurt", "dev-rus02"],
    ["israel", undefined],
    ["israel", "main"],
    ["israel", "dev-frankfurt-test"],
    ["israel", "dev-unbound"],
    ["israel", "pr-0"],
    ["israel", "dev-israel-"],
  ])("rejects missing, unknown, invalid or foreign target/stage %j / %j", (name, stage) => {
    expect(() => resolveInstallationTarget(name, stage)).toThrow();
  });

  it("refuses stage collisions across synthetic installations without contacting AWS", () => {
    const israel = INSTALLATION_TARGETS[0]!;
    const other = {
      ...israel,
      name: "fixture",
      accountId: "000000000000",
      region: "eu-central-1",
      stages: ["dev-rus02"],
      developmentPrefix: "dev-fixture-",
      pullRequests: false,
    };
    expect(() => resolveInstallationTarget("israel", "dev-rus02", [israel, other])).toThrow(
      "collides",
    );
    expect(() => resolveInstallationTarget("fixture", "dev-plan", [israel, other])).toThrow(
      "another target",
    );
    expect(() => resolveInstallationTarget("israel", "dev-plan", [israel, israel])).toThrow(
      "ambiguous",
    );
    expect(resolveInstallationTarget("fixture", "dev-fixture-test", [israel, other]).region).toBe(
      "eu-central-1",
    );
  });

  it("never selects target or region from ambient settings", () => {
    vi.stubEnv("AWS_REGION", "eu-central-1");
    vi.stubEnv("AWS_PROFILE", "default");
    vi.stubEnv("SST_STAGE", "production");
    expect(resolveInstallationTarget("israel", "dev-rus02")).toMatchObject({
      region: "il-central-1",
      profile: "ntz-cli",
      stage: { name: "dev-rus02" },
    });
  });
});

describe("SST installation environment boundary", () => {
  const environment = {
    RUS_INSTALLATION_TARGET: "israel",
    RUS_INSTALLATION_STAGE: "dev-rus02",
    AWS_REGION: "il-central-1",
    AWS_DEFAULT_REGION: "il-central-1",
    AWS_PROFILE: "ntz-cli",
  };
  it("accepts the wrapper binding", () => {
    expect(resolveInstallationEnvironment("dev-rus02", environment).name).toBe("israel");
  });
  it("allows SST-generated credentials only after the app boundary", () => {
    const runtimeEnvironment = {
      ...environment,
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
      SST_AWS_ACCESS_KEY_ID: "synthetic-key",
      SST_AWS_SECRET_ACCESS_KEY: "synthetic-secret",
      SST_AWS_SESSION_TOKEN: "synthetic-token",
      SST_AWS_REGION: "il-central-1",
    };
    expect(resolveInstallationEnvironment("dev-rus02", runtimeEnvironment).name).toBe("israel");
    expect(() => resolveSstAppInstallation("dev-rus02", runtimeEnvironment)).toThrow(
      "AWS environment overrides",
    );
  });
  it.each([
    ["RUS_INSTALLATION_TARGET", undefined],
    ["RUS_INSTALLATION_TARGET", "unknown"],
    ["RUS_INSTALLATION_STAGE", "production"],
    ["AWS_REGION", "eu-central-1"],
    ["AWS_DEFAULT_REGION", "us-east-1"],
    ["AWS_PROFILE", "default"],
  ])("rejects absent or conflicting %s", (key, value) => {
    expect(() =>
      resolveInstallationEnvironment("dev-rus02", { ...environment, [key]: value }),
    ).toThrow();
  });
});
