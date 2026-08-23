import {
  CreateProjectRequestSchema,
  ErrorEnvelopeSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  type CreateProjectRequest,
  type Project,
  type ProjectListPayload,
  type ProjectListQuery,
} from "@utility-services/contracts";

const PROJECTS_PATH = "/v1/control/projects";
const SAFE_API_ERROR = "The project request could not be completed. Please try again.";

type Fetch = typeof fetch;

export class ProjectApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code = "PROJECT_REQUEST_FAILED",
  ) {
    super(message);
    this.name = "ProjectApiError";
  }
}

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
  const request = async <T>(
    path: string,
    schema: { parse(value: unknown): T },
    init?: RequestInit,
  ) => {
    let accessToken: string;
    try {
      accessToken = await dependencies.getAccessToken();
    } catch {
      throw new ProjectApiError("Authentication required", 401, "UNAUTHORIZED");
    }
    const response = await (dependencies.fetch ?? globalThis.fetch)(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProjectApiError(SAFE_API_ERROR, response.status);
    }

    if (!response.ok) {
      const parsedError = ErrorEnvelopeSchema.safeParse(body);
      if (parsedError.success) {
        throw new ProjectApiError(
          parsedError.data.error.message,
          response.status,
          parsedError.data.error.code,
        );
      }
      throw new ProjectApiError(SAFE_API_ERROR, response.status);
    }

    try {
      return schema.parse(body);
    } catch {
      throw new ProjectApiError(SAFE_API_ERROR, response.status, "INVALID_PROJECT_RESPONSE");
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
