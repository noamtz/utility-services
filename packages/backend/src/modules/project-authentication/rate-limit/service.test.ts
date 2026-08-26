import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../../core/http/handler.js";
import { createProjectRequestLimiter } from "./service.js";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("project request limiter", () => {
  it("admits repository success and emits deterministic safe 429", async () => {
    const repository = {
      admit: vi.fn().mockResolvedValueOnce("admitted").mockResolvedValueOnce("limited"),
    };
    const limiter = createProjectRequestLimiter({
      repository,
      now: () => new Date("2026-08-25T10:00:30.000Z"),
    });
    await expect(limiter.admit(projectId)).resolves.toBeUndefined();
    const rejection = await limiter.admit(projectId).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(HttpError);
    expect(rejection).toMatchObject({
      statusCode: 429,
      code: "RATE_LIMIT_EXCEEDED",
      retryAfterSeconds: 30,
    });
  });
});
