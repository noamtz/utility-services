import { ApiKeyCursorSchema, ApiKeyIdSchema } from "@utility-services/contracts";
import { z } from "zod";

import { projectPartitionKey } from "../projects/model.js";
import { projectApiKeySortKey } from "./model.js";

const ApiKeyCursorPayloadSchema = z.object({ keyId: ApiKeyIdSchema }).strict();

export type ApiKeyCursorPayload = z.infer<typeof ApiKeyCursorPayloadSchema>;

export class InvalidApiKeyCursorError extends Error {
  public constructor() {
    super("API key cursor is invalid");
    this.name = "InvalidApiKeyCursorError";
  }
}

export function encodeApiKeyCursor(payload: ApiKeyCursorPayload): string {
  const parsed = ApiKeyCursorPayloadSchema.parse(payload);
  return ApiKeyCursorSchema.parse(
    Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url"),
  );
}

export function decodeApiKeyCursor(cursor: string): ApiKeyCursorPayload {
  try {
    const encoded = ApiKeyCursorSchema.parse(cursor);
    return ApiKeyCursorPayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown,
    );
  } catch {
    throw new InvalidApiKeyCursorError();
  }
}

export function createProjectApiKeyStartKey(publicProjectId: string, cursor: ApiKeyCursorPayload) {
  const parsed = ApiKeyCursorPayloadSchema.parse(cursor);
  return {
    pk: projectPartitionKey(publicProjectId),
    sk: projectApiKeySortKey(parsed.keyId),
  };
}
