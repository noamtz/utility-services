import { describe, expect, it } from "vitest";

import { HttpError } from "../../../core/http/handler.js";
import { extractOwnerContext } from "./owner-context.js";

function authorizedEvent(overrides: Record<string, unknown> = {}): unknown {
  return {
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: "cognito-owner-1",
            token_use: "access",
            email: "owner@example.com",
          },
        },
      },
    },
    headers: { ownerId: "caller-header-owner" },
    body: JSON.stringify({ ownerId: "caller-body-owner" }),
    ...overrides,
  };
}

describe("extractOwnerContext", () => {
  it("returns only the immutable Cognito access-token subject", () => {
    const context = extractOwnerContext(authorizedEvent());

    expect(context).toEqual({ ownerId: "cognito-owner-1" });
    expect(Object.keys(context)).toEqual(["ownerId"]);
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("ignores caller-controlled owner values", () => {
    expect(
      extractOwnerContext(
        authorizedEvent({
          ownerId: "top-level-owner",
          pathParameters: { ownerId: "path-owner" },
        }),
      ),
    ).toEqual({ ownerId: "cognito-owner-1" });
  });

  it.each([
    undefined,
    {},
    { requestContext: {} },
    { requestContext: { authorizer: {} } },
    { requestContext: { authorizer: { jwt: {} } } },
    { requestContext: { authorizer: { jwt: { claims: {} } } } },
    {
      requestContext: {
        authorizer: { jwt: { claims: { sub: "", token_use: "access" } } },
      },
    },
    {
      requestContext: {
        authorizer: { jwt: { claims: { sub: "owner", token_use: "id" } } },
      },
    },
  ])("rejects missing, malformed, or non-access authorization %#", (event) => {
    expect(() => extractOwnerContext(event)).toThrowError(
      expect.objectContaining<Partial<HttpError>>({
        statusCode: 401,
        code: "UNAUTHORIZED",
        safeMessage: "Authentication required",
      }),
    );
  });

  it("does not include claims or token data in the safe error", () => {
    let error: unknown;
    try {
      extractOwnerContext({
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                sub: "private-owner-subject",
                token_use: "id",
                authorization: "Bearer private-token",
              },
            },
          },
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HttpError);
    expect(JSON.stringify(error)).not.toContain("private-owner-subject");
    expect(JSON.stringify(error)).not.toContain("private-token");
  });
});
