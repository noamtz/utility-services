import { describe, expect, it } from "vitest";

import { CURRENT_MONTH_USAGE_FRESHNESS_POLICY, currentUtcUsagePeriod } from "./policy.js";

describe("owner usage policy", () => {
  it("derives the current calendar month in UTC", () => {
    expect(currentUtcUsagePeriod(new Date("2026-08-31T23:59:59.999Z"))).toBe("2026-08");
    expect(currentUtcUsagePeriod(new Date("2026-09-01T00:00:00.000Z"))).toBe("2026-09");
  });

  it("requires download metering evidence within 24 hours", () => {
    expect(CURRENT_MONTH_USAGE_FRESHNESS_POLICY).toEqual({
      requiredSources: { "cloudtrail-download": 86_400_000 },
    });
  });

  it("rejects an invalid evaluation time", () => {
    expect(() => currentUtcUsagePeriod(new Date("invalid"))).toThrow(RangeError);
  });
});
