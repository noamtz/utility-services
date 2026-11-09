import { describe, expect, it } from "vitest";

import {
  CommunicationConnectionSchema,
  CreateCommunicationConnectionRequestSchema,
} from "./contract.js";

describe("communication connection contract", () => {
  it("accepts a bounded provider registration request", () => {
    expect(
      CreateCommunicationConnectionRequestSchema.parse({
        provider: "green-api",
        instanceId: "instance-123",
        credential: "credential-material-that-is-long-enough",
      }),
    ).toMatchObject({ provider: "green-api", instanceId: "instance-123" });
  });

  it("does not permit credential material in the project-visible connection state", () => {
    expect(
      CommunicationConnectionSchema.safeParse({
        connectionId: "con_1234567890123456789012",
        projectId: "prj_1234567890123456789012",
        provider: "green-api",
        instanceId: "instance-123",
        status: "active",
        credential: "credential-material-that-is-long-enough",
        createdAt: "2026-11-09T00:00:00.000Z",
        updatedAt: "2026-11-09T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
