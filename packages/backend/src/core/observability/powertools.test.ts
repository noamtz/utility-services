import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, safeLogger } from "./powertools.js";

afterEach(() => vi.restoreAllMocks());

describe("safe logger", () => {
  it("redacts sensitive fields and URL queries at the final forwarding boundary", () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    safeLogger.info("safe event", {
      Authorization: "Bearer private",
      nested: { xAmzSignature: "signature", url: "https://example.com/path?secret=value" },
    });
    expect(info).toHaveBeenCalledWith("safe event", {
      Authorization: "[REDACTED]",
      nested: { xAmzSignature: "[REDACTED]", url: "https://example.com/path" },
    });
  });
});
