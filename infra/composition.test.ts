import { describe, expect, it } from "vitest";

import { API_COMPONENT_NAME, API_CORS, HEALTH_ROUTE } from "./api.js";
import { CONTROL_ROUTES, DASHBOARD_CONTROL_POLICY } from "./config/control.js";
import { DASHBOARD_COMPONENT_NAME, DASHBOARD_CONFIG } from "./dashboard.js";

describe("SST composition contracts", () => {
  it("keeps health public and defines three separate control routes", () => {
    expect(API_COMPONENT_NAME).toBe("ServiceApi");
    expect(API_CORS).toBe(false);
    expect(HEALTH_ROUTE).toEqual({
      name: "HealthRoute",
      route: "GET /v1/health",
      handler: "packages/backend/src/functions/health.handler",
      runtime: "nodejs24.x",
      tracingMode: "Active",
    });
    expect(JSON.stringify(HEALTH_ROUTE)).not.toContain("*");
    expect(CONTROL_ROUTES).toHaveLength(3);
  });

  it("builds the dashboard from the real Vite workspace", () => {
    expect(DASHBOARD_COMPONENT_NAME).toBe("Dashboard");
    expect(DASHBOARD_CONFIG).toEqual({
      path: "apps/dashboard",
      build: { command: "npm run build", output: "dist" },
    });
    expect(DASHBOARD_CONTROL_POLICY.pathPattern).toBe("v1/control/*");
    expect(DASHBOARD_CONTROL_POLICY.minTtl).toBe(0);
    expect(DASHBOARD_CONTROL_POLICY.defaultTtl).toBe(0);
    expect(DASHBOARD_CONTROL_POLICY.maxTtl).toBe(0);
    expect(DASHBOARD_CONTROL_POLICY.headers).toEqual(["Authorization", "Content-Type"]);
    expect(DASHBOARD_CONTROL_POLICY.queryStrings).toEqual(["limit", "cursor"]);
    expect(DASHBOARD_CONTROL_POLICY.cookieBehavior).toBe("none");
  });
});
