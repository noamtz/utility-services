import {
  EnabledUtilitiesSchema,
  FileManagementSettingsSchema,
  ProjectNameSchema,
  PublicProjectIdSchema,
  type FileManagementSettings,
} from "@utility-services/contracts";
import { z } from "zod";

export const PROJECT_METADATA_SORT_KEY = "METADATA" as const;
export const FILE_MANAGEMENT_SORT_KEY = "UTILITY#file-management" as const;
export const OWNER_INDEX_NAME = "OwnerProjects" as const;
export const ProjectOperationalStatusSchema = z.enum(["active", "suspended"]);

const TimestampSchema = z.iso.datetime({ offset: true });
const OwnerIdSchema = z.string().trim().min(1).max(2048);

export const InternalProjectSchema = z
  .object({
    internalProjectId: z.uuid(),
    publicProjectId: PublicProjectIdSchema,
    ownerId: OwnerIdSchema,
    name: ProjectNameSchema,
    enabledUtilities: EnabledUtilitiesSchema,
    fileManagement: FileManagementSettingsSchema,
    status: ProjectOperationalStatusSchema.default("active"),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const ProjectMetadataItemSchema = z
  .object({
    pk: z.string().startsWith("PROJECT#"),
    sk: z.literal(PROJECT_METADATA_SORT_KEY),
    gsi1pk: z.string().startsWith("OWNER#"),
    gsi1sk: z.string().startsWith("PROJECT#"),
    itemType: z.literal("project-metadata"),
    internalProjectId: z.uuid(),
    publicProjectId: PublicProjectIdSchema,
    ownerId: OwnerIdSchema,
    name: ProjectNameSchema,
    enabledUtilities: EnabledUtilitiesSchema,
    status: ProjectOperationalStatusSchema.default("active"),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const EnabledUtilityItemSchema = z
  .object({
    pk: z.string().startsWith("PROJECT#"),
    sk: z.literal(FILE_MANAGEMENT_SORT_KEY),
    itemType: z.literal("enabled-utility"),
    utility: z.literal("file-management"),
    uploadUrlLifetimeMinutes: FileManagementSettingsSchema.shape.uploadUrlLifetimeMinutes,
    downloadUrlLifetimeMinutes: FileManagementSettingsSchema.shape.downloadUrlLifetimeMinutes,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export type InternalProject = z.infer<typeof InternalProjectSchema>;
export type ProjectMetadataItem = z.infer<typeof ProjectMetadataItemSchema>;
export type EnabledUtilityItem = z.infer<typeof EnabledUtilityItemSchema>;

export function projectPartitionKey(publicProjectId: string): string {
  return `PROJECT#${PublicProjectIdSchema.parse(publicProjectId)}`;
}

export function ownerPartitionKey(ownerId: string): string {
  return `OWNER#${OwnerIdSchema.parse(ownerId)}`;
}

export function ownerProjectSortKey(createdAt: string, publicProjectId: string): string {
  return `PROJECT#${TimestampSchema.parse(createdAt)}#${PublicProjectIdSchema.parse(publicProjectId)}`;
}

export function parseProjectMetadataItem(input: unknown): ProjectMetadataItem {
  const metadata = ProjectMetadataItemSchema.parse(input);
  if (
    metadata.pk !== projectPartitionKey(metadata.publicProjectId) ||
    metadata.gsi1pk !== ownerPartitionKey(metadata.ownerId) ||
    metadata.gsi1sk !== ownerProjectSortKey(metadata.createdAt, metadata.publicProjectId)
  ) {
    throw new Error("Project metadata keys are inconsistent");
  }
  return metadata;
}

export function toProjectMetadataItem(project: InternalProject): ProjectMetadataItem {
  const parsed = InternalProjectSchema.parse(project);
  return parseProjectMetadataItem({
    pk: projectPartitionKey(parsed.publicProjectId),
    sk: PROJECT_METADATA_SORT_KEY,
    gsi1pk: ownerPartitionKey(parsed.ownerId),
    gsi1sk: ownerProjectSortKey(parsed.createdAt, parsed.publicProjectId),
    itemType: "project-metadata",
    internalProjectId: parsed.internalProjectId,
    publicProjectId: parsed.publicProjectId,
    ownerId: parsed.ownerId,
    name: parsed.name,
    enabledUtilities: parsed.enabledUtilities,
    status: parsed.status,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  });
}

export function toEnabledUtilityItem(
  publicProjectId: string,
  settings: FileManagementSettings,
  createdAt: string,
  updatedAt: string,
): EnabledUtilityItem {
  const parsedSettings = FileManagementSettingsSchema.parse(settings);
  return EnabledUtilityItemSchema.parse({
    pk: projectPartitionKey(publicProjectId),
    sk: FILE_MANAGEMENT_SORT_KEY,
    itemType: "enabled-utility",
    utility: "file-management",
    ...parsedSettings,
    createdAt,
    updatedAt,
  });
}

export function assembleProject(metadataInput: unknown, utilityInput: unknown): InternalProject {
  const metadata = parseProjectMetadataItem(metadataInput);
  const utility = EnabledUtilityItemSchema.parse(utilityInput);
  if (utility.pk !== projectPartitionKey(metadata.publicProjectId)) {
    throw new Error("Project items belong to different partitions");
  }

  return InternalProjectSchema.parse({
    internalProjectId: metadata.internalProjectId,
    publicProjectId: metadata.publicProjectId,
    ownerId: metadata.ownerId,
    name: metadata.name,
    enabledUtilities: metadata.enabledUtilities,
    status: metadata.status,
    fileManagement: {
      uploadUrlLifetimeMinutes: utility.uploadUrlLifetimeMinutes,
      downloadUrlLifetimeMinutes: utility.downloadUrlLifetimeMinutes,
    },
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  });
}
