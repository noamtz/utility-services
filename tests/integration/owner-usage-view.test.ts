import {
  CurrentMonthlyUsageResponseSchema,
  USAGE_COST_EXCLUSIONS,
  USAGE_COST_LABEL,
  USAGE_METRICS,
} from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { createGetCurrentMonthUsageHandler } from "../../packages/backend/src/modules/identity-control/usage/handlers.js";
import { createOwnerUsageService } from "../../packages/backend/src/modules/identity-control/usage/service.js";

const projectId = "prj_0123456789abcdefghijkl";
const project = {
  internalProjectId: "01234567-89ab-4cde-8fab-0123456789ab",
  publicProjectId: projectId,
  ownerId: "owner-a",
  name: "Usage",
  enabledUtilities: ["file-management"] as const,
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};
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

function event(ownerId: string) {
  return {
    version: "2.0",
    requestContext: {
      requestId: "usage-integration",
      http: { method: "GET", path: `/v1/control/projects/${projectId}/usage/current-month` },
      authorizer: { jwt: { claims: { sub: ownerId, token_use: "access" } } },
    },
    pathParameters: { projectId },
  };
}

describe("owner usage view integration", () => {
  it("returns only the existing public projection for the verified project owner", async () => {
    const reader = { getMonthlyProjection: vi.fn().mockResolvedValue(projection) };
    const service = createOwnerUsageService({
      projects: { inspect: vi.fn().mockResolvedValue(project) },
      usage: reader,
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });
    const handler = createGetCurrentMonthUsageHandler(service);
    const own = await handler(event("owner-a"));
    const foreign = await handler(event("owner-b"));

    expect(CurrentMonthlyUsageResponseSchema.parse(JSON.parse(own.body ?? "null")).data).toEqual(
      projection,
    );
    expect(foreign.statusCode).toBe(404);
    expect(reader.getMonthlyProjection).toHaveBeenCalledTimes(1);
    expect(own.body).not.toMatch(/internalProjectId|owner-a|01234567/u);
  });
});
