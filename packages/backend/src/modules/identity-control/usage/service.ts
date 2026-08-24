import {
  MonthlyUsageProjectionSchema,
  type MonthlyUsageProjection,
} from "@utility-services/contracts";

import { HttpError } from "../../../core/http/handler.js";
import type { FreshnessPolicy } from "../../usage-pricing/service.js";
import type { OwnerContext } from "../auth/owner-context.js";
import type { ProjectRepository } from "../projects/repository.js";
import { CURRENT_MONTH_USAGE_FRESHNESS_POLICY, currentUtcUsagePeriod } from "./policy.js";

export interface MonthlyUsageProjectionReader {
  getMonthlyProjection(
    internalProjectId: string,
    period: string,
    evaluatedAt: string,
    policy: FreshnessPolicy,
  ): Promise<MonthlyUsageProjection>;
}

export interface OwnerUsageService {
  currentMonth(owner: OwnerContext, publicProjectId: string): Promise<MonthlyUsageProjection>;
}

export function createOwnerUsageService(dependencies: {
  readonly projects: Pick<ProjectRepository, "inspect">;
  readonly usage: MonthlyUsageProjectionReader;
  readonly now?: () => Date;
  readonly freshnessPolicy?: FreshnessPolicy;
}): OwnerUsageService {
  const now = dependencies.now ?? (() => new Date());
  const freshnessPolicy = dependencies.freshnessPolicy ?? CURRENT_MONTH_USAGE_FRESHNESS_POLICY;

  return Object.freeze({
    async currentMonth(owner: OwnerContext, publicProjectId: string) {
      const project = await dependencies.projects.inspect(publicProjectId);
      if (!project || project.ownerId !== owner.ownerId) {
        throw new HttpError(404, "NOT_FOUND", "Project not found");
      }
      const evaluatedAt = now();
      return MonthlyUsageProjectionSchema.parse(
        await dependencies.usage.getMonthlyProjection(
          project.internalProjectId,
          currentUtcUsagePeriod(evaluatedAt),
          evaluatedAt.toISOString(),
          freshnessPolicy,
        ),
      );
    },
  });
}
