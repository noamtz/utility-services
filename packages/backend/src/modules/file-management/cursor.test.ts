import { describe, expect, it } from "vitest";

import { decodeFileCursor, encodeFileCursor, InvalidFileCursorError } from "./cursor.js";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";
const fileId = "fil_0123456789abcdefghijkl";

describe("file cursor", () => {
  it("round-trips only inside the trusted project scope", () => {
    const cursor = encodeFileCursor(projectA, { fileId });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeFileCursor(cursor, projectA)).toEqual({ fileId });
    expect(() => decodeFileCursor(cursor, projectB)).toThrow(InvalidFileCursorError);
  });

  it.each(["not-base64", Buffer.from("{}").toString("base64url")])(
    "rejects malformed cursor %s",
    (cursor) => expect(() => decodeFileCursor(cursor, projectA)).toThrow(InvalidFileCursorError),
  );
});
