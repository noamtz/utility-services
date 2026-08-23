import { HealthPayloadSchema } from "@utility-services/contracts";

import { createHttpHandler } from "../core/http/handler.js";
import { safeLogger } from "../core/observability/powertools.js";

export const handler = createHttpHandler({
  schemas: { response: HealthPayloadSchema },
  callback: () => ({ status: "ok" }) as const,
  logger: safeLogger,
});
