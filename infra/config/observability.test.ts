import { describe, expect, it } from "vitest";

import {
  CUSTOM_ALARM_POLICIES,
  OBSERVABILITY_PERIOD_SECONDS,
  OBSERVABILITY_THRESHOLDS,
} from "./observability.js";

describe("observability alarm policy", () => {
  it("centralizes the approved five-minute MVP thresholds", () => {
    expect(OBSERVABILITY_PERIOD_SECONDS).toBe(300);
    expect(OBSERVABILITY_THRESHOLDS).toMatchObject({
      authenticationFailures: 5,
      rateLimitRejections: 1,
      apiRequests: 1_200,
      meteringQueueAgeSeconds: 900,
      deadLetterMessages: 1,
    });
  });

  it("uses exact low-cardinality metric dimensions and explicit missing-data policy", () => {
    expect(CUSTOM_ALARM_POLICIES).toHaveLength(11);
    expect(CUSTOM_ALARM_POLICIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: "ProjectAuthenticationFailure",
          threshold: 5,
          treatMissingData: "notBreaching",
        }),
        expect.objectContaining({
          metricName: "MeteringFreshnessCheckSuccess",
          comparisonOperator: "LessThanThreshold",
          treatMissingData: "breaching",
        }),
        expect.objectContaining({
          metricName: "MeteringStaleWatermarks",
          evaluationPeriods: 2,
        }),
      ]),
    );
    expect(CUSTOM_ALARM_POLICIES.every((policy) => policy.operation.length > 0)).toBe(true);
  });
});
