/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await -- inspected Vitest and AWS command test doubles */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { createS3UploadPresigner } from "./presigning.js";

const objectKey = "projects/11111111-1111-4111-8111-111111111111/files/fil_0123456789abcdefghijkl";

describe("S3 upload presigner", () => {
  it("binds exact key, length, type, and conditional write headers", async () => {
    const sign = vi
      .fn()
      .mockImplementation(
        async () =>
          "https://bucket.s3.il-central-1.amazonaws.com/key?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match",
      );
    const client = {} as S3Client;
    const presigner = createS3UploadPresigner({ client, bucketName: "private-bucket", sign });
    const result = await presigner.authorizePut({
      objectKey,
      mediaType: "TEXT/PLAIN",
      sizeBytes: 12n,
      expiresInSeconds: 900,
    });
    expect(result.requiredHeaders).toEqual({
      "content-type": "text/plain",
      "content-length": "12",
      "if-none-match": "*",
    });
    const command = sign.mock.calls[0]?.[1];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toEqual({
      Bucket: "private-bucket",
      Key: objectKey,
      ContentType: "text/plain",
      ContentLength: 12,
      IfNoneMatch: "*",
    });
    expect(sign.mock.calls[0]?.[2]).toMatchObject({ expiresIn: 900 });
  });

  it("proves the installed signer includes every required signed header", async () => {
    const client = new S3Client({
      region: "il-central-1",
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "synthetic-secret" },
    });
    const result = await createS3UploadPresigner({
      client,
      bucketName: "private-bucket",
    }).authorizePut({ objectKey, mediaType: "text/plain", sizeBytes: 12n, expiresInSeconds: 900 });
    expect(new URL(result.url).searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host;if-none-match",
    );
    client.destroy();
  });

  it("rejects caller-like keys and a signer that drops constraints", async () => {
    const sign = vi
      .fn()
      .mockResolvedValue("https://bucket.example.com/key?X-Amz-SignedHeaders=host");
    const presigner = createS3UploadPresigner({
      client: {} as S3Client,
      bucketName: "private-bucket",
      sign,
    });
    await expect(
      presigner.authorizePut({
        objectKey: "caller/key",
        mediaType: "text/plain",
        sizeBytes: 12n,
        expiresInSeconds: 900,
      }),
    ).rejects.toThrow();
    await expect(
      presigner.authorizePut({
        objectKey,
        mediaType: "text/plain",
        sizeBytes: 12n,
        expiresInSeconds: 900,
      }),
    ).rejects.toThrow(/required signed header/u);
  });
});
