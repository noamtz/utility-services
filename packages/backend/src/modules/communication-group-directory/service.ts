import {
  GroupDirectoryEntrySchema,
  GroupEventSchema,
  type GroupDirectoryEntry,
  type GroupDirectoryQuery,
} from "@utility-services/contracts";
import type { z } from "zod";

import { HttpError } from "../../core/http/handler.js";
import type { TrustedProjectContext } from "@utility-services/contracts";

export type GroupSnapshot = Readonly<{
  connectionId: string;
  projectId: string;
  scanId: string;
  sequence: number;
  observedAt: string;
  complete: boolean;
  groups: readonly Readonly<{
    groupId: string;
    confirmed: boolean;
    reason: "confirmed-by-group-data" | "unconfirmed-group-data" | "provider-error";
  }>[];
}>;
export type GroupDirectoryRepository = {
  applySnapshot(snapshot: GroupSnapshot): Promise<void>;
  list(
    projectId: string,
    query: GroupDirectoryQuery,
  ): Promise<{ items: GroupDirectoryEntry[]; cursor?: string }>;
  listEvents(
    projectId: string,
    groupId: string,
    query: GroupDirectoryQuery,
  ): Promise<{ items: z.infer<typeof GroupEventSchema>[]; cursor?: string }>;
};

export function createGroupDirectoryService(repository: GroupDirectoryRepository) {
  return {
    async applySnapshot(snapshot: GroupSnapshot): Promise<void> {
      // A non-complete scan must never turn a missing group into a departure. Its observations are retained as unknown.
      await repository.applySnapshot(snapshot);
    },
    async list(context: TrustedProjectContext, query: GroupDirectoryQuery) {
      return repository.list(context.internalProjectId, query);
    },
    async events(context: TrustedProjectContext, groupId: string, query: GroupDirectoryQuery) {
      const result = await repository.listEvents(context.internalProjectId, groupId, query);
      if (result.items.length === 0) throw new HttpError(404, "NOT_FOUND", "Group not found");
      return result;
    },
  };
}

export function groupEntry(input: GroupDirectoryEntry): GroupDirectoryEntry {
  return GroupDirectoryEntrySchema.parse(input);
}
export function groupEvent(input: unknown) {
  return GroupEventSchema.parse(input);
}
