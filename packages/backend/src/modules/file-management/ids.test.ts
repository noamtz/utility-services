import { describe, expect, it } from "vitest";

import { generateFileIds } from "./ids.js";

describe("file identifiers", () => {
  it("creates deterministic prefixed base64url identifiers from injected entropy", () => {
    const values = [Buffer.alloc(16, 1), Buffer.alloc(16, 2)];
    const ids = generateFileIds(() => values.shift()!);
    expect(ids).toEqual({
      fileId: "fil_AQEBAQEBAQEBAQEBAQEBAQ",
      publicFileId: "pfil_AgICAgICAgICAgICAgICAg",
    });
    expect(Object.isFrozen(ids)).toBe(true);
  });

  it("rejects entropy with the wrong length", () => {
    expect(() => generateFileIds(() => Buffer.alloc(15))).toThrow(/16 bytes/u);
  });
});
