import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  FileMediaTypeSchema,
  UploadRequiredHeadersSchema,
  type UploadRequiredHeaders,
} from "@utility-services/contracts";
import { z } from "zod";

import { parseFileObjectKey } from "./model.js";

const SIGNED_UPLOAD_HEADERS = new Set(["content-length", "content-type", "if-none-match"]);

export interface PresignedUpload {
  readonly url: string;
  readonly requiredHeaders: UploadRequiredHeaders;
}

export interface UploadPresigner {
  authorizePut(input: {
    readonly objectKey: string;
    readonly mediaType: string;
    readonly sizeBytes: bigint;
    readonly expiresInSeconds: number;
  }): Promise<PresignedUpload>;
}

export interface PresignedDownload {
  readonly url: string;
}

export interface DownloadPresigner {
  authorizeGet(input: {
    readonly objectKey: string;
    readonly expiresInSeconds: number;
  }): Promise<PresignedDownload>;
}

function parseExpiresInSeconds(value: number): number {
  return z.number().int().min(60).max(3_600).parse(value);
}

export function createS3UploadPresigner(options: {
  readonly client: S3Client;
  readonly bucketName: string;
  readonly sign?: typeof getSignedUrl;
}): UploadPresigner {
  const bucketName = z.string().trim().min(1).parse(options.bucketName);
  const sign = options.sign ?? getSignedUrl;

  return {
    async authorizePut(input) {
      parseFileObjectKey(input.objectKey);
      const mediaType = FileMediaTypeSchema.parse(input.mediaType);
      const sizeBytes = z
        .bigint()
        .positive()
        .max(BigInt(Number.MAX_SAFE_INTEGER))
        .parse(input.sizeBytes);
      const expiresInSeconds = parseExpiresInSeconds(input.expiresInSeconds);
      const requiredHeaders = UploadRequiredHeadersSchema.parse({
        "content-type": mediaType,
        "content-length": sizeBytes.toString(),
        "if-none-match": "*",
      });
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: input.objectKey,
        ContentType: mediaType,
        ContentLength: Number(sizeBytes),
        IfNoneMatch: "*",
      });
      const url = await sign(options.client, command, {
        expiresIn: expiresInSeconds,
        signableHeaders: SIGNED_UPLOAD_HEADERS,
        unhoistableHeaders: SIGNED_UPLOAD_HEADERS,
      });
      const parsedUrl = z.url().startsWith("https://").parse(url);
      const signedHeaders = new Set(
        new URL(parsedUrl).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [],
      );
      if ([...SIGNED_UPLOAD_HEADERS].some((header) => !signedHeaders.has(header))) {
        throw new Error("Presigned upload omitted a required signed header");
      }
      return Object.freeze({ url: parsedUrl, requiredHeaders });
    },
  };
}

export function createS3DownloadPresigner(options: {
  readonly client: S3Client;
  readonly bucketName: string;
  readonly sign?: typeof getSignedUrl;
}): DownloadPresigner {
  const bucketName = z.string().trim().min(1).parse(options.bucketName);
  const sign = options.sign ?? getSignedUrl;

  return {
    async authorizeGet(input) {
      parseFileObjectKey(input.objectKey);
      const expiresInSeconds = parseExpiresInSeconds(input.expiresInSeconds);
      const command = new GetObjectCommand({ Bucket: bucketName, Key: input.objectKey });
      const url = await sign(options.client, command, { expiresIn: expiresInSeconds });
      return Object.freeze({ url: z.url().startsWith("https://").parse(url) });
    },
  };
}
