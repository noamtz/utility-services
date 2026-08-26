import { z } from "zod";

export const PROJECT_CONTROL_REQUEST_LIMIT = 60;
export const PROJECT_CONTROL_WINDOW_SECONDS = 60;
export const PROJECT_CONTROL_COUNTER_RETENTION_SECONDS = 5 * 60;

const InternalProjectIdSchema = z.uuid();

export interface ProjectRateLimitWindow {
  readonly pk: string;
  readonly sk: string;
  readonly internalProjectId: string;
  readonly windowMinute: number;
  readonly expiresAt: number;
  readonly retryAfterSeconds: number;
}

export function createProjectRateLimitWindow(
  internalProjectIdInput: string,
  nowInput: Date,
): ProjectRateLimitWindow {
  const internalProjectId = InternalProjectIdSchema.parse(internalProjectIdInput);
  const milliseconds = nowInput.getTime();
  if (!Number.isFinite(milliseconds)) throw new RangeError("Rate-limit time is invalid");
  const epochSeconds = Math.floor(milliseconds / 1_000);
  const windowMinute = Math.floor(epochSeconds / PROJECT_CONTROL_WINDOW_SECONDS);
  const nextWindowSeconds = (windowMinute + 1) * PROJECT_CONTROL_WINDOW_SECONDS;
  return Object.freeze({
    pk: `RATE#${internalProjectId}`,
    sk: `MINUTE#${windowMinute}`,
    internalProjectId,
    windowMinute,
    expiresAt: nextWindowSeconds + PROJECT_CONTROL_COUNTER_RETENTION_SECONDS,
    retryAfterSeconds: Math.max(1, nextWindowSeconds - epochSeconds),
  });
}
