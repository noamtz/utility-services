import { describe, expect, it, vi } from "vitest";
import { observeGroupPresence, type GroupPresenceProvider } from "./group-presence-spike.js";

const now = () => new Date("2026-11-09T18:00:00.000Z");
function provider(
  chats: unknown,
  group: unknown,
): GroupPresenceProvider & { getGroupData: ReturnType<typeof vi.fn> } {
  return {
    getChats: vi.fn(() =>
      chats instanceof Error ? Promise.reject(chats) : Promise.resolve(chats),
    ),
    getGroupData: vi.fn(() => Promise.resolve(group)),
  };
}
describe("observeGroupPresence", () => {
  it("confirms a join only when both provider calls agree", async () =>
    expect(
      observeGroupPresence(
        "fixture-group-a",
        provider([{ id: "fixture-group-a", type: "group" }], { groupId: "fixture-group-a" }),
        now,
      ),
    ).resolves.toMatchObject({ state: "present" }));
  it("keeps an absent leave candidate unknown without group lookup", async () => {
    const fake = provider([], undefined);
    await expect(observeGroupPresence("fixture-group-a", fake, now)).resolves.toMatchObject({
      state: "unknown",
      reason: "missing-from-scan",
    });
    expect(fake.getGroupData).not.toHaveBeenCalled();
  });
  it("keeps delayed group data and provider errors unknown", async () => {
    await expect(
      observeGroupPresence(
        "fixture-group-a",
        provider([{ id: "fixture-group-a", type: "group" }], {}),
        now,
      ),
    ).resolves.toMatchObject({ reason: "unconfirmed-group-data" });
    await expect(
      observeGroupPresence(
        "fixture-group-a",
        provider(new Error("safe fixture failure"), undefined),
        now,
      ),
    ).resolves.toMatchObject({ reason: "provider-error" });
  });
  it("keeps malformed and duplicate chats unknown", async () => {
    await expect(
      observeGroupPresence("fixture-group-a", provider({}, undefined), now),
    ).resolves.toMatchObject({ reason: "incomplete-scan" });
    await expect(
      observeGroupPresence(
        "fixture-group-a",
        provider(
          [
            { id: "fixture-group-a", type: "group" },
            { id: "fixture-group-a", type: "group" },
          ],
          undefined,
        ),
        now,
      ),
    ).resolves.toMatchObject({ reason: "incomplete-scan" });
  });
  it("does not treat a non-group chat as presence", async () => {
    const fake = provider([{ id: "fixture-group-a", type: "private" }], undefined);
    await expect(observeGroupPresence("fixture-group-a", fake, now)).resolves.toMatchObject({
      reason: "missing-from-scan",
    });
    expect(fake.getGroupData).not.toHaveBeenCalled();
  });
});
