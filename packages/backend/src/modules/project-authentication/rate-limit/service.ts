import { HttpError } from "../../../core/http/handler.js";
import { createProjectRateLimitWindow } from "./model.js";
import type { ProjectRateLimitRepository } from "./repository.js";

export interface ProjectRequestLimiter {
  admit(internalProjectId: string): Promise<void>;
}

export function createProjectRequestLimiter(options: {
  readonly repository: ProjectRateLimitRepository;
  readonly now?: () => Date;
}): ProjectRequestLimiter {
  const now = options.now ?? (() => new Date());
  const limiter: ProjectRequestLimiter = Object.freeze({
    async admit(internalProjectId: string) {
      const window = createProjectRateLimitWindow(internalProjectId, now());
      if ((await options.repository.admit(window)) === "limited") {
        throw new HttpError(
          429,
          "RATE_LIMIT_EXCEEDED",
          "Project request limit exceeded; retry later",
          undefined,
          window.retryAfterSeconds,
        );
      }
    },
  });
  return limiter;
}
