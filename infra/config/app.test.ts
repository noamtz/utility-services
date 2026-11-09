import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveInstallationTarget } from "./installation-target.js";

import {
  APP_NAME,
  AWS_HOME,
  AWS_PROVIDER_PACKAGE,
  AWS_PROVIDER_VERSION,
  createAppPolicy,
} from "./app.js";

afterEach(() => vi.unstubAllEnvs());

describe("createAppPolicy", () => {
  it("pins the regional AWS provider and production safety policy", () => {
    expect(createAppPolicy("israel", "production")).toEqual({
      name: APP_NAME,
      home: AWS_HOME,
      installation: resolveInstallationTarget("israel", "production"),
      stage: { name: "production", kind: "production", ephemeral: false },
      provider: {
        package: AWS_PROVIDER_PACKAGE,
        version: AWS_PROVIDER_VERSION,
        region: "il-central-1",
      },
      removal: "retain",
      protect: true,
    });
  });

  it.each(["dev-plan", "pr-12"])("keeps %s removable and unprotected", (stage) => {
    expect(createAppPolicy("israel", stage)).toMatchObject({ removal: "remove", protect: false });
  });

  it("cannot be overridden through unrelated environment values", () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("SST_REMOVAL", "remove");

    expect(createAppPolicy("israel", "production")).toMatchObject({
      provider: { region: "il-central-1", version: "7.43.0" },
      removal: "retain",
      protect: true,
    });
  });
});
