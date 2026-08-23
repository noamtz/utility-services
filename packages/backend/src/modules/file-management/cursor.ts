import { FileIdSchema } from "@utility-services/contracts";
import { z } from "zod";

const CursorPayloadSchema = z
  .object({ version: z.literal(1), internalProjectId: z.uuid(), fileId: FileIdSchema })
  .strict();

export interface FileCursorPayload {
  readonly fileId: string;
}

export class InvalidFileCursorError extends Error {
  public constructor() {
    super("File cursor is invalid for this project");
    this.name = "InvalidFileCursorError";
  }
}

export function encodeFileCursor(internalProjectId: string, payload: FileCursorPayload): string {
  const parsed = CursorPayloadSchema.parse({
    version: 1,
    internalProjectId,
    fileId: payload.fileId,
  });
  return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
}

export function decodeFileCursor(cursor: string, internalProjectId: string): FileCursorPayload {
  try {
    const parsed = CursorPayloadSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    if (parsed.internalProjectId !== z.uuid().parse(internalProjectId)) {
      throw new InvalidFileCursorError();
    }
    return Object.freeze({ fileId: parsed.fileId });
  } catch (error) {
    if (error instanceof InvalidFileCursorError) throw error;
    throw new InvalidFileCursorError();
  }
}
