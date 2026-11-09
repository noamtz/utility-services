import { describe, expect, it } from "vitest";

import {
  CreateProjectRequestSchema,
  DEFAULT_DOWNLOAD_URL_LIFETIME_MINUTES,
  DEFAULT_PROJECT_LIST_LIMIT,
  DEFAULT_STORAGE_QUOTA_BYTES,
  DEFAULT_TRASH_RETENTION_DAYS,
  DEFAULT_UPLOAD_URL_LIFETIME_MINUTES,
  FileManagementPolicyLimitsSchema,
  ProjectListPayloadSchema,
  ProjectListQuerySchema,
  ProjectSchema,
  UpdateFileManagementPolicyRequestSchema,
} from "./contract.js";

const projectId = "prj_0123456789abcdefghijkl";
const timestamp = "2026-08-23T08:00:00.000Z";

describe("project contracts", () => {
  it("trims names and supplies independent File Management defaults", () => {
    const parsed = CreateProjectRequestSchema.parse({
      name: "  Finance exports  ",
      enabledUtilities: ["file-management"],
    });

    expect(parsed).toEqual({
      name: "Finance exports",
      enabledUtilities: ["file-management"],
      fileManagement: {
        uploadUrlLifetimeMinutes: DEFAULT_UPLOAD_URL_LIFETIME_MINUTES,
        downloadUrlLifetimeMinutes: DEFAULT_DOWNLOAD_URL_LIFETIME_MINUTES,
        storageQuotaBytes: DEFAULT_STORAGE_QUOTA_BYTES,
        trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
      },
    });
  });

  it.each([1, 60])("accepts lifetime boundary %i", (value) => {
    expect(
      CreateProjectRequestSchema.parse({
        name: "Boundary",
        enabledUtilities: ["file-management"],
        fileManagement: {
          uploadUrlLifetimeMinutes: value,
          downloadUrlLifetimeMinutes: value,
        },
      }).fileManagement,
    ).toEqual({
      uploadUrlLifetimeMinutes: value,
      downloadUrlLifetimeMinutes: value,
      storageQuotaBytes: DEFAULT_STORAGE_QUOTA_BYTES,
      trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
    });
  });

  it.each([0, 61, 1.5, "15", null])("rejects invalid lifetime %j", (value) => {
    expect(
      CreateProjectRequestSchema.safeParse({
        name: "Invalid",
        enabledUtilities: ["file-management"],
        fileManagement: {
          uploadUrlLifetimeMinutes: value,
          downloadUrlLifetimeMinutes: 5,
        },
      }).success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1073741824"])(
    "rejects an invalid storage quota %j",
    (storageQuotaBytes) => {
      expect(
        UpdateFileManagementPolicyRequestSchema.safeParse({
          storageQuotaBytes,
          trashRetentionDays: 14,
        }).success,
      ).toBe(false);
    },
  );

  it.each([0, -1, 1.5, "14"])("rejects an invalid trash duration %j", (trashRetentionDays) => {
    expect(
      UpdateFileManagementPolicyRequestSchema.safeParse({
        storageQuotaBytes: 5 * 2 ** 30,
        trashRetentionDays,
      }).success,
    ).toBe(false);
  });

  it("accepts only mutable policy fields and validates configured policy limits", () => {
    expect(
      UpdateFileManagementPolicyRequestSchema.parse({
        storageQuotaBytes: 10 * 2 ** 30,
        trashRetentionDays: 30,
      }),
    ).toEqual({ storageQuotaBytes: 10 * 2 ** 30, trashRetentionDays: 30 });
    expect(
      UpdateFileManagementPolicyRequestSchema.safeParse({
        storageQuotaBytes: 10 * 2 ** 30,
        trashRetentionDays: 30,
        uploadUrlLifetimeMinutes: 15,
      }).success,
    ).toBe(false);
    expect(
      FileManagementPolicyLimitsSchema.safeParse({
        minStorageQuotaBytes: 10,
        maxStorageQuotaBytes: 9,
        minTrashRetentionDays: 1,
        maxTrashRetentionDays: 30,
      }).success,
    ).toBe(false);
  });

  it("rejects blank and oversized names, unknown utilities, and extra fields", () => {
    const candidates = [
      { name: "   ", enabledUtilities: ["file-management"] },
      { name: "x".repeat(101), enabledUtilities: ["file-management"] },
      { name: "Example", enabledUtilities: ["usage"] },
      { name: "Example", enabledUtilities: ["file-management"], ownerId: "caller" },
      {
        name: "Example",
        enabledUtilities: ["file-management"],
        fileManagement: { uploadUrlLifetimeMinutes: 15, extra: true },
      },
    ];

    for (const candidate of candidates) {
      expect(CreateProjectRequestSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("parses list defaults and bounded string query values", () => {
    expect(ProjectListQuerySchema.parse({})).toEqual({ limit: DEFAULT_PROJECT_LIST_LIMIT });
    expect(ProjectListQuerySchema.parse({ limit: "50", cursor: "abc_123" })).toEqual({
      limit: 50,
      cursor: "abc_123",
    });
    expect(ProjectListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(ProjectListQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(ProjectListQuerySchema.safeParse({ limit: "1.5" }).success).toBe(false);
    expect(ProjectListQuerySchema.safeParse({ cursor: "not a cursor" }).success).toBe(false);
  });

  it("accepts only the documented public project shape", () => {
    const publicProject = {
      projectId,
      name: "Public contract",
      enabledUtilities: ["file-management"],
      fileManagement: {
        uploadUrlLifetimeMinutes: 15,
        downloadUrlLifetimeMinutes: 5,
        storageQuotaBytes: DEFAULT_STORAGE_QUOTA_BYTES,
        trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(ProjectSchema.parse(publicProject)).toEqual(publicProject);
    expect(
      ProjectSchema.safeParse({
        ...publicProject,
        ownerId: "owner-secret",
        internalProjectId: "internal-secret",
        pk: "PROJECT#secret",
      }).success,
    ).toBe(false);
  });

  it("keeps list rows summary-only and validates the optional cursor", () => {
    const result = ProjectListPayloadSchema.safeParse({
      items: [
        {
          projectId,
          name: "Summary",
          enabledUtilities: ["file-management"],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      nextCursor: "next_page",
    });

    expect(result.success).toBe(true);
    expect(
      ProjectListPayloadSchema.safeParse({
        items: [],
        internalProjectId: "must-not-leak",
      }).success,
    ).toBe(false);
  });
});
