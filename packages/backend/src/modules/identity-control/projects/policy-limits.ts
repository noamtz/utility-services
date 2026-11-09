import { z } from "zod";

export interface FileManagementPolicyLimits {
  minStorageQuotaBytes: number;
  maxStorageQuotaBytes: number;
  minTrashRetentionDays: number;
  maxTrashRetentionDays: number;
}

const positiveInteger = z.coerce.number().int().positive().safe();

export function readFileManagementPolicyLimits(
  environment: Record<string, string | undefined> = process.env,
): FileManagementPolicyLimits {
  const limits = {
    minStorageQuotaBytes: positiveInteger.parse(
      environment["FILE_POLICY_MIN_STORAGE_BYTES"] ?? 2 ** 30,
    ),
    maxStorageQuotaBytes: positiveInteger.parse(
      environment["FILE_POLICY_MAX_STORAGE_BYTES"] ?? 100 * 2 ** 30,
    ),
    minTrashRetentionDays: positiveInteger.parse(environment["FILE_POLICY_MIN_TRASH_DAYS"] ?? 1),
    maxTrashRetentionDays: positiveInteger.parse(environment["FILE_POLICY_MAX_TRASH_DAYS"] ?? 90),
  };
  if (
    limits.minStorageQuotaBytes > limits.maxStorageQuotaBytes ||
    limits.minTrashRetentionDays > limits.maxTrashRetentionDays ||
    5 * 2 ** 30 < limits.minStorageQuotaBytes ||
    5 * 2 ** 30 > limits.maxStorageQuotaBytes ||
    14 < limits.minTrashRetentionDays ||
    14 > limits.maxTrashRetentionDays
  ) {
    throw new Error("File Management policy limits must include legacy defaults");
  }
  return limits;
}
