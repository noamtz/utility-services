import { ApiKeyIdSchema, PublicProjectIdSchema } from "@utility-services/contracts";
import { z } from "zod";

import type { CredentialOperationalStatus } from "../credentials/model.js";
import {
  CredentialStateConflictError,
  type CredentialRepository,
} from "../credentials/repository.js";
import { ProjectOperationalStatusSchema } from "../projects/model.js";
import { ProjectStateConflictError, type ProjectRepository } from "../projects/repository.js";

export const SuspensionActionSchema = z.enum(["suspend", "resume"]);
export type SuspensionAction = z.infer<typeof SuspensionActionSchema>;

export interface SuspensionResult {
  readonly target: "project" | "key";
  readonly publicProjectId: string;
  readonly keyId?: string;
  readonly previousStatus: "active" | "suspended";
  readonly status: "active" | "suspended";
  readonly changed: boolean;
}

export class SuspensionTargetNotFoundError extends Error {
  public constructor() {
    super("Suspension target not found");
    this.name = "SuspensionTargetNotFoundError";
  }
}

export class SuspensionTerminalStateError extends Error {
  public constructor() {
    super("Terminal credential state cannot be changed");
    this.name = "SuspensionTerminalStateError";
  }
}

export function createSuspensionService(dependencies: {
  readonly projects: Pick<ProjectRepository, "inspect" | "setOperationalStatus">;
  readonly credentials: Pick<CredentialRepository, "inspectMetadata" | "setOperationalStatus">;
  readonly now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());

  function desiredStatus(action: SuspensionAction): "active" | "suspended" {
    return SuspensionActionSchema.parse(action) === "suspend" ? "suspended" : "active";
  }

  async function setProject(publicProjectIdInput: string, action: SuspensionAction) {
    const publicProjectId = PublicProjectIdSchema.parse(publicProjectIdInput);
    const project = await dependencies.projects.inspect(publicProjectId);
    if (!project) throw new SuspensionTargetNotFoundError();
    const previousStatus = ProjectOperationalStatusSchema.parse(project.status);
    const status = desiredStatus(action);
    if (previousStatus === status) {
      return Object.freeze({
        target: "project" as const,
        publicProjectId,
        previousStatus,
        status,
        changed: false,
      });
    }
    try {
      await dependencies.projects.setOperationalStatus(
        publicProjectId,
        previousStatus,
        status,
        now().toISOString(),
      );
    } catch (error) {
      if (!(error instanceof ProjectStateConflictError)) throw error;
      const latest = await dependencies.projects.inspect(publicProjectId);
      if (!latest || latest.status !== status) throw error;
    }
    return Object.freeze({
      target: "project" as const,
      publicProjectId,
      previousStatus,
      status,
      changed: true,
    });
  }

  async function setKey(
    publicProjectIdInput: string,
    keyIdInput: string,
    action: SuspensionAction,
  ) {
    const publicProjectId = PublicProjectIdSchema.parse(publicProjectIdInput);
    const keyId = ApiKeyIdSchema.parse(keyIdInput);
    const metadata = await dependencies.credentials.inspectMetadata(publicProjectId, keyId);
    if (!metadata) throw new SuspensionTargetNotFoundError();
    if (metadata.status !== "active" && metadata.status !== "suspended") {
      throw new SuspensionTerminalStateError();
    }
    const previousStatus: CredentialOperationalStatus = metadata.status;
    const status = desiredStatus(action);
    if (previousStatus === status) {
      return Object.freeze({
        target: "key" as const,
        publicProjectId,
        keyId,
        previousStatus,
        status,
        changed: false,
      });
    }
    try {
      await dependencies.credentials.setOperationalStatus(
        metadata,
        previousStatus,
        status,
        now().toISOString(),
      );
    } catch (error) {
      if (!(error instanceof CredentialStateConflictError)) throw error;
      const latest = await dependencies.credentials.inspectMetadata(publicProjectId, keyId);
      if (!latest || latest.status !== status) throw error;
    }
    return Object.freeze({
      target: "key" as const,
      publicProjectId,
      keyId,
      previousStatus,
      status,
      changed: true,
    });
  }

  return Object.freeze({ setProject, setKey });
}
