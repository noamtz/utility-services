import {
  CurrentMonthlyUsageResponseSchema,
  type MonthlyUsageProjection,
} from "@utility-services/contracts";

import type { ControlClient } from "../api/control-client.js";

export interface UsageApi {
  currentMonth(projectId: string): Promise<MonthlyUsageProjection>;
}

export function createUsageApi(client: ControlClient): UsageApi {
  return Object.freeze({
    async currentMonth(projectId: string) {
      return (
        await client.request(
          `/v1/control/projects/${encodeURIComponent(projectId)}/usage/current-month`,
          CurrentMonthlyUsageResponseSchema,
        )
      ).data;
    },
  });
}
