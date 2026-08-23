import { describe, expect, it } from "vitest";

import {
  InvalidProjectCursorError,
  createOwnerIndexStartKey,
  decodeProjectCursor,
  encodeProjectCursor,
} from "./cursor.js";

const payload = {
  projectId: "prj_0123456789abcdefghijkl",
  createdAt: "2026-08-23T08:00:00.000Z",
};

describe("project cursors", () => {
  it("round-trips only the public project ID and creation time", () => {
    const cursor = encodeProjectCursor(payload);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeProjectCursor(cursor)).toEqual(payload);
    expect(Buffer.from(cursor, "base64url").toString("utf8")).not.toContain("owner");
  });

  it.each(["", "not a cursor", "e30", "eyJwcm9qZWN0SWQiOiJjYWxsZXIifQ"])(
    "rejects malformed or incomplete cursor %j",
    (cursor) => {
      expect(() => decodeProjectCursor(cursor)).toThrow(InvalidProjectCursorError);
    },
  );

  it("reconstructs owner scope only from trusted context", () => {
    const ownerAKey = createOwnerIndexStartKey("owner-a", payload);
    const ownerBKey = createOwnerIndexStartKey("owner-b", payload);

    expect(ownerAKey).toMatchObject({
      pk: `PROJECT#${payload.projectId}`,
      sk: "METADATA",
      gsi1pk: "OWNER#owner-a",
    });
    expect(ownerBKey.gsi1pk).toBe("OWNER#owner-b");
    expect(ownerAKey.gsi1sk).toBe(ownerBKey.gsi1sk);
  });
});
