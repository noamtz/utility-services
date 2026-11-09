import { describe, expect, it, vi } from "vitest";

import { createRegisterCommunicationConnectionHandler } from "./handlers.js";
import { createCommunicationConnectionService } from "./service.js";

const event = (body: unknown) => ({
  headers: { authorization: "Bearer owner-token" },
  requestContext: {
    authorizer: { jwt: { claims: { sub: "owner-a", token_use: "access" } } },
    requestId: "request-id",
    http: { method: "POST", path: "/v1/control/projects/project/connections" },
  },
  pathParameters: { projectId: "prj_1234567890123456789012" },
  body: JSON.stringify(body),
});

describe("communication connection handlers", () => {
  it("redacts registration credentials from handler logs and response", async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const service = createCommunicationConnectionService({
      repository: { reserveAndCreate: async () => undefined, inspect: async () => undefined },
      secretStore: { store: async () => ({ reference: "secret-reference", version: 1 }), remove: async () => undefined },
      generateId: () => "con_1234567890123456789012",
      now: () => new Date("2026-11-09T00:00:00.000Z"),
    });
    const response = await createRegisterCommunicationConnectionHandler(service, logger)(
      event({ provider: "green-api", instanceId: "instance-a", credential: "credential-material-that-is-long-enough" }) as never,
    );
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain("credential-material-that-is-long-enough");
    expect(JSON.stringify(logger)).not.toContain("credential-material-that-is-long-enough");
  });
});
