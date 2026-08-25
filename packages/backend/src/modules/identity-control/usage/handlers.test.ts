import {
  USAGE_COST_EXCLUSIONS,
  USAGE_COST_LABEL,
  USAGE_METRICS,
} from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { createGetCurrentMonthUsageHandler } from "./handlers.js";

const projectId = "prj_0123456789abcdefghijkl";
const projection = {
  label: USAGE_COST_LABEL,
  currency: "USD" as const,
  period: "2026-08",
  totalCostUsd: "0",
  metrics: USAGE_METRICS.map((metric) => ({
    metric,
    quantity: "0",
    costUsd: "0",
    priceVersionIds: [],
  })),
  priceVersionIds: [],
  exclusions: [...USAGE_COST_EXCLUSIONS],
  freshness: {
    state: "not-yet-metered" as const,
    lastMeteredAt: null,
    evaluatedAt: "2026-08-24T10:00:00.000Z",
  },
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    version: "2.0",
    requestContext: {
      requestId: "usage-request-1",
      http: { method: "GET", path: `/v1/control/projects/${projectId}/usage/current-month` },
      authorizer: { jwt: { claims: { sub: "owner-1", token_use: "access" } } },
    },
    pathParameters: { projectId },
    ...overrides,
  };
}

describe("current-month usage handler", () => {
  it("uses owner authorization and returns the strict public envelope", async () => {
    const currentMonth = vi.fn().mockResolvedValue(projection);
    const response = await createGetCurrentMonthUsageHandler({ currentMonth })(event());
    expect(response.statusCode).toBe(200);
    expect(currentMonth).toHaveBeenCalledWith({ ownerId: "owner-1" }, projectId);
    expect(JSON.parse(response.body ?? "null")).toEqual({
      data: projection,
      requestId: "usage-request-1",
    });
  });

  it("rejects missing owner authorization before reading usage", async () => {
    const currentMonth = vi.fn().mockResolvedValue(projection);
    const response = await createGetCurrentMonthUsageHandler({ currentMonth })(
      event({
        requestContext: { requestId: "usage-request-1", http: { method: "GET", path: "/" } },
      }),
    );
    expect(response.statusCode).toBe(401);
    expect(currentMonth).not.toHaveBeenCalled();
  });
});
