import { describe, expect, it, vi } from "vitest";

import { CredentialStateConflictError } from "../credentials/repository.js";
import type { InternalProject } from "../projects/model.js";
import { ProjectStateConflictError } from "../projects/repository.js";
import {
  SuspensionTargetNotFoundError,
  SuspensionTerminalStateError,
  createSuspensionService,
} from "./suspension.js";

const publicProjectId = "prj_0123456789abcdefghijkl";
const keyId = "key_0123456789abcdefghijkl";
const project = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId,
  ownerId: "owner-1",
  name: "Operations project",
  status: "active",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
} as const satisfies InternalProject;

function setup() {
  const projects = {
    inspect: vi.fn().mockResolvedValue(project),
    setOperationalStatus: vi.fn().mockResolvedValue(undefined),
  };
  const credentials = {
    inspectMetadata: vi.fn().mockResolvedValue({
      pk: `PROJECT#${publicProjectId}`,
      sk: `API_KEY#${keyId}`,
      itemType: "api-key-metadata",
      internalProjectId: project.internalProjectId,
      publicProjectId,
      keyId,
      status: "active",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }),
    setOperationalStatus: vi.fn().mockResolvedValue(undefined),
  };
  const service = createSuspensionService({
    projects,
    credentials,
    now: () => new Date("2026-08-25T10:00:00.000Z"),
  });
  return { projects, credentials, service };
}

describe("suspension service", () => {
  it("suspends projects and treats repeated desired state idempotently", async () => {
    const { projects, service } = setup();
    await expect(service.setProject(publicProjectId, "suspend")).resolves.toMatchObject({
      target: "project",
      status: "suspended",
      changed: true,
    });
    expect(projects.setOperationalStatus).toHaveBeenCalledWith(
      publicProjectId,
      "active",
      "suspended",
      "2026-08-25T10:00:00.000Z",
    );

    projects.inspect.mockResolvedValue({ ...project, status: "suspended" });
    await expect(service.setProject(publicProjectId, "suspend")).resolves.toMatchObject({
      changed: false,
    });
  });

  it("suspends and resumes reversible key state", async () => {
    const { credentials, service } = setup();
    await expect(service.setKey(publicProjectId, keyId, "suspend")).resolves.toMatchObject({
      target: "key",
      status: "suspended",
    });
    expect(credentials.setOperationalStatus).toHaveBeenCalledWith(
      expect.objectContaining({ keyId }),
      "active",
      "suspended",
      "2026-08-25T10:00:00.000Z",
    );
  });

  it("fails safely for missing and terminal targets", async () => {
    const { credentials, projects, service } = setup();
    projects.inspect.mockResolvedValue(undefined);
    await expect(service.setProject(publicProjectId, "suspend")).rejects.toBeInstanceOf(
      SuspensionTargetNotFoundError,
    );
    credentials.inspectMetadata.mockResolvedValue({ status: "revoked" });
    await expect(service.setKey(publicProjectId, keyId, "resume")).rejects.toBeInstanceOf(
      SuspensionTerminalStateError,
    );
  });

  it("accepts a concurrent transition only when the desired state won", async () => {
    const { credentials, projects, service } = setup();
    projects.setOperationalStatus.mockRejectedValue(new ProjectStateConflictError());
    projects.inspect
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce({ ...project, status: "suspended" });
    await expect(service.setProject(publicProjectId, "suspend")).resolves.toMatchObject({
      status: "suspended",
    });

    credentials.setOperationalStatus.mockRejectedValue(new CredentialStateConflictError());
    credentials.inspectMetadata
      .mockResolvedValueOnce({ status: "active", keyId, publicProjectId })
      .mockResolvedValueOnce({ status: "active", keyId, publicProjectId });
    await expect(service.setKey(publicProjectId, keyId, "suspend")).rejects.toBeInstanceOf(
      CredentialStateConflictError,
    );
  });
});
