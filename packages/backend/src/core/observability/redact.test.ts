import { describe, expect, it } from "vitest";

import { redactSensitiveValues } from "./redact.js";

describe("redactSensitiveValues", () => {
  it("redacts sensitive keys case-insensitively at every depth", () => {
    const input = {
      Authorization: "Bearer secret",
      nested: {
        apiKey: "key",
        "X-API-Key": "other-key",
        values: [{ TOKEN: "token" }, { password: "password" }],
      },
    };

    expect(redactSensitiveValues(input)).toEqual({
      Authorization: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        "X-API-Key": "[REDACTED]",
        values: [{ TOKEN: "[REDACTED]" }, { password: "[REDACTED]" }],
      },
    });
  });

  it("removes URL credentials, query strings, and fragments", () => {
    expect(
      redactSensitiveValues({
        safe: "https://user:pass@example.com/files/id?X-Amz-Signature=secret#fragment",
        queryOnly: "?token=secret",
        fragmentOnly: "#secret",
        ordinary: "not a URL?still-text",
      }),
    ).toEqual({
      safe: "https://example.com/files/id",
      queryOnly: "[REDACTED]",
      fragmentOnly: "[REDACTED]",
      ordinary: "not a URL?still-text",
    });
  });

  it("does not mutate the original value", () => {
    const input = { nested: { token: "secret", safe: "value" } };

    const output = redactSensitiveValues(input);

    expect(output).not.toBe(input);
    expect(input).toEqual({ nested: { token: "secret", safe: "value" } });
  });

  it("bounds circular, deep, and non-plain input", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    expect(redactSensitiveValues(circular)).toEqual({ self: "[CIRCULAR]" });
    expect(redactSensitiveValues({ one: { two: { three: "value" } } }, 2)).toEqual({
      one: { two: "[MAX_DEPTH]" },
    });
    expect(redactSensitiveValues({ date: new Date("2026-01-01T00:00:00Z") })).toEqual({
      date: "[NON_PLAIN_OBJECT]",
    });
  });

  it("redacts future transfer URL fields completely", () => {
    expect(
      redactSensitiveValues({
        presignedUrl: "https://example.com/safe-path",
        upload_url: "https://example.com/another-path",
      }),
    ).toEqual({ presignedUrl: "[REDACTED]", upload_url: "[REDACTED]" });
  });
});
