import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  HttpError,
  createHttpHandler,
  createHttpRedirectHandler,
  type ParsedHttpRequest,
} from "./handler.js";

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

  it("derives a trusted authorization value without exposing the gateway event", async () => {
    const callback = vi.fn(
      (
        request: ParsedHttpRequest<undefined, undefined, undefined, undefined, { ownerId: string }>,
      ) => {
        expect(Object.keys(request).sort()).toEqual([
          "authorization",
          "body",
          "headers",
          "path",
          "query",
          "requestId",
        ]);
        expect(request.authorization).toEqual({ ownerId: "owner-1" });
        expect(request).not.toHaveProperty("requestContext");
        return { greeting: "authorized" };
      },
    );
    const deriveAuthorization = vi.fn(() => ({ ownerId: "owner-1" }));
    const handler = createHttpHandler({
      schemas: { response: ResponseSchema },
      deriveAuthorization,
      callback,
    });

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(deriveAuthorization).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("uses an explicit successful status consistently", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = createHttpHandler({
      schemas: { response: ResponseSchema },
      successStatusCode: 201,
      callback: () => ({ greeting: "created" }),
      logger,
    });

    const response = await handler(event());

    expect(response.statusCode).toBe(201);
    expect(logger.info).toHaveBeenCalledWith("http.request.completed", {
      requestId: "gateway-request-1",
      statusCode: 201,
    });
  });

  it.each([199, 300, 200.5, Number.NaN])("rejects invalid success status %s", (statusCode) => {
    expect(() =>
      createHttpHandler({
        schemas: { response: ResponseSchema },
        successStatusCode: statusCode,
        callback: () => ({ greeting: "unused" }),
      }),
    ).toThrow(RangeError);
  });

  it("maps authorization derivation errors through the safe error path", async () => {
    const callback = vi.fn(() => ({ greeting: "unused" }));
    const handler = createHttpHandler({
      schemas: { response: ResponseSchema },
      deriveAuthorization: () => {
        throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
      },
      callback,
    });

    const response = await handler(event());

    expect(response.statusCode).toBe(401);
    expect(parsedBody(response)).toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
      requestId: "gateway-request-1",
    });
    expect(callback).not.toHaveBeenCalled();
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

  it("serializes only a validated retry-after header for throttling", async () => {
    const handler = createHttpHandler({
      schemas: { response: ResponseSchema },
      callback: () => {
        throw new HttpError(
          429,
          "RATE_LIMIT_EXCEEDED",
          "Project request limit exceeded; retry later",
          undefined,
          27,
        );
      },
    });
    const response = await handler(event());
    expect(response.statusCode).toBe(429);
    expect(response.headers).toMatchObject({ "retry-after": "27" });
    expect(() => new HttpError(429, "RATE_LIMIT_EXCEEDED", "retry", undefined, 0)).toThrow();
  });
});

describe("createHttpRedirectHandler", () => {
  const PathSchema = z.object({ publicFileId: z.string().min(1) }).strict();
  const LocationSchema = z.url().startsWith("https://");

  it("returns a fixed non-cacheable redirect with no response body", async () => {
    const location = "https://files.example.com/path?X-Amz-Signature=synthetic";
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = createHttpRedirectHandler({
      schemas: { path: PathSchema, response: LocationSchema },
      callback: ({ path }) => `${location}&file=${path.publicFileId}`,
      logger,
    });

    const response = await handler(
      event({
        requestContext: {
          requestId: "public-request-1",
          http: { method: "GET", path: "/files/public/project/file" },
        },
        pathParameters: { publicFileId: "public-file" },
      }),
    );

    expect(response).toEqual({
      statusCode: 302,
      headers: {
        location: `${location}&file=public-file`,
        "cache-control": "no-store",
        "x-request-id": "public-request-1",
      },
      body: "",
    });
    expect(logger.info).toHaveBeenCalledWith("http.request.started", {
      requestId: "public-request-1",
      method: "GET",
      path: "/files/public/project/file",
    });
    expect(logger.info).toHaveBeenCalledWith("http.request.completed", {
      requestId: "public-request-1",
      statusCode: 302,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("X-Amz-Signature");
  });

  it("uses the shared validation and safe error envelopes", async () => {
    const callback = vi.fn(() => "https://files.example.com/path");
    const invalidPath = createHttpRedirectHandler({
      schemas: { path: PathSchema, response: LocationSchema },
      callback,
    });
    const pathResponse = await invalidPath(event({ pathParameters: {} }));

    expect(pathResponse.statusCode).toBe(400);
    expect(parsedBody(pathResponse)).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
      requestId: "gateway-request-1",
    });
    expect(callback).not.toHaveBeenCalled();

    const serviceFailure = createHttpRedirectHandler({
      schemas: { response: LocationSchema },
      callback: () => {
        throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
      },
    });
    const notFound = await serviceFailure(event());
    expect(notFound.statusCode).toBe(404);
    expect(parsedBody(notFound)).toEqual({
      error: { code: "FILE_NOT_FOUND", message: "File not found" },
      requestId: "gateway-request-1",
    });
  });

  it.each(["http://files.example.com/path", "not-a-url"])(
    "fails closed for an invalid redirect location without logging it: %s",
    async (location) => {
      const logger = { info: vi.fn(), error: vi.fn() };
      const handler = createHttpRedirectHandler({
        schemas: { response: LocationSchema },
        callback: () => location,
        logger,
      });

      const response = await handler(event());

      expect(response.statusCode).toBe(500);
      expect(parsedBody(response)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain(location);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(location);
    },
  );
});
