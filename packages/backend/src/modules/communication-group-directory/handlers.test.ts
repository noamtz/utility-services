import { describe, expect, it, vi } from "vitest";
import type { ProjectAuthenticationService } from "../project-authentication/service.js";
import { createListGroupEventsHandler, createListGroupsHandler } from "./handlers.js";
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
const event = (path: string, query?: Record<string, string>, params?: Record<string, string>) => ({
  requestContext: { requestId: "request-1", http: { method: "GET", path } },
  headers: { authorization: `Bearer rus_v1.${context.keyId}.${"s".repeat(43)}` },
  ...(query ? { queryStringParameters: query } : {}),
  ...(params ? { pathParameters: params } : {}),
});

function authentication(): ProjectAuthenticationService {
  return { authenticate: vi.fn().mockResolvedValue(context) };
}

describe("group directory HTTP handlers", () => {
  it("uses project-key authentication and returns bounded list envelopes", async () => {
    const repository = {
      applySnapshot: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [entry] }),
      listEvents: vi.fn().mockResolvedValue({
        items: [{ ...entry, eventId: "scan:group-1", reason: "confirmed-by-group-data" }],
      }),
    };
    const response = await createListGroupsHandler(
      createGroupDirectoryService(repository),
      authentication(),
    )(event("/v1/communication/groups", { limit: "1" }));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      data: { items: [{ groupId: "group-1" }] },
    });
  });

  it("rejects invalid pagination and returns not found for wrong-project events", async () => {
    const repository = {
      applySnapshot: vi.fn(),
      list: vi.fn(),
      listEvents: vi.fn().mockResolvedValue({ items: [] }),
    };
    const service = createGroupDirectoryService(repository);
    const invalid = await createListGroupsHandler(
      service,
      authentication(),
    )(event("/v1/communication/groups", { limit: "101" }));
    expect(invalid.statusCode).toBe(400);
    const missing = await createListGroupEventsHandler(
      service,
      authentication(),
    )(event("/v1/communication/groups/group-2/events", undefined, { groupId: "group-2" }));
    expect(missing.statusCode).toBe(404);
  });

  it("uses the safe logger path without exposing project credentials", async () => {
    const repository = {
      applySnapshot: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [] }),
      listEvents: vi.fn().mockResolvedValue({ items: [] }),
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const service = createGroupDirectoryService(repository);
    await createListGroupsHandler(
      service,
      authentication(),
      logger,
    )(event("/v1/communication/groups"));
    await createListGroupEventsHandler(
      service,
      authentication(),
      logger,
    )(event("/v1/communication/groups/group-1/events", undefined, { groupId: "group-1" }));
    expect(logger.info).toHaveBeenCalled();
  });
});
