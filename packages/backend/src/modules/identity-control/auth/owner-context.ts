import { z } from "zod";

import { HttpError } from "../../../core/http/handler.js";

const AuthorizedGatewayEventSchema = z
  .object({
    requestContext: z
      .object({
        authorizer: z
          .object({
            jwt: z
              .object({
                claims: z
                  .object({
                    sub: z.string().trim().min(1),
                    token_use: z.literal("access"),
                  })
                  .passthrough(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export interface OwnerContext {
  readonly ownerId: string;
}

export function extractOwnerContext(gatewayEvent: unknown): OwnerContext {
  const result = AuthorizedGatewayEventSchema.safeParse(gatewayEvent);
  if (!result.success) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }

  return Object.freeze({ ownerId: result.data.requestContext.authorizer.jwt.claims.sub });
}
