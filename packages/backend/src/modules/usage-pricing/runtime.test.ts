/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- overloaded Dynamo test double */
import { describe, expect, it, vi } from "vitest";

import { createUsagePricingRuntime } from "./runtime.js";

describe("usage pricing runtime", () => {
  it("validates the linked table and composes the existing service", () => {
    const service = createUsagePricingRuntime({
      tableName: "UsageTable",
      documentClient: { send: vi.fn() } as never,
    });
    expect(service.recordUsage).toBeTypeOf("function");
    expect(service.openStorage).toBeTypeOf("function");
    expect(() =>
      createUsagePricingRuntime({ tableName: "", documentClient: { send: vi.fn() } as never }),
    ).toThrow();
  });
});
