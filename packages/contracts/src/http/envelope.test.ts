import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  ErrorEnvelopeSchema,
  createSuccessEnvelopeSchema,
  type ErrorEnvelope,
  type SuccessEnvelope,
} from "./envelope.js";

describe("HTTP envelopes", () => {
  const WidgetSchema = z.object({ id: z.string() }).strict();
  const SuccessSchema = createSuccessEnvelopeSchema(WidgetSchema);

  it("accepts a valid success envelope", () => {
    const result = SuccessSchema.parse({ data: { id: "widget-1" }, requestId: "request-1" });

    expect(result).toEqual({ data: { id: "widget-1" }, requestId: "request-1" });
    expectTypeOf(result).toEqualTypeOf<SuccessEnvelope<{ id: string }>>();
  });

  it("rejects unexpected success fields", () => {
    expect(
      SuccessSchema.safeParse({
        data: { id: "widget-1", internal: true },
        requestId: "request-1",
        trace: "not-public",
      }).success,
    ).toBe(false);
  });

  it("accepts safe field details in an error envelope", () => {
    const result = ErrorEnvelopeSchema.parse({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ path: "body.name", message: "Required" }],
      },
      requestId: "request-2",
    });

    expect(result.error.details?.[0]?.path).toBe("body.name");
    expectTypeOf(result).toEqualTypeOf<ErrorEnvelope>();
  });

  it.each([
    { error: { code: "bad-code", message: "No" }, requestId: "request-1" },
    { error: { code: "BAD", message: "No", stack: "secret" }, requestId: "request-1" },
    { error: { code: "BAD", message: "No" }, requestId: "contains space" },
  ])("rejects an invalid error envelope", (value) => {
    expect(ErrorEnvelopeSchema.safeParse(value).success).toBe(false);
  });
});
