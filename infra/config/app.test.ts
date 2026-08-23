import { describe, expect, it } from "vitest";

import {
  APP_NAME,
  AWS_HOME,
  AWS_PROVIDER_PACKAGE,
  AWS_PROVIDER_VERSION,
  AWS_REGION,
  createAppPolicy,
} from "./app.js";

describe("createAppPolicy", () => {
  it("pins the regional AWS provider and production safety policy", () => {
    expect(createAppPolicy("production")).toEqual({
      name: APP_NAME,
      home: AWS_HOME,
      stage: { name: "production", kind: "production", ephemeral: false },
      provider: {
        package: AWS_PROVIDER_PACKAGE,
        version: AWS_PROVIDER_VERSION,
        region: AWS_REGION,
      },
      removal: "retain",
      protect: true,
    });
  });

  it.each(["dev-plan", "pr-12"])("keeps %s removable and unprotected", (stage) => {
    expect(createAppPolicy(stage)).toMatchObject({ removal: "remove", protect: false });
  });

  it("cannot be overridden through unrelated environment values", () => {
    process.env["AWS_REGION"] = "us-east-1";
    process.env["SST_REMOVAL"] = "remove";

    expect(createAppPolicy("production")).toMatchObject({
      provider: { region: "il-central-1", version: "7.43.0" },
      removal: "retain",
      protect: true,
    });
  });
});
