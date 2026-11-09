import { describe, expect, it } from "vitest";

import { readFileManagementPolicyLimits } from "./policy-limits.js";

describe("File Management policy limits", () => {
  it("uses legacy-compatible defaults when the stage has no overrides", () => {
    expect(readFileManagementPolicyLimits({})).toEqual({
      minStorageQuotaBytes: 2 ** 30,
      maxStorageQuotaBytes: 100 * 2 ** 30,
      minTrashRetentionDays: 1,
      maxTrashRetentionDays: 90,
    });
  });

  it("reads stage overrides", () => {
    expect(
      readFileManagementPolicyLimits({
        FILE_POLICY_MIN_STORAGE_BYTES: String(2 * 2 ** 30),
        FILE_POLICY_MAX_STORAGE_BYTES: String(20 * 2 ** 30),
        FILE_POLICY_MIN_TRASH_DAYS: "2",
        FILE_POLICY_MAX_TRASH_DAYS: "30",
      }),
    ).toEqual({
      minStorageQuotaBytes: 2 * 2 ** 30,
      maxStorageQuotaBytes: 20 * 2 ** 30,
      minTrashRetentionDays: 2,
      maxTrashRetentionDays: 30,
    });
  });

  it("rejects invalid or legacy-incompatible ranges", () => {
    expect(() => readFileManagementPolicyLimits({ FILE_POLICY_MAX_STORAGE_BYTES: "3" })).toThrow();
    expect(() => readFileManagementPolicyLimits({ FILE_POLICY_MIN_TRASH_DAYS: "15" })).toThrow();
    expect(() => readFileManagementPolicyLimits({ FILE_POLICY_MAX_TRASH_DAYS: "1.5" })).toThrow();
  });
});
