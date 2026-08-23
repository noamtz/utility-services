import { describe, expect, it } from "vitest";

import { TrustedProjectContextSchema } from "./project-context.js";

const context = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  keyId: "key_0123456789abcdefghijkl",
  enabledUtilities: ["file-management"],
} as const;

describe("trusted project context", () => {
  it("accepts and preserves only the immutable authorization shape", () => {
    expect(TrustedProjectContextSchema.parse(context)).toEqual(context);
  });

  it.each(["apiKey", "secretHash", "ownerId", "publicProjectId", "authorization", "bucket"])(
    "rejects internal or caller material in %s",
    (field) => {
      expect(
        TrustedProjectContextSchema.safeParse({ ...context, [field]: "private" }).success,
      ).toBe(false);
    },
  );

  it("rejects invalid project, key, and utility values", () => {
    expect(
      TrustedProjectContextSchema.safeParse({ ...context, internalProjectId: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(TrustedProjectContextSchema.safeParse({ ...context, keyId: "not-a-key" }).success).toBe(
      false,
    );
    expect(
      TrustedProjectContextSchema.safeParse({ ...context, enabledUtilities: ["other"] }).success,
    ).toBe(false);
  });
});
