import {
  DeleteObjectCommand,
  HeadObjectCommand,
  type DeleteObjectCommandOutput,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { FileMediaTypeSchema } from "@utility-services/contracts";
import { z } from "zod";

import { parseFileObjectKey } from "./model.js";

export interface StoredObjectEvidence {
  readonly sizeBytes: bigint;
  readonly mediaType: string;
  readonly eTag: string;
  readonly lastModified: string;
}

export interface ObjectStore {
  head(objectKey: string): Promise<StoredObjectEvidence | undefined>;
  delete(objectKey: string): Promise<void>;
}

export interface S3ObjectClient {
  send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput>;
  send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput>;
}

export class InvalidStoredObjectEvidenceError extends Error {
  public constructor() {
    super("Stored object metadata is incomplete or invalid");
    this.name = "InvalidStoredObjectEvidenceError";
  }
}

function statusCode(error: unknown): number | undefined {
  if (error === null || typeof error !== "object" || !("$metadata" in error)) return undefined;
  const metadata = error.$metadata;
  if (metadata === null || typeof metadata !== "object" || !("httpStatusCode" in metadata)) {
    return undefined;
  }
  return typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

function normalizedETag(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

export function createS3ObjectStore(options: {
  readonly client: S3ObjectClient;
  readonly bucketName: string;
}): ObjectStore {
  const bucketName = z.string().trim().min(1).parse(options.bucketName);
  return {
    async head(objectKey) {
      parseFileObjectKey(objectKey);
      let output: HeadObjectCommandOutput;
      try {
        output = await options.client.send(
          new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }),
        );
      } catch (error) {
        if (statusCode(error) === 404) return undefined;
        throw error;
      }
      try {
        return Object.freeze({
          sizeBytes: z
            .bigint()
            .positive()
            .parse(BigInt(z.number().int().safe().positive().parse(output.ContentLength))),
          mediaType: FileMediaTypeSchema.parse(output.ContentType),
          eTag: z
            .string()
            .trim()
            .min(1)
            .max(256)
            .parse(normalizedETag(output.ETag ?? "")),
          lastModified: z.iso.datetime({ offset: true }).parse(output.LastModified?.toISOString()),
        });
      } catch {
        throw new InvalidStoredObjectEvidenceError();
      }
    },

    async delete(objectKey) {
      parseFileObjectKey(objectKey);
      try {
        await options.client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: objectKey }));
      } catch (error) {
        if (statusCode(error) !== 404) throw error;
      }
    },
  };
}
