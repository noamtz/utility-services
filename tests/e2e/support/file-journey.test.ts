import { describe, expect, it, vi } from "vitest";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { bestEffortForceDelete, expectExpiredTransfer, expectPublicError } from "./file-journey.js";

const FILE_ID = "fil_aaaaaaaaaaaaaaaaaaaaaa";

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIResponse {
  return {
    status: () => status,
    headers: () => headers,
    json: () => Promise.resolve(body),
  } as unknown as APIResponse;
}

function errorResponse(message: string): APIResponse {
  return response(404, {
    error: { code: "FILE_NOT_FOUND", message },
    requestId: "release-request",
  });
}

describe("deployed file journey evidence policy", () => {
  it("accepts only a generic shared public error envelope", async () => {
    await expect(
      expectPublicError(errorResponse("The requested file was not found."), 404, [
        "FILE_NOT_FOUND",
      ]),
    ).resolves.toBe("FILE_NOT_FOUND");

    const forbiddenMessages = [
      "Storage bucketName rus-dev-files was unavailable",
      "AWS account 123456789012 rejected the request",
      "objectKey projects/internal/files/file was missing",
      "Authorization Bearer rus_v1.key_fragment.secret_fragment",
      "token eyJhbGciOiJIUzI1NiJ9payload was rejected",
      "Internal record 11111111-1111-4111-8111-111111111111 was missing",
      "Transfer https://files.example.test/object?signature=value failed",
      "RuntimeException: storage failure",
    ];
    for (const message of forbiddenMessages) {
      await expect(
        expectPublicError(errorResponse(message), 404, ["FILE_NOT_FOUND"]),
      ).rejects.toThrow("forbidden implementation evidence");
    }
  });

  it("accepts only the expected S3 denial as expiry evidence", () => {
    expect(() => expectExpiredTransfer(response(403, undefined))).not.toThrow();
    for (const status of [400, 404, 429, 500]) {
      expect(() => expectExpiredTransfer(response(status, undefined))).toThrow("expected denial");
    }
  });

  it("does not report best-effort cleanup complete until purge finishes", async () => {
    const deleteFile = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          data: {
            fileId: FILE_ID,
            disposition: "purge-pending",
            purgeAt: "2026-08-26T10:01:00.000Z",
          },
          requestId: "cleanup-request-1",
        }),
      )
      .mockResolvedValueOnce(response(404, undefined));
    const context = { delete: deleteFile } as unknown as APIRequestContext;

    await expect(bestEffortForceDelete(context, [FILE_ID], 30)).resolves.toBe(true);
    expect(deleteFile).toHaveBeenCalledTimes(2);
  });

  it("reports best-effort cleanup incomplete for invalid purge evidence", async () => {
    const context = {
      delete: vi.fn().mockResolvedValue(response(200, { data: { disposition: "purged" } })),
    } as unknown as APIRequestContext;

    await expect(bestEffortForceDelete(context, [FILE_ID], 30)).resolves.toBe(false);
  });
});
