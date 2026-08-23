import { z } from "zod";

import { createSuccessEnvelopeSchema } from "../http/envelope.js";

export const FILE_MANAGEMENT_UTILITY = "file-management" as const;
export const DEFAULT_UPLOAD_URL_LIFETIME_MINUTES = 15;
export const DEFAULT_DOWNLOAD_URL_LIFETIME_MINUTES = 5;
export const DEFAULT_PROJECT_LIST_LIMIT = 20;
export const MAX_PROJECT_LIST_LIMIT = 50;

export const PublicProjectIdSchema = z
  .string()
  .regex(/^prj_[A-Za-z0-9_-]{22}$/, "Project ID is invalid");

export const ProjectNameSchema = z.string().trim().min(1).max(100);

export const EnabledUtilitiesSchema = z.tuple([z.literal(FILE_MANAGEMENT_UTILITY)]);

const UrlLifetimeMinutesSchema = z.number().int().min(1).max(60);

export const FileManagementSettingsSchema = z
  .object({
    uploadUrlLifetimeMinutes: UrlLifetimeMinutesSchema.default(DEFAULT_UPLOAD_URL_LIFETIME_MINUTES),
    downloadUrlLifetimeMinutes: UrlLifetimeMinutesSchema.default(
      DEFAULT_DOWNLOAD_URL_LIFETIME_MINUTES,
    ),
  })
  .strict();

export const CreateProjectRequestSchema = z
  .object({
    name: ProjectNameSchema,
    enabledUtilities: EnabledUtilitiesSchema,
    fileManagement: FileManagementSettingsSchema.prefault({}),
  })
  .strict();

export const ProjectCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/, "Project cursor is invalid");

export const ProjectListQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PROJECT_LIST_LIMIT)
      .default(DEFAULT_PROJECT_LIST_LIMIT),
    cursor: ProjectCursorSchema.optional(),
  })
  .strict();

export const ProjectPathSchema = z.object({ projectId: PublicProjectIdSchema }).strict();

const TimestampSchema = z.iso.datetime({ offset: true });

export const ProjectSummarySchema = z
  .object({
    projectId: PublicProjectIdSchema,
    name: ProjectNameSchema,
    enabledUtilities: EnabledUtilitiesSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const ProjectSchema = ProjectSummarySchema.extend({
  fileManagement: FileManagementSettingsSchema,
}).strict();

export const ProjectListPayloadSchema = z
  .object({
    items: z.array(ProjectSummarySchema),
    nextCursor: ProjectCursorSchema.optional(),
  })
  .strict();

export const ProjectResponseSchema = createSuccessEnvelopeSchema(ProjectSchema);
export const ProjectListResponseSchema = createSuccessEnvelopeSchema(ProjectListPayloadSchema);

export type FileManagementSettings = z.infer<typeof FileManagementSettingsSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
export type ProjectPath = z.infer<typeof ProjectPathSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectListPayload = z.infer<typeof ProjectListPayloadSchema>;
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
