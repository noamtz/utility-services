/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- overloaded AWS client test doubles */
import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { createS3ObjectStore, InvalidStoredObjectEvidenceError } from "./object-store.js";

const objectKey = "projects/11111111-1111-4111-8111-111111111111/files/fil_0123456789abcdefghijkl";

describe("S3 object metadata store", () => {
  it("uses HEAD only and returns normalized evidence without bytes", async () => {
    const send = vi.fn().mockResolvedValue({
      ContentLength: 12,
      ContentType: "text/plain",
      ETag: '"etag"',
      LastModified: new Date("2026-08-23T08:00:00.000Z"),
    });
    const store = createS3ObjectStore({
      client: { send } as never,
      bucketName: "private-bucket",
    });
    await expect(store.head(objectKey)).resolves.toEqual({
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
      lastModified: "2026-08-23T08:00:00.000Z",
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(JSON.stringify((send.mock.calls[0]?.[0] as HeadObjectCommand).input)).not.toMatch(
      /Body|GetObject/u,
    );
  });

  it("classifies only 404 as absent and preserves ambiguous failures", async () => {
    const missing = Object.assign(new Error("missing"), { $metadata: { httpStatusCode: 404 } });
    const forbidden = Object.assign(new Error("forbidden"), { $metadata: { httpStatusCode: 403 } });
    const send = vi.fn().mockRejectedValueOnce(missing).mockRejectedValueOnce(forbidden);
    const store = createS3ObjectStore({ client: { send } as never, bucketName: "private-bucket" });
    await expect(store.head(objectKey)).resolves.toBeUndefined();
    await expect(store.head(objectKey)).rejects.toBe(forbidden);
  });

  it("rejects incomplete HEAD evidence and deletes only validated exact keys", async () => {
    const send = vi.fn().mockResolvedValueOnce({ ContentLength: 12 }).mockResolvedValueOnce({});
    const store = createS3ObjectStore({ client: { send } as never, bucketName: "private-bucket" });
    await expect(store.head(objectKey)).rejects.toBeInstanceOf(InvalidStoredObjectEvidenceError);
    await store.delete(objectKey);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    await expect(store.delete("caller/key")).rejects.toThrow();
  });
});
