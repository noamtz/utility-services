import { MetricUnit } from "@aws-lambda-powertools/metrics";
import { describe, expect, it, vi } from "vitest";

import { createInvocationMetrics } from "./metrics.js";

function client() {
  return {
    addDimension: vi.fn(),
    addMetric: vi.fn(),
    publishStoredMetrics: vi.fn(),
    clearMetrics: vi.fn(),
  };
}

describe("operational metrics", () => {
  it("publishes allowlisted metrics with only static low-cardinality dimensions", () => {
    const target = client();
    const invocation = createInvocationMetrics("HttpApi", target, "production");
    invocation.count("HttpRequest", "Success");
    invocation.count("ProjectRateLimitRejection", "Rejected", 2);
    invocation.flush();

    expect(target.addDimension).toHaveBeenCalledWith("Stage", "production");
    expect(target.addDimension).toHaveBeenCalledWith("Operation", "HttpApi");
    expect(target.addDimension).toHaveBeenCalledWith("Outcome", "Success");
    expect(target.addMetric).toHaveBeenNthCalledWith(1, "HttpRequest", MetricUnit.Count, 1);
    expect(target.addMetric).toHaveBeenNthCalledWith(
      2,
      "ProjectRateLimitRejection",
      MetricUnit.Count,
      2,
    );
    expect(target.publishStoredMetrics).toHaveBeenCalledTimes(2);
  });

  it("rejects high-cardinality names and clears state after flush", () => {
    const target = client();
    expect(() => createInvocationMetrics("project/123", target)).toThrow();
    const invocation = createInvocationMetrics("FileWorker", target);
    expect(() => invocation.count("Unknown" as never, "Success")).toThrow();
    expect(() => invocation.count("HttpRequest", "request_123/456")).toThrow();
    invocation.count("HttpRequest", "Success");
    invocation.flush();
    invocation.flush();
    expect(target.publishStoredMetrics).toHaveBeenCalledOnce();
    expect(target.clearMetrics).toHaveBeenCalled();
  });
});
