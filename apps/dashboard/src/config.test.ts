import { describe, expect, it } from "vitest";

import { loadDashboardConfig } from "./config.js";

describe("loadDashboardConfig", () => {
  it("loads only public Cognito identifiers and the public API origin", () => {
    expect(
      loadDashboardConfig({
        VITE_COGNITO_USER_POOL_ID: "il-central-1_AbCdEf123",
        VITE_COGNITO_USER_POOL_CLIENT_ID: "0123456789abcdefghijklmnop",
        VITE_API_URL: "https://api.example.com/",
        VITE_SECRET: "must-not-pass-through",
      }),
    ).toEqual({
      userPoolId: "il-central-1_AbCdEf123",
      userPoolClientId: "0123456789abcdefghijklmnop",
      apiBaseUrl: "https://api.example.com",
    });
  });

  it.each([
    {},
    { VITE_COGNITO_USER_POOL_ID: "invalid", VITE_COGNITO_USER_POOL_CLIENT_ID: "short" },
    {
      VITE_COGNITO_USER_POOL_ID: "il-central-1_AbCdEf123",
      VITE_COGNITO_USER_POOL_CLIENT_ID: "CLIENT-WITH-UPPERCASE",
      VITE_API_URL: "http://api.example.com",
    },
  ])("rejects missing or malformed configuration without exposing values", (environment) => {
    expect(() => loadDashboardConfig(environment)).toThrow(
      "Dashboard authentication configuration is unavailable",
    );
    try {
      loadDashboardConfig(environment);
    } catch (error) {
      expect(String(error)).not.toContain(JSON.stringify(environment));
    }
  });
});
