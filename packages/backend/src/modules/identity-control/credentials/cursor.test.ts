import { describe, expect, it } from "vitest";

import {
  InvalidApiKeyCursorError,
  createProjectApiKeyStartKey,
  decodeApiKeyCursor,
  encodeApiKeyCursor,
} from "./cursor.js";

const keyId = "key_0123456789abcdefghijkl";

describe("API key cursor", () => {
  it("round-trips only the validated lookup ID", () => {
    const cursor = encodeApiKeyCursor({ keyId });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeApiKeyCursor(cursor)).toEqual({ keyId });
    expect(Buffer.from(cursor, "base64url").toString("utf8")).not.toMatch(
      /owner|project|secret|pk/,
    );
  });

  it.each([
    "e30",
    "not a cursor",
    Buffer.from('{"keyId":"bad","ownerId":"x"}').toString("base64url"),
  ])("rejects malformed or unsupported cursor %s", (cursor) =>
    expect(() => decodeApiKeyCursor(cursor)).toThrow(InvalidApiKeyCursorError),
  );

  it("reconstructs Dynamo scope from the separately trusted project", () => {
    const cursor = decodeApiKeyCursor(encodeApiKeyCursor({ keyId }));
    expect(createProjectApiKeyStartKey("prj_0123456789abcdefghijkl", cursor)).toEqual({
      pk: "PROJECT#prj_0123456789abcdefghijkl",
      sk: `API_KEY#${keyId}`,
    });
    expect(createProjectApiKeyStartKey("prj_0123456789abcdefghijkm", cursor).pk).toBe(
      "PROJECT#prj_0123456789abcdefghijkm",
    );
  });
});
