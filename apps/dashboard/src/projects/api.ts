import {
  CreateProjectRequestSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  type CreateProjectRequest,
  type Project,
  type ProjectListPayload,
  type ProjectListQuery,
} from "@utility-services/contracts";

import { ControlApiError, createControlClient } from "../api/control-client.js";

const PROJECTS_PATH = "/v1/control/projects";
type Fetch = typeof fetch;

export class ProjectApiError extends ControlApiError {}

export interface ProjectApi {
  create: (input: CreateProjectRequest) => Promise<Project>;
  list: (query?: Partial<ProjectListQuery>) => Promise<ProjectListPayload>;
  inspect: (projectId: string) => Promise<Project>;
}

interface ProjectApiDependencies {
  getAccessToken: () => Promise<string>;
  fetch?: Fetch;
}

export function createProjectApi(dependencies: ProjectApiDependencies): ProjectApi {
  const client = createControlClient(dependencies);
  const request = async <T>(
    path: string,
    schema: { parse(value: unknown): T },
    init?: RequestInit,
  ) => {
    try {
      return await client.request(path, schema, init);
    } catch (error) {
      if (error instanceof ControlApiError) {
        throw new ProjectApiError(
          error.message,
          error.statusCode,
          error.code === "INVALID_CONTROL_RESPONSE" ? "INVALID_PROJECT_RESPONSE" : error.code,
        );
      }
      throw error;
    }
  };

  return {
    async create(input) {
      const validated = CreateProjectRequestSchema.parse(input);
      const response = await request(PROJECTS_PATH, ProjectResponseSchema, {
        method: "POST",
        body: JSON.stringify(validated),
      });
      return response.data;
    },
    async list(query = {}) {
      const validated = ProjectListQuerySchema.parse(query);
      const search = new URLSearchParams({ limit: String(validated.limit) });
      if (validated.cursor) search.set("cursor", validated.cursor);
      const response = await request(
        `${PROJECTS_PATH}?${search.toString()}`,
        ProjectListResponseSchema,
      );
      return response.data;
    },
    async inspect(projectId) {
      const response = await request(
        `${PROJECTS_PATH}/${encodeURIComponent(projectId)}`,
        ProjectResponseSchema,
      );
      return response.data;
    },
  };
}
