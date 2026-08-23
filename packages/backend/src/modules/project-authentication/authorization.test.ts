import {
  TrustedProjectContextSchema,
  type TrustedProjectContext,
} from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { createHttpHandler } from "../../core/http/handler.js";
import { createProjectAuthorization } from "./authorization.js";
import { unauthorized, type ProjectAuthenticationService } from "./service.js";

const keyId = "key_0123456789abcdefghijkl";
const apiKey = `rus_v1.${keyId}.${"s".repeat(43)}`;
const context: TrustedProjectContext = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  keyId,
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
};

function event(authorization?: string): unknown {
  return {
    version: "2.0",
    requestContext: {
      requestId: "project-auth-request",
      http: { method: "GET", path: "/v1/future-utility" },
    },
    ...(authorization ? { headers: { Authorization: authorization } } : {}),
  };
}

function body(response: { body?: string | undefined }): unknown {
  return JSON.parse(response.body ?? "null") as unknown;
}

describe("project authorization adapter", () => {
  it("passes only trusted context to a future utility callback", async () => {
    const authenticate = vi.fn().mockResolvedValue(Object.freeze(context));
    const service: ProjectAuthenticationService = { authenticate };
    const callback = vi.fn(({ authorization }: { authorization: typeof context }) => authorization);
    const handler = createHttpHandler({
      schemas: { response: TrustedProjectContextSchema },
      deriveAuthorization: createProjectAuthorization(service),
      callback,
    });

    const response = await handler(event(`Bearer ${apiKey}`));
    expect(response.statusCode).toBe(200);
    expect(authenticate).toHaveBeenCalledWith({ keyId, secret: "s".repeat(43) });
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ authorization: context }));
    expect(body(response)).toEqual({ data: context, requestId: "project-auth-request" });
    expect(JSON.stringify(callback.mock.calls[0]?.[0].authorization)).not.toContain(apiKey);
  });

  it.each([undefined, "Basic invalid", "Bearer invalid"])(
    "maps malformed bearer %s to the shared safe 401 envelope",
    async (header) => {
      const authenticate = vi.fn();
      const handler = createHttpHandler({
        schemas: { response: TrustedProjectContextSchema },
        deriveAuthorization: createProjectAuthorization({ authenticate }),
        callback: ({ authorization }) => authorization,
      });
      const response = await handler(event(header));
      expect(response.statusCode).toBe(401);
      expect(body(response)).toEqual({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
        requestId: "project-auth-request",
      });
      expect(authenticate).not.toHaveBeenCalled();
    },
  );

  it("preserves the service's generic auth rejection", async () => {
    const handler = createHttpHandler({
      schemas: { response: TrustedProjectContextSchema },
      deriveAuthorization: createProjectAuthorization({
        authenticate: vi.fn().mockRejectedValue(unauthorized()),
      }),
      callback: ({ authorization }) => authorization,
    });
    const response = await handler(event(`Bearer ${apiKey}`));
    expect(response.statusCode).toBe(401);
    expect(JSON.stringify(body(response))).not.toContain(apiKey);
  });
});
