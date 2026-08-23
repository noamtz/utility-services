import { describe, expect, it } from "vitest";

import { API_COMPONENT_NAME, API_CORS, HEALTH_ROUTE } from "./api.js";
import { DASHBOARD_COMPONENT_NAME, DASHBOARD_CONFIG } from "./dashboard.js";

describe("SST composition contracts", () => {
  it("defines exactly the safe foundation API route", () => {
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
  });

  it("builds the dashboard from the real Vite workspace", () => {
    expect(DASHBOARD_COMPONENT_NAME).toBe("Dashboard");
    expect(DASHBOARD_CONFIG).toEqual({
      path: "apps/dashboard",
      build: { command: "npm run build", output: "dist" },
    });
  });
});
