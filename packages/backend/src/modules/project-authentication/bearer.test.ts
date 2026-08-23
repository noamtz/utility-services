import { describe, expect, it } from "vitest";

import { InvalidProjectBearerError, parseProjectBearer } from "./bearer.js";

const keyId = "key_0123456789abcdefghijkl";
const secret = "s".repeat(43);
const apiKey = `rus_v1.${keyId}.${secret}`;

describe("project bearer parser", () => {
  it.each(["authorization", "Authorization", "AUTHORIZATION"])(
    "finds one case-insensitive %s header name",
    (name) => {
      expect(parseProjectBearer({ [name]: `Bearer ${apiKey}` })).toEqual({ keyId, secret });
    },
  );

  it.each([
    undefined,
    {},
    { authorization: "" },
    { authorization: `bearer ${apiKey}` },
    { authorization: `Bearer  ${apiKey}` },
    { authorization: `Bearer ${apiKey} ` },
    { authorization: `Bearer ${apiKey},Bearer ${apiKey}` },
    { authorization: `Basic ${apiKey}` },
    {
      authorization:
        "Bearer rus_v2.key_0123456789abcdefghijkl.sssssssssssssssssssssssssssssssssssssssssss",
    },
    { authorization: `Bearer ${apiKey}.extra` },
    { authorization: "Bearer rus_v1.key_short.secret" },
  ])("rejects missing or malformed header %#", (headers) => {
    expect(() => parseProjectBearer(headers)).toThrow(InvalidProjectBearerError);
  });

  it("rejects repeated differently-cased Authorization fields", () => {
    expect(() =>
      parseProjectBearer({ authorization: `Bearer ${apiKey}`, Authorization: `Bearer ${apiKey}` }),
    ).toThrow(InvalidProjectBearerError);
  });

  it("never accepts query-style alternatives", () => {
    expect(() =>
      parseProjectBearer({ "x-api-key": apiKey, cookie: `authorization=${apiKey}` }),
    ).toThrow(InvalidProjectBearerError);
  });
});
