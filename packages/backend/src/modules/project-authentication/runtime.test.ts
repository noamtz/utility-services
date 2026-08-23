/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/unbound-method -- overloaded Dynamo test double */
import { describe, expect, it, vi } from "vitest";

import { createProjectAuthenticationRuntime } from "./runtime.js";

describe("project authentication runtime", () => {
  it("validates the linked table and composes the existing service", () => {
    const service = createProjectAuthenticationRuntime({
      tableName: "ControlTable",
      documentClient: { send: vi.fn() } as never,
    });
    expect(service.authenticate).toBeTypeOf("function");
    expect(() =>
      createProjectAuthenticationRuntime({
        tableName: " ",
        documentClient: { send: vi.fn() } as never,
      }),
    ).toThrow();
  });
});
