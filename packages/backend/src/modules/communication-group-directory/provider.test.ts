import { describe, expect, it } from "vitest";
import { discoverGroups } from "./provider.js";

describe("GREEN group discovery", () => {
  it("confirms every group through group data with bounded batches", async () => {
    let active = 0;
    let peak = 0;
    const groups = Array.from({ length: 201 }, (_, index) => ({
      id: `group-${index}`,
      type: "group",
    }));
    const result = await discoverGroups(
      {
        getChats: () => Promise.resolve(groups),
        getGroupData: async (groupId) => {
          active += 1;
          peak = Math.max(peak, active);
          await Promise.resolve();
          active -= 1;
          return { groupId };
        },
      },
      10,
    );
    expect(result.complete).toBe(true);
    expect(result.groups).toHaveLength(201);
    expect(peak).toBeLessThanOrEqual(10);
  });

  it("marks provider outages incomplete without manufacturing departures", async () => {
    await expect(
      discoverGroups({
        getChats: () => Promise.reject(new Error("unavailable")),
        getGroupData: () => Promise.resolve({}),
      }),
    ).resolves.toEqual({ complete: false, groups: [] });
  });

  it("makes malformed, duplicate, and unconfirmed provider data unknown/incomplete", async () => {
    await expect(
      discoverGroups({
        getChats: () =>
          Promise.resolve([
            { id: "group-1", type: "group" },
            { id: "group-1", type: "group" },
          ]),
        getGroupData: () => Promise.resolve({ groupId: "group-1" }),
      }),
    ).resolves.toEqual({ complete: false, groups: [] });
    await expect(
      discoverGroups({
        getChats: () => Promise.resolve([{ id: "group-1", type: "group" }]),
        getGroupData: () => Promise.resolve({ groupId: "other-group" }),
      }),
    ).resolves.toEqual({
      complete: false,
      groups: [{ groupId: "group-1", confirmed: false, reason: "unconfirmed-group-data" }],
    });
  });

  it("rejects malformed chat shapes and retains an unknown observation on group lookup failure", async () => {
    await expect(
      discoverGroups({
        getChats: () => Promise.resolve({ not: "an-array" }),
        getGroupData: () => Promise.resolve({}),
      }),
    ).resolves.toEqual({ complete: false, groups: [] });
    await expect(
      discoverGroups({
        getChats: () =>
          Promise.resolve([
            { id: "direct-1", type: "direct" },
            { id: "group-1", type: "group" },
          ]),
        getGroupData: () => Promise.resolve({ groupId: "group-1" }),
      }),
    ).resolves.toEqual({
      complete: true,
      groups: [{ groupId: "group-1", confirmed: true, reason: "confirmed-by-group-data" }],
    });
    await expect(
      discoverGroups({
        getChats: () => Promise.resolve([{ id: "group-1", type: "group" }]),
        getGroupData: () => Promise.reject(new Error("provider-error")),
      }),
    ).resolves.toEqual({
      complete: false,
      groups: [{ groupId: "group-1", confirmed: false, reason: "provider-error" }],
    });
    await expect(
      discoverGroups({
        getChats: () => Promise.resolve([null]),
        getGroupData: () => Promise.resolve({}),
      }),
    ).resolves.toEqual({ complete: false, groups: [] });
    await expect(
      discoverGroups({
        getChats: () => Promise.resolve([{ id: 7, type: "group" }]),
        getGroupData: () => Promise.resolve({}),
      }),
    ).resolves.toEqual({ complete: false, groups: [] });
  });
});
