import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { HttpError, createHttpHandler } from "./handler.js";

function event(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: "2.0",
    requestContext: {
      requestId: "gateway-request-1",
      http: { method: "POST", path: "/v1/example" },
    },
    headers: {},
    ...overrides,
  };
}

function parsedBody(response: { body?: string | undefined }): unknown {
  return JSON.parse(response.body ?? "null") as unknown;
}

function throwUnknown(value: unknown): never {
  // Deliberately exercise JavaScript's ability to throw non-Error values at the Lambda boundary.
  throw value;
}

describe("createHttpHandler", () => {
  const BodySchema = z.object({ name: z.string().min(1) }).strict();
  const ResponseSchema = z.object({ greeting: z.string() }).strict();

  it("parses declared fields and returns a validated envelope", async () => {
    const callback = vi.fn(({ body }: { body: { name: string } }) => ({
      greeting: `Hello ${body.name}`,
    }));
    const handler = createHttpHandler({
      schemas: { body: BodySchema, response: ResponseSchema },
      callback,
    });

    const response = await handler(event({ body: JSON.stringify({ name: "Ada" }) }));

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "x-request-id": "gateway-request-1",
    });
    expect(parsedBody(response)).toEqual({
      data: { greeting: "Hello Ada" },
      requestId: "gateway-request-1",
    });
  });

  it.each([
    ["malformed JSON", "{", "body"],
    ["schema failure", JSON.stringify({ name: "", extra: true }), "body.name"],
  ])("maps %s to a safe 400 response", async (_name, body, expectedPath) => {
    const handler = createHttpHandler({
      schemas: { body: BodySchema, response: ResponseSchema },
      callback: () => ({ greeting: "unused" }),
    });

    const response = await handler(event({ body }));
    const responseBody = parsedBody(response) as {
      error: { code: string; details: Array<{ path: string }> };
    };

    expect(response.statusCode).toBe(400);
    expect(responseBody.error.code).toBe("VALIDATION_ERROR");
    expect(responseBody.error.details.map((detail) => detail.path)).toContain(expectedPath);
  });

  it("maps known application errors without exposing internals", async () => {
    const handler = createHttpHandler({
      schemas: { response: ResponseSchema },
      callback: () => {
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      },
    });

    const response = await handler(event());

    expect(response.statusCode).toBe(404);
    expect(parsedBody(response)).toEqual({
      error: { code: "NOT_FOUND", message: "Resource not found" },
      requestId: "gateway-request-1",
    });
  });

  it.each([new Error("database password leaked"), "raw failure", { secret: "value" }])(
    "maps unknown failures to the same safe 500 response",
    async (failure) => {
      const logger = { info: vi.fn(), error: vi.fn() };
      const handler = createHttpHandler({
        schemas: { response: ResponseSchema },
        callback: () => throwUnknown(failure),
        logger,
      });

      const response = await handler(event());
      const serialized = JSON.stringify(parsedBody(response));

      expect(response.statusCode).toBe(500);
      expect(serialized).toContain("INTERNAL_ERROR");
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("raw failure");
      expect(serialized).not.toContain("secret");
      expect(logger.error).toHaveBeenCalledWith(
        "http.request.failed",
        expect.objectContaining({ requestId: "gateway-request-1" }),
      );
    },
  );

  it("treats an invalid callback response as an internal error", async () => {
    const handler = createHttpHandler({
      schemas: { response: ResponseSchema },
      callback: () => ({ greeting: "ok", internal: "not allowed" }),
    });

    const response = await handler(event());

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(parsedBody(response))).not.toContain("internal");
  });

  it("generates a fallback request ID and ignores caller headers", async () => {
    const handler = createHttpHandler({
      schemas: { response: ResponseSchema },
      callback: () => ({ greeting: "unused" }),
    });

    const response = await handler({ headers: { "x-request-id": "caller-controlled" } });
    const requestId = (response.headers as Record<string, string>)["x-request-id"];

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toBe("caller-controlled");
  });
});
