import { describe, expect, it, vi } from "vitest";

import { generateProjectIds } from "./ids.js";

describe("generateProjectIds", () => {
  it("uses independent injected entropy sources", () => {
    const createUuid = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    const createRandomBytes = vi.fn(() => Buffer.alloc(16, 7));

    expect(generateProjectIds({ createUuid, createRandomBytes })).toEqual({
      internalProjectId: "11111111-1111-4111-8111-111111111111",
      publicProjectId: "prj_BwcHBwcHBwcHBwcHBwcHBw",
    });
    expect(createUuid).toHaveBeenCalledOnce();
    expect(createRandomBytes).toHaveBeenCalledWith(16);
  });

  it("creates opaque IDs without accepting caller input", () => {
    const ids = generateProjectIds();

    expect(ids.internalProjectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids.publicProjectId).toMatch(/^prj_[A-Za-z0-9_-]{22}$/);
    expect(ids.publicProjectId).not.toContain(ids.internalProjectId);
    expect(Object.isFrozen(ids)).toBe(true);
  });

  it("rejects invalid entropy output", () => {
    expect(() =>
      generateProjectIds({
        createUuid: () => "not-a-uuid",
        createRandomBytes: () => Buffer.alloc(16),
      }),
    ).toThrow();
    expect(() =>
      generateProjectIds({
        createUuid: () => "11111111-1111-4111-8111-111111111111",
        createRandomBytes: () => Buffer.alloc(8),
      }),
    ).toThrow("invalid length");
  });
});
