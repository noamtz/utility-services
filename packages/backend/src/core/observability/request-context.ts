import { randomUUID } from "node:crypto";

import { RequestIdSchema } from "@utility-services/contracts";

export function getAuthoritativeRequestId(event: unknown): string {
  if (typeof event === "object" && event !== null && "requestContext" in event) {
    const requestContext = event.requestContext;
    if (
      typeof requestContext === "object" &&
      requestContext !== null &&
      "requestId" in requestContext
    ) {
      const result = RequestIdSchema.safeParse(requestContext.requestId);
      if (result.success) {
        return result.data;
      }
    }
  }

  return randomUUID();
}
