/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await -- inspected Vitest and AWS command test doubles */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { createS3DownloadPresigner, createS3UploadPresigner } from "./presigning.js";

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

describe("S3 download presigner", () => {
  it.each([60, 300, 3_600])("signs an exact GET with a %d second lifetime", async (expiresIn) => {
    const sign = vi
      .fn()
      .mockResolvedValue("https://bucket.s3.il-central-1.amazonaws.com/key?X-Amz-Expires=300");
    const presigner = createS3DownloadPresigner({
      client: {} as S3Client,
      bucketName: "private-bucket",
      sign,
    });

    await expect(
      presigner.authorizeGet({ objectKey, expiresInSeconds: expiresIn }),
    ).resolves.toEqual({
      url: "https://bucket.s3.il-central-1.amazonaws.com/key?X-Amz-Expires=300",
    });
    const command = sign.mock.calls[0]?.[1];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect((command as GetObjectCommand).input).toEqual({
      Bucket: "private-bucket",
      Key: objectKey,
    });
    expect((command as GetObjectCommand).input).not.toHaveProperty("Range");
    expect((command as GetObjectCommand).input).not.toHaveProperty("ResponseContentDisposition");
    expect(sign.mock.calls[0]?.[2]).toEqual({ expiresIn });
  });

  it("proves the installed signer uses the requested expiry without fixing Range", async () => {
    const client = new S3Client({
      region: "il-central-1",
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "synthetic-secret" },
    });
    const result = await createS3DownloadPresigner({
      client,
      bucketName: "private-bucket",
    }).authorizeGet({ objectKey, expiresInSeconds: 300 });

    const url = new URL(result.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    client.destroy();
  });

  it.each([
    { objectKey: "caller/key", expiresInSeconds: 300 },
    { objectKey, expiresInSeconds: 59 },
    { objectKey, expiresInSeconds: 3_601 },
    { objectKey, expiresInSeconds: 300.5 },
  ])("rejects invalid download input %#", async (input) => {
    const presigner = createS3DownloadPresigner({
      client: {} as S3Client,
      bucketName: "private-bucket",
      sign: vi.fn().mockResolvedValue("https://bucket.example.com/key"),
    });
    await expect(presigner.authorizeGet(input)).rejects.toThrow();
  });

  it.each(["http://bucket.example.com/key", "not-a-url"])(
    "rejects an unsafe signer result: %s",
    async (url) => {
      const presigner = createS3DownloadPresigner({
        client: {} as S3Client,
        bucketName: "private-bucket",
        sign: vi.fn().mockResolvedValue(url),
      });
      await expect(presigner.authorizeGet({ objectKey, expiresInSeconds: 300 })).rejects.toThrow();
    },
  );
});
