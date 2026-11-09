export type GroupPresenceState = "present" | "unknown";
export type GroupPresenceOutcome = Readonly<{
  state: GroupPresenceState;
  observedAt: string;
  reason:
    | "confirmed-by-group-data"
    | "provider-error"
    | "incomplete-scan"
    | "missing-from-scan"
    | "unconfirmed-group-data";
}>;
export type GroupPresenceProvider = Readonly<{
  getChats(): Promise<unknown>;
  getGroupData(groupKey: string): Promise<unknown>;
}>;

/** Safely observes the existing getChats/getGroupData POC using a supplied provider. */
export async function observeGroupPresence(
  groupKey: string,
  provider: GroupPresenceProvider,
  now: () => Date = () => new Date(),
): Promise<GroupPresenceOutcome> {
  const observedAt = now().toISOString();
  let chats: unknown;
  try {
    chats = await provider.getChats();
  } catch {
    return unknown(observedAt, "provider-error");
  }
  if (!Array.isArray(chats)) return unknown(observedAt, "incomplete-scan");
  const parsedChats: Chat[] = [];
  for (const candidate of chats as unknown[]) {
    if (!isChat(candidate)) return unknown(observedAt, "incomplete-scan");
    parsedChats.push(candidate);
  }
  if (new Set(parsedChats.map((chat) => chat.id)).size !== parsedChats.length)
    return unknown(observedAt, "incomplete-scan");
  if (!parsedChats.some((chat) => chat.type === "group" && chat.id === groupKey))
    return unknown(observedAt, "missing-from-scan");
  try {
    const group = await provider.getGroupData(groupKey);
    if (!isRecord(group) || group["groupId"] !== groupKey)
      return unknown(observedAt, "unconfirmed-group-data");
  } catch {
    return unknown(observedAt, "provider-error");
  }
  return { state: "present", observedAt, reason: "confirmed-by-group-data" };
}

function unknown(
  observedAt: string,
  reason: Exclude<GroupPresenceOutcome["reason"], "confirmed-by-group-data">,
): GroupPresenceOutcome {
  return { state: "unknown", observedAt, reason };
}
type Chat = Readonly<{ id: string; type: string }>;
function isChat(value: unknown): value is Chat {
  return isRecord(value) && typeof value["id"] === "string" && typeof value["type"] === "string";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
