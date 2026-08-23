import { unauthorized, type ProjectAuthenticationService } from "./service.js";
import { InvalidProjectBearerError, parseProjectBearer } from "./bearer.js";

export function createProjectAuthorization(service: ProjectAuthenticationService) {
  return async (gatewayEvent: { headers?: Record<string, string> | undefined }) => {
    try {
      return await service.authenticate(parseProjectBearer(gatewayEvent.headers));
    } catch (error) {
      if (error instanceof InvalidProjectBearerError) throw unauthorized();
      throw error;
    }
  };
}
