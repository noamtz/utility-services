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

export interface ProjectService {
  create(owner: OwnerContext, request: CreateProjectRequest): Promise<Project>;
  list(owner: OwnerContext, query: ProjectListQuery): Promise<ProjectListPayload>;
  inspect(owner: OwnerContext, publicProjectId: string): Promise<Project>;
}

export interface ProjectServiceDependencies {
  readonly repository: ProjectRepository;
  readonly generateIds?: () => ProjectIds;
  readonly now?: () => Date;
  readonly collisionAttempts?: number;
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
  if (!Number.isInteger(collisionAttempts) || collisionAttempts < 1 || collisionAttempts > 10) {
    throw new RangeError("collisionAttempts must be an integer between 1 and 10");
  }

  return {
    async create(owner, request) {
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
  };
}
