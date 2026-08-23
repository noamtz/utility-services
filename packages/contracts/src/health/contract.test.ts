import { describe, expect, expectTypeOf, it } from "vitest";

import { HealthResponseSchema, type HealthResponse } from "./contract.js";

describe("HealthResponseSchema", () => {
  it("accepts the minimal public health response", () => {
    const response = HealthResponseSchema.parse({
      data: { status: "ok" },
      requestId: "health-request-1",
    });

    expect(response).toEqual({ data: { status: "ok" }, requestId: "health-request-1" });
    expectTypeOf(response).toEqualTypeOf<HealthResponse>();
  });

  it.each([
    { data: { status: "degraded" }, requestId: "request-1" },
    { data: { status: "ok", version: "1.0.0" }, requestId: "request-1" },
    { data: { status: "ok" }, requestId: "request-1", region: "internal" },
  ])("rejects non-contract health data", (value) => {
    expect(HealthResponseSchema.safeParse(value).success).toBe(false);
  });
});
