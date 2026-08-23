import { z } from "zod";

import { createSuccessEnvelopeSchema } from "../http/envelope.js";
import { PublicProjectIdSchema } from "../projects/contract.js";

export const MAX_FILE_SIZE_BYTES = 100 * 2 ** 20;
export const DEFAULT_FILE_LIST_LIMIT = 20;
export const MAX_FILE_LIST_LIMIT = 50;

export const FileIdSchema = z.string().regex(/^fil_[A-Za-z0-9_-]{22}$/u, "File ID is invalid");
export const PublicFileIdSchema = z
  .string()
  .regex(/^pfil_[A-Za-z0-9_-]{22}$/u, "Public file ID is invalid");
export const FileVisibilitySchema = z.enum(["private", "public"]);
export const FileStatusSchema = z.enum(["pending", "ready", "failed"]);

export const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    "File name contains control characters",
  );

export const FileMediaTypeSchema = z
  .string()
  .trim()
  .min(3)
  .max(127)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u,
    "Media type is invalid",
  )
  .transform((value) => value.toLowerCase());

export const FileSizeBytesSchema = z.number().int().safe().min(1).max(MAX_FILE_SIZE_BYTES);

export const FileCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u, "File cursor is invalid");

export const FileListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_FILE_LIST_LIMIT).default(DEFAULT_FILE_LIST_LIMIT),
    cursor: FileCursorSchema.optional(),
  })
  .strict();

export const FilePathSchema = z.object({ fileId: FileIdSchema }).strict();
export const PublicFilePathSchema = z
  .object({
    publicProjectId: PublicProjectIdSchema,
    publicFileId: PublicFileIdSchema,
  })
  .strict();

const TimestampSchema = z.iso.datetime({ offset: true });

export const FileSchema = z
  .object({
    fileId: FileIdSchema,
    publicFileId: PublicFileIdSchema.optional(),
    name: FileNameSchema,
    mediaType: FileMediaTypeSchema,
    sizeBytes: FileSizeBytesSchema,
    visibility: FileVisibilitySchema,
    status: FileStatusSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((file, context) => {
    if (file.visibility === "public" && file.publicFileId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["publicFileId"],
        message: "Public files require a public file ID",
      });
    }
    if (file.visibility === "private" && file.publicFileId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["publicFileId"],
        message: "Private files cannot have a public file ID",
      });
    }
  });

export const CreateUploadRequestSchema = z
  .object({
    name: FileNameSchema,
    mediaType: FileMediaTypeSchema,
    sizeBytes: FileSizeBytesSchema,
    visibility: FileVisibilitySchema,
  })
  .strict();

export const UploadRequiredHeadersSchema = z
  .object({
    "content-type": FileMediaTypeSchema,
    "content-length": z.string().regex(/^[1-9]\d*$/u),
    "if-none-match": z.literal("*"),
  })
  .strict();

export const UploadAuthorizationSchema = z
  .object({
    file: FileSchema,
    upload: z
      .object({
        method: z.literal("PUT"),
        url: z.url().startsWith("https://"),
        expiresAt: TimestampSchema,
        requiredHeaders: UploadRequiredHeadersSchema,
      })
      .strict(),
  })
  .strict();

export const DownloadTransferSchema = z
  .object({
    method: z.literal("GET"),
    url: z.url().startsWith("https://"),
    expiresAt: TimestampSchema,
  })
  .strict();

export const DownloadAuthorizationSchema = z
  .object({
    file: FileSchema,
    download: DownloadTransferSchema,
  })
  .strict();

export const FileListPayloadSchema = z
  .object({
    items: z.array(FileSchema),
    nextCursor: FileCursorSchema.optional(),
  })
  .strict();

export const FileResponseSchema = createSuccessEnvelopeSchema(FileSchema);
export const FileListResponseSchema = createSuccessEnvelopeSchema(FileListPayloadSchema);
export const UploadAuthorizationResponseSchema =
  createSuccessEnvelopeSchema(UploadAuthorizationSchema);
export const DownloadAuthorizationResponseSchema = createSuccessEnvelopeSchema(
  DownloadAuthorizationSchema,
);

export type FileId = z.infer<typeof FileIdSchema>;
export type PublicFileId = z.infer<typeof PublicFileIdSchema>;
export type FileVisibility = z.infer<typeof FileVisibilitySchema>;
export type FileStatus = z.infer<typeof FileStatusSchema>;
export type File = z.infer<typeof FileSchema>;
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;
export type UploadRequiredHeaders = z.infer<typeof UploadRequiredHeadersSchema>;
export type UploadAuthorization = z.infer<typeof UploadAuthorizationSchema>;
export type DownloadTransfer = z.infer<typeof DownloadTransferSchema>;
export type DownloadAuthorization = z.infer<typeof DownloadAuthorizationSchema>;
export type DownloadAuthorizationResponse = z.infer<typeof DownloadAuthorizationResponseSchema>;
export type FileListQuery = z.infer<typeof FileListQuerySchema>;
export type FileListPayload = z.infer<typeof FileListPayloadSchema>;
export type FilePath = z.infer<typeof FilePathSchema>;
export type PublicFilePath = z.infer<typeof PublicFilePathSchema>;
