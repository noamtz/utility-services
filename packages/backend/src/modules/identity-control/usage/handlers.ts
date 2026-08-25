import { MonthlyUsageProjectionSchema, ProjectPathSchema } from "@utility-services/contracts";

import { createHttpHandler, type SafeLogger } from "../../../core/http/handler.js";
import { extractOwnerContext } from "../auth/owner-context.js";
import type { OwnerUsageService } from "./service.js";

export function createGetCurrentMonthUsageHandler(service: OwnerUsageService, logger?: SafeLogger) {
  return createHttpHandler({
    schemas: { path: ProjectPathSchema, response: MonthlyUsageProjectionSchema },
    deriveAuthorization: extractOwnerContext,
    callback: ({ authorization, path }) => service.currentMonth(authorization, path.projectId),
    ...(logger ? { logger } : {}),
  });
}
