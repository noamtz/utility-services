import { GroupIdSchema } from "@utility-services/contracts";

export type GreenGroupProvider = {
  getChats(): Promise<unknown>;
  getGroupData(groupId: string): Promise<unknown>;
};
export type GroupObservation = Readonly<{
  groupId: string;
  confirmed: boolean;
  reason: "confirmed-by-group-data" | "unconfirmed-group-data" | "provider-error";
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function discoverGroups(
  provider: GreenGroupProvider,
  concurrency = 10,
): Promise<{ complete: boolean; groups: readonly GroupObservation[] }> {
  let chats: unknown;
  try {
    chats = await provider.getChats();
  } catch {
    return { complete: false, groups: [] };
  }
  if (!Array.isArray(chats)) return { complete: false, groups: [] };
  const ids: string[] = [];
  for (const chat of chats) {
    if (!isRecord(chat) || typeof chat["type"] !== "string" || typeof chat["id"] !== "string")
      return { complete: false, groups: [] };
    if (chat["type"] !== "group") continue;
    try {
      ids.push(GroupIdSchema.parse(chat["id"]));
    } catch {
      return { complete: false, groups: [] };
    }
  }
  if (new Set(ids).size !== ids.length) return { complete: false, groups: [] };
  const results: GroupObservation[] = [];
  for (let offset = 0; offset < ids.length; offset += concurrency) {
    const batch = ids.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (groupId) => {
        try {
          const group = await provider.getGroupData(groupId);
          return isRecord(group) && group["groupId"] === groupId
            ? { groupId, confirmed: true, reason: "confirmed-by-group-data" as const }
            : { groupId, confirmed: false, reason: "unconfirmed-group-data" as const };
        } catch {
          return { groupId, confirmed: false, reason: "provider-error" as const };
        }
      }),
    );
    for (const item of settled) if (item.status === "fulfilled") results.push(item.value);
  }
  return { complete: results.every((group) => group.confirmed), groups: results };
}
