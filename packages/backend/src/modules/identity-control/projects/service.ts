import {
  ProjectListPayloadSchema,
  ProjectSchema,
  ProjectSummarySchema,
  type CreateProjectRequest,
  type Project,
  type ProjectListPayload,
  type ProjectListQuery,
} from "@utility-services/contracts";

import { HttpError } from "../../../core/http/handler.js";
import type { OwnerContext } from "../auth/owner-context.js";
import { InvalidProjectCursorError, decodeProjectCursor, encodeProjectCursor } from "./cursor.js";
import { generateProjectIds, type ProjectIds } from "./ids.js";
import { InternalProjectSchema, type InternalProject, type ProjectMetadataItem } from "./model.js";
import { ProjectCollisionError, type ProjectRepository } from "./repository.js";
import { ProjectStateConflictError, StorageQuotaBelowAccountedError } from "./repository.js";
import {
  readFileManagementPolicyLimits,
  type FileManagementPolicyLimits,
} from "./policy-limits.js";

export interface ProjectService {
  create(owner: OwnerContext, request: CreateProjectRequest): Promise<Project>;
  list(owner: OwnerContext, query: ProjectListQuery): Promise<ProjectListPayload>;
  inspect(owner: OwnerContext, publicProjectId: string): Promise<Project>;
  updateFileManagementPolicy(
    owner: OwnerContext,
    publicProjectId: string,
    request: { storageQuotaBytes: number; trashRetentionDays: number },
  ): Promise<Project>;
  policyLimits(): FileManagementPolicyLimits;
}

export interface ProjectServiceDependencies {
  readonly repository: ProjectRepository;
  readonly generateIds?: () => ProjectIds;
  readonly now?: () => Date;
  readonly collisionAttempts?: number;
  readonly policyLimits?: FileManagementPolicyLimits;
}

function toPublicProject(project: InternalProject): Project {
  return ProjectSchema.parse({
    projectId: project.publicProjectId,
    name: project.name,
    enabledUtilities: project.enabledUtilities,
    fileManagement: project.fileManagement,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
}

function toProjectSummary(item: ProjectMetadataItem) {
  return ProjectSummarySchema.parse({
    projectId: item.publicProjectId,
    name: item.name,
    enabledUtilities: item.enabledUtilities,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

function notFound(): HttpError {
  return new HttpError(404, "NOT_FOUND", "Project not found");
}

export function createProjectService(dependencies: ProjectServiceDependencies): ProjectService {
  const generateIds = dependencies.generateIds ?? generateProjectIds;
  const now = dependencies.now ?? (() => new Date());
  const collisionAttempts = dependencies.collisionAttempts ?? 3;
  const policyLimits = dependencies.policyLimits ?? readFileManagementPolicyLimits();
  if (!Number.isInteger(collisionAttempts) || collisionAttempts < 1 || collisionAttempts > 10) {
    throw new RangeError("collisionAttempts must be an integer between 1 and 10");
  }

  return {
    async create(owner, request) {
      if (
        request.fileManagement.storageQuotaBytes < policyLimits.minStorageQuotaBytes ||
        request.fileManagement.storageQuotaBytes > policyLimits.maxStorageQuotaBytes ||
        request.fileManagement.trashRetentionDays < policyLimits.minTrashRetentionDays ||
        request.fileManagement.trashRetentionDays > policyLimits.maxTrashRetentionDays
      ) {
        throw new HttpError(400, "VALIDATION_ERROR", "Project policy is outside allowed limits");
      }
      const timestamp = now().toISOString();
      for (let attempt = 1; attempt <= collisionAttempts; attempt += 1) {
        const ids = generateIds();
        const project = InternalProjectSchema.parse({
          internalProjectId: ids.internalProjectId,
          publicProjectId: ids.publicProjectId,
          ownerId: owner.ownerId,
          name: request.name,
          enabledUtilities: request.enabledUtilities,
          fileManagement: request.fileManagement,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        try {
          await dependencies.repository.create(project);
          return toPublicProject(project);
        } catch (error) {
          if (!(error instanceof ProjectCollisionError)) {
            throw error;
          }
          if (attempt === collisionAttempts) {
            throw new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred");
          }
        }
      }

      throw new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred");
    },

    async list(owner, query) {
      let startAfter;
      if (query.cursor) {
        try {
          startAfter = decodeProjectCursor(query.cursor);
        } catch (error) {
          if (error instanceof InvalidProjectCursorError) {
            throw new HttpError(400, "VALIDATION_ERROR", "Request validation failed", [
              { path: "query.cursor", message: "Project cursor is invalid" },
            ]);
          }
          throw error;
        }
      }

      const result = await dependencies.repository.list({
        ownerId: owner.ownerId,
        limit: query.limit,
        ...(startAfter ? { startAfter } : {}),
      });
      if (result.items.some((item) => item.ownerId !== owner.ownerId)) {
        throw new Error("Repository returned a project for another owner");
      }

      return ProjectListPayloadSchema.parse({
        items: result.items.map(toProjectSummary),
        ...(result.nextCursor ? { nextCursor: encodeProjectCursor(result.nextCursor) } : {}),
      });
    },

    async inspect(owner, publicProjectId) {
      const project = await dependencies.repository.inspect(publicProjectId);
      if (!project || project.ownerId !== owner.ownerId) {
        throw notFound();
      }
      return toPublicProject(project);
    },
    policyLimits() {
      return policyLimits;
    },
    async updateFileManagementPolicy(owner, publicProjectId, request) {
      const project = await dependencies.repository.inspect(publicProjectId);
      if (!project || project.ownerId !== owner.ownerId) {
        throw notFound();
      }
      if (
        request.storageQuotaBytes < policyLimits.minStorageQuotaBytes ||
        request.storageQuotaBytes > policyLimits.maxStorageQuotaBytes ||
        request.trashRetentionDays < policyLimits.minTrashRetentionDays ||
        request.trashRetentionDays > policyLimits.maxTrashRetentionDays
      ) {
        throw new HttpError(400, "VALIDATION_ERROR", "Project policy is outside allowed limits");
      }
      try {
        await dependencies.repository.updateFileManagementPolicy(
          project,
          request,
          now().toISOString(),
        );
      } catch (error) {
        if (error instanceof StorageQuotaBelowAccountedError) {
          throw new HttpError(
            409,
            "STORAGE_QUOTA_BELOW_ACCOUNTED",
            "Storage quota is below current usage",
          );
        }
        if (error instanceof ProjectStateConflictError) {
          throw new HttpError(409, "PROJECT_POLICY_CHANGED", "Project policy changed; retry");
        }
        throw error;
      }
      const updated = await dependencies.repository.inspect(publicProjectId);
      if (!updated || updated.ownerId !== owner.ownerId) {
        throw notFound();
      }
      return toPublicProject(updated);
    },
  };
}
