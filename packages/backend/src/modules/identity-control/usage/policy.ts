import { UsagePeriodSchema } from "@utility-services/contracts";

import type { FreshnessPolicy } from "../../usage-pricing/service.js";

export const CURRENT_MONTH_USAGE_FRESHNESS_POLICY: FreshnessPolicy = Object.freeze({
  requiredSources: Object.freeze({ "cloudtrail-download": 24 * 60 * 60 * 1000 }),
});

export function currentUtcUsagePeriod(at: Date): string {
  if (Number.isNaN(at.getTime())) {
    throw new RangeError("Usage evaluation time must be valid");
  }
  return UsagePeriodSchema.parse(at.toISOString().slice(0, 7));
}
