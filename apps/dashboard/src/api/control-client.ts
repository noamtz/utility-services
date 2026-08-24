import { ErrorEnvelopeSchema } from "@utility-services/contracts";

const SAFE_CONTROL_ERROR = "The request could not be completed. Please try again.";

export class ControlApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code = "CONTROL_REQUEST_FAILED",
  ) {
    super(message);
    this.name = "ControlApiError";
  }
}

export interface ControlClient {
  request<T>(path: string, schema: { parse(value: unknown): T }, init?: RequestInit): Promise<T>;
}

export function createControlClient(dependencies: {
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
  onUnauthorized?: () => Promise<void>;
}): ControlClient {
  return Object.freeze({
    async request<T>(path: string, schema: { parse(value: unknown): T }, init?: RequestInit) {
      let accessToken: string;
      try {
        accessToken = await dependencies.getAccessToken();
      } catch {
        throw new ControlApiError("Authentication required", 401, "UNAUTHORIZED");
      }
      const response = await (dependencies.fetch ?? globalThis.fetch)(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ControlApiError(SAFE_CONTROL_ERROR, response.status);
      }
      if (!response.ok) {
        const parsed = ErrorEnvelopeSchema.safeParse(body);
        if (response.status === 401) {
          await dependencies.onUnauthorized?.().catch(() => undefined);
        }
        throw parsed.success
          ? new ControlApiError(parsed.data.error.message, response.status, parsed.data.error.code)
          : new ControlApiError(SAFE_CONTROL_ERROR, response.status);
      }
      try {
        return schema.parse(body);
      } catch {
        throw new ControlApiError(SAFE_CONTROL_ERROR, response.status, "INVALID_CONTROL_RESPONSE");
      }
    },
  });
}
