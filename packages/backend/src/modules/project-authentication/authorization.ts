import { unauthorized, type ProjectAuthenticationService } from "./service.js";
import { InvalidProjectBearerError, parseProjectBearer } from "./bearer.js";
import { EnabledUtilitiesSchema } from "@utility-services/contracts";
import type { z } from "zod";

type EnabledUtility = z.infer<typeof EnabledUtilitiesSchema>[number];

export function createProjectAuthorization(
  service: ProjectAuthenticationService,
  requiredUtility?: EnabledUtility,
) {
  return async (gatewayEvent: { headers?: Record<string, string> | undefined }) => {
    try {
      const context = await service.authenticate(parseProjectBearer(gatewayEvent.headers));
      if (requiredUtility && !context.enabledUtilities.includes(requiredUtility))
        throw unauthorized();
      return context;
    } catch (error) {
      if (error instanceof InvalidProjectBearerError) throw unauthorized();
      throw error;
    }
  };
}
