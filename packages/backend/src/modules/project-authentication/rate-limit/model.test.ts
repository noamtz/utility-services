import { describe, expect, it } from "vitest";

import { createProjectRateLimitWindow } from "./model.js";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("project rate-limit window", () => {
  it("derives deterministic UTC-minute keys, retry, and cleanup TTL", () => {
    const first = createProjectRateLimitWindow(projectId, new Date("2026-08-25T10:00:00.000Z"));
    const last = createProjectRateLimitWindow(projectId, new Date("2026-08-25T10:00:59.999Z"));
    expect(first.pk).toBe(`RATE#${projectId}`);
    expect(first.sk).toBe(last.sk);
    expect(first.retryAfterSeconds).toBe(60);
    expect(last.retryAfterSeconds).toBe(1);
    expect(first.expiresAt).toBeGreaterThan(first.windowMinute * 60);
    expect(
      createProjectRateLimitWindow(projectId, new Date("2026-08-25T10:01:00.000Z")).sk,
    ).not.toBe(first.sk);
  });

  it("rejects invalid project identities and clocks", () => {
    expect(() => createProjectRateLimitWindow("public-id", new Date())).toThrow();
    expect(() => createProjectRateLimitWindow(projectId, new Date("invalid"))).toThrow();
  });
});
