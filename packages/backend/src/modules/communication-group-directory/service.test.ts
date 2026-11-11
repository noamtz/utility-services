import { describe, expect, it, vi } from "vitest";

import { createGroupDirectoryService } from "./service.js";

const context = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_1234567890123456789012",
  keyId: "key_1234567890123456789012",
  enabledUtilities: ["communication"] as ("communication" | "file-management")[],
  fileManagement: {
    uploadUrlLifetimeMinutes: 15,
    downloadUrlLifetimeMinutes: 5,
    storageQuotaBytes: 5_000_000_000,
    trashRetentionDays: 14,
  },
  fileManagementPolicyVersion: 1,
};
const entry = {
  groupId: "group-1",
  presence: "present" as const,
  observedAt: "2026-11-11T12:00:00.000Z",
  sourceObservedAt: null,
  scanComplete: true,
  knownRecordStartAt: "2026-11-11T12:00:00.000Z",
};

describe("group directory service", () => {
  it("scopes list and event reads to the authenticated internal project", async () => {
    const repository = {
      applySnapshot: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [entry] }),
      listEvents: vi.fn().mockResolvedValue({
        items: [{ ...entry, eventId: "scan:group-1", reason: "confirmed-by-group-data" }],
      }),
    };
    const service = createGroupDirectoryService(repository);
    await expect(service.list(context, { limit: 5 })).resolves.toEqual({ items: [entry] });
    await expect(service.events(context, "group-1", { limit: 5 })).resolves.toMatchObject({
      items: [{ groupId: "group-1" }],
    });
    expect(repository.list).toHaveBeenCalledWith(context.internalProjectId, { limit: 5 });
    expect(repository.listEvents).toHaveBeenCalledWith(context.internalProjectId, "group-1", {
      limit: 5,
    });
  });

  it("returns indistinguishable not found for a group outside the project", async () => {
    const service = createGroupDirectoryService({
      applySnapshot: vi.fn(),
      list: vi.fn(),
      listEvents: vi.fn().mockResolvedValue({ items: [] }),
    });
    await expect(
      service.events(context, "other-project-group", { limit: 5 }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
  });

  it("turns a tampered repository cursor into a controlled client error", async () => {
    const service = createGroupDirectoryService({
      applySnapshot: vi.fn(),
      list: vi.fn().mockRejectedValue(new Error("GROUP_CURSOR_INVALID")),
      listEvents: vi.fn(),
    });
    await expect(service.list(context, { limit: 5, cursor: "tampered" })).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_CURSOR",
    });
  });

  it("forwards duplicate and partial snapshots for idempotent durable application", async () => {
    const repository = { applySnapshot: vi.fn(), list: vi.fn(), listEvents: vi.fn() };
    const snapshot = {
      connectionId: "con_1234567890123456789012",
      projectId: context.internalProjectId,
      scanId: "scan-1",
      sequence: 1,
      observedAt: "2026-11-11T12:00:00.000Z",
      complete: false,
      groups: [
        { groupId: "group-1", confirmed: false as const, reason: "provider-error" as const },
      ],
    };
    const service = createGroupDirectoryService(repository);
    await service.applySnapshot(snapshot);
    await service.applySnapshot(snapshot);
    expect(repository.applySnapshot).toHaveBeenCalledTimes(2);
  });
});
