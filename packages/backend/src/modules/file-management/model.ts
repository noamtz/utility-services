import {
  FileIdSchema,
  FileMediaTypeSchema,
  FileNameSchema,
  FileVisibilitySchema,
  MAX_FILE_SIZE_BYTES,
  PublicFileIdSchema,
  PublicProjectIdSchema,
  type FileVisibility,
} from "@utility-services/contracts";
import { z } from "zod";

export const FILE_SORT_PREFIX = "FILE#" as const;
export const QUOTA_SORT_KEY = "QUOTA" as const;
export const PENDING_UPLOAD_INDEX_PARTITION = "UPLOAD#PENDING" as const;
export const FILE_STORAGE_QUOTA_BYTES = 5n * 2n ** 30n;

const TimestampSchema = z.iso.datetime({ offset: true });
const PositiveBytesSchema = z.bigint().min(1n).max(BigInt(MAX_FILE_SIZE_BYTES));
const DynamoIntegerSchema = z.bigint().min(0n);
const ETagSchema = z.string().trim().min(1).max(256);
const SequencerSchema = z
  .string()
  .regex(/^[A-Fa-f0-9]+$/u)
  .max(128);
const FailureCodeSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u);

export const CompletionEvidenceSchema = z
  .object({
    completedAt: TimestampSchema,
    sizeBytes: PositiveBytesSchema,
    mediaType: FileMediaTypeSchema,
    eTag: ETagSchema,
    sequencer: SequencerSchema.optional(),
  })
  .strict();

export const FileItemSchema = z
  .object({
    pk: z.string().startsWith("PROJECT#"),
    sk: z.string().startsWith(FILE_SORT_PREFIX),
    gsi1pk: z.string().startsWith("PUBLIC_PROJECT#").optional(),
    gsi1sk: z.string().startsWith("PUBLIC_FILE#").optional(),
    gsi2pk: z.literal(PENDING_UPLOAD_INDEX_PARTITION).optional(),
    gsi2sk: z.string().optional(),
    itemType: z.literal("file"),
    internalProjectId: z.uuid(),
    publicProjectId: PublicProjectIdSchema,
    fileId: FileIdSchema,
    publicFileId: PublicFileIdSchema.optional(),
    objectKey: z.string(),
    name: FileNameSchema,
    mediaType: FileMediaTypeSchema,
    sizeBytes: PositiveBytesSchema,
    visibility: FileVisibilitySchema,
    status: z.enum(["pending", "ready", "failed"]),
    uploadExpiresAt: TimestampSchema,
    failureEligibleAt: TimestampSchema,
    completionEvidence: CompletionEvidenceSchema.optional(),
    failureCode: FailureCodeSchema.optional(),
    cleanupRequired: z.boolean().optional(),
    readyAt: TimestampSchema.optional(),
    failedAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    revision: DynamoIntegerSchema,
  })
  .strict();

export const FileQuotaItemSchema = z
  .object({
    pk: z.string().startsWith("PROJECT#"),
    sk: z.literal(QUOTA_SORT_KEY),
    itemType: z.literal("file-quota"),
    internalProjectId: z.uuid(),
    reservedBytes: DynamoIntegerSchema,
    retainedBytes: DynamoIntegerSchema,
    accountedBytes: DynamoIntegerSchema,
    revision: DynamoIntegerSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export type CompletionEvidence = z.infer<typeof CompletionEvidenceSchema>;
export type FileItem = z.infer<typeof FileItemSchema>;
export type FileQuotaItem = z.infer<typeof FileQuotaItemSchema>;

export function fileProjectPartitionKey(internalProjectId: string): string {
  return `PROJECT#${z.uuid().parse(internalProjectId)}`;
}

export function fileSortKey(fileId: string): string {
  return `${FILE_SORT_PREFIX}${FileIdSchema.parse(fileId)}`;
}

export function fileObjectKey(internalProjectId: string, fileId: string): string {
  return `projects/${z.uuid().parse(internalProjectId)}/files/${FileIdSchema.parse(fileId)}`;
}

export function parseFileObjectKey(objectKey: string): {
  readonly internalProjectId: string;
  readonly fileId: string;
} {
  const match = /^projects\/([^/]+)\/files\/([^/]+)$/u.exec(objectKey);
  if (!match) throw new Error("File object key is invalid");
  const internalProjectId = z.uuid().parse(match[1]);
  const fileId = FileIdSchema.parse(match[2]);
  if (fileObjectKey(internalProjectId, fileId) !== objectKey) {
    throw new Error("File object key is invalid");
  }
  return Object.freeze({ internalProjectId, fileId });
}

export function publicFilePartitionKey(publicProjectId: string): string {
  return `PUBLIC_PROJECT#${PublicProjectIdSchema.parse(publicProjectId)}`;
}

export function publicFileSortKey(publicFileId: string): string {
  return `PUBLIC_FILE#${PublicFileIdSchema.parse(publicFileId)}`;
}

export function pendingUploadSortKey(
  failureEligibleAt: string,
  internalProjectId: string,
  fileId: string,
): string {
  return `${TimestampSchema.parse(failureEligibleAt)}#${z.uuid().parse(internalProjectId)}#${FileIdSchema.parse(fileId)}`;
}

function assertPublicKeys(item: FileItem): void {
  const hasAll =
    item.publicFileId !== undefined && item.gsi1pk !== undefined && item.gsi1sk !== undefined;
  if (item.visibility === "public") {
    if (
      !hasAll ||
      item.gsi1pk !== publicFilePartitionKey(item.publicProjectId) ||
      item.gsi1sk !== publicFileSortKey(item.publicFileId!)
    ) {
      throw new Error("Public file identity is inconsistent");
    }
  } else if (
    item.publicFileId !== undefined ||
    item.gsi1pk !== undefined ||
    item.gsi1sk !== undefined
  ) {
    throw new Error("Private file has public identity fields");
  }
}

export function parseFileItem(input: unknown): FileItem {
  const item = FileItemSchema.parse(input);
  if (
    item.pk !== fileProjectPartitionKey(item.internalProjectId) ||
    item.sk !== fileSortKey(item.fileId) ||
    item.objectKey !== fileObjectKey(item.internalProjectId, item.fileId) ||
    new Date(item.failureEligibleAt).getTime() < new Date(item.uploadExpiresAt).getTime()
  ) {
    throw new Error("File keys or expiry are inconsistent");
  }
  assertPublicKeys(item);
  if (item.status === "pending") {
    if (
      item.gsi2pk !== PENDING_UPLOAD_INDEX_PARTITION ||
      item.gsi2sk !==
        pendingUploadSortKey(item.failureEligibleAt, item.internalProjectId, item.fileId) ||
      item.readyAt !== undefined ||
      item.failedAt !== undefined ||
      (item.failureCode === undefined) !== (item.cleanupRequired === undefined)
    ) {
      throw new Error("Pending file state is inconsistent");
    }
  } else if (item.gsi2pk !== undefined || item.gsi2sk !== undefined) {
    throw new Error("Terminal file remains in the pending index");
  } else if (item.status === "ready") {
    if (
      item.completionEvidence === undefined ||
      item.readyAt !== item.completionEvidence.completedAt ||
      item.failedAt !== undefined ||
      item.failureCode !== undefined ||
      item.cleanupRequired !== undefined
    ) {
      throw new Error("Ready file state is inconsistent");
    }
  } else if (
    item.failedAt === undefined ||
    item.failureCode === undefined ||
    item.cleanupRequired !== false ||
    item.readyAt !== undefined
  ) {
    throw new Error("Failed file state is inconsistent");
  }
  return Object.freeze(item);
}

export function parseFileQuotaItem(input: unknown): FileQuotaItem {
  const item = FileQuotaItemSchema.parse(input);
  if (
    item.pk !== fileProjectPartitionKey(item.internalProjectId) ||
    item.accountedBytes !== item.reservedBytes + item.retainedBytes
  ) {
    throw new Error("File quota record is inconsistent");
  }
  return Object.freeze(item);
}

export function createPendingFile(input: {
  internalProjectId: string;
  publicProjectId: string;
  fileId: string;
  publicFileId?: string;
  name: string;
  mediaType: string;
  sizeBytes: bigint;
  visibility: FileVisibility;
  uploadExpiresAt: string;
  failureEligibleAt: string;
  createdAt: string;
}): FileItem {
  const publicFields =
    input.visibility === "public"
      ? {
          publicFileId: PublicFileIdSchema.parse(input.publicFileId),
          gsi1pk: publicFilePartitionKey(input.publicProjectId),
          gsi1sk: publicFileSortKey(PublicFileIdSchema.parse(input.publicFileId)),
        }
      : {};
  return parseFileItem({
    pk: fileProjectPartitionKey(input.internalProjectId),
    sk: fileSortKey(input.fileId),
    gsi2pk: PENDING_UPLOAD_INDEX_PARTITION,
    gsi2sk: pendingUploadSortKey(input.failureEligibleAt, input.internalProjectId, input.fileId),
    itemType: "file",
    internalProjectId: input.internalProjectId,
    publicProjectId: input.publicProjectId,
    fileId: input.fileId,
    objectKey: fileObjectKey(input.internalProjectId, input.fileId),
    name: input.name,
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes,
    visibility: input.visibility,
    status: "pending",
    uploadExpiresAt: input.uploadExpiresAt,
    failureEligibleAt: input.failureEligibleAt,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    revision: 0n,
    ...publicFields,
  });
}
