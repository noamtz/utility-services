import { describe, expect, it } from "vitest";

import { handler } from "./health.js";

describe("health handler", () => {
  it("returns only the public health contract with authoritative correlation", async () => {
    const response = await handler({
      version: "2.0",
      requestContext: {
        requestId: "health-request-1",
        http: { method: "GET", path: "/v1/health" },
      },
      headers: {},
    });

    expect(response).toMatchObject({
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-request-id": "health-request-1",
      },
    });
    expect(JSON.parse(response.body ?? "null")).toEqual({
      data: { status: "ok" },
      requestId: "health-request-1",
    });
    expect(response.body).not.toMatch(/version|region|environment|function|bucket/i);
  });
});
