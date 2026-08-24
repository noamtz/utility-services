import {
  USAGE_COST_EXCLUSIONS,
  USAGE_COST_LABEL,
  USAGE_METRICS,
  type MonthlyUsageProjection,
} from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../../core/http/handler.js";
import type { InternalProject } from "../projects/model.js";
import { createOwnerUsageService } from "./service.js";

const project: InternalProject = {
  internalProjectId: "01234567-89ab-4cde-8fab-0123456789ab",
  publicProjectId: "prj_0123456789abcdefghijkl",
  ownerId: "owner-1",
  name: "Usage project",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const projection: MonthlyUsageProjection = {
  label: USAGE_COST_LABEL,
  currency: "USD",
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
    state: "not-yet-metered",
    lastMeteredAt: null,
    evaluatedAt: "2026-08-24T10:00:00.000Z",
  },
};

describe("owner current-month usage service", () => {
  it("maps a public owner project to its internal usage boundary", async () => {
    const getMonthlyProjection = vi.fn().mockResolvedValue(projection);
    const service = createOwnerUsageService({
      projects: { inspect: vi.fn().mockResolvedValue(project) },
      usage: { getMonthlyProjection },
      now: () => new Date("2026-08-24T10:00:00.000Z"),
    });

    await expect(
      service.currentMonth({ ownerId: "owner-1" }, project.publicProjectId),
    ).resolves.toEqual(projection);
    expect(getMonthlyProjection).toHaveBeenCalledWith(
      project.internalProjectId,
      "2026-08",
      "2026-08-24T10:00:00.000Z",
      { requiredSources: { "cloudtrail-download": 86_400_000 } },
    );
  });

  it.each([undefined, { ...project, ownerId: "another-owner" }])(
    "returns the same not-found result for absent and foreign projects",
    async (storedProject) => {
      const getMonthlyProjection = vi.fn();
      const service = createOwnerUsageService({
        projects: { inspect: vi.fn().mockResolvedValue(storedProject) },
        usage: { getMonthlyProjection },
      });
      const error = await service
        .currentMonth({ ownerId: "owner-1" }, project.publicProjectId)
        .catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
      expect(getMonthlyProjection).not.toHaveBeenCalled();
    },
  );
});
