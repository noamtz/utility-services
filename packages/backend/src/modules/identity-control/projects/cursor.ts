import { ProjectCursorSchema, PublicProjectIdSchema } from "@utility-services/contracts";
import { z } from "zod";

import {
  PROJECT_METADATA_SORT_KEY,
  ownerPartitionKey,
  ownerProjectSortKey,
  projectPartitionKey,
} from "./model.js";

const ProjectCursorPayloadSchema = z
  .object({
    projectId: PublicProjectIdSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ProjectCursorPayload = z.infer<typeof ProjectCursorPayloadSchema>;

export class InvalidProjectCursorError extends Error {
  public constructor() {
    super("Project cursor is invalid");
    this.name = "InvalidProjectCursorError";
  }
}

export function encodeProjectCursor(payload: ProjectCursorPayload): string {
  const parsed = ProjectCursorPayloadSchema.parse(payload);
  return ProjectCursorSchema.parse(
    Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url"),
  );
}

export function decodeProjectCursor(cursor: string): ProjectCursorPayload {
  try {
    const encoded = ProjectCursorSchema.parse(cursor);
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return ProjectCursorPayloadSchema.parse(JSON.parse(decoded) as unknown);
  } catch {
    throw new InvalidProjectCursorError();
  }
}

export function createOwnerIndexStartKey(ownerId: string, cursor: ProjectCursorPayload) {
  const parsed = ProjectCursorPayloadSchema.parse(cursor);
  return {
    pk: projectPartitionKey(parsed.projectId),
    sk: PROJECT_METADATA_SORT_KEY,
    gsi1pk: ownerPartitionKey(ownerId),
    gsi1sk: ownerProjectSortKey(parsed.createdAt, parsed.projectId),
  };
}
