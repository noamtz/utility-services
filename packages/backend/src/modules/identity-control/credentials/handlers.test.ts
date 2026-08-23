import type { ApiKeyListPayload, IssuedApiKey, RevokedApiKey } from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createIssueProjectApiKeyHandler,
  createListProjectApiKeysHandler,
  createReplaceProjectApiKeyHandler,
  createRevokeProjectApiKeyHandler,
} from "./handlers.js";
import type { CredentialService } from "./service.js";

const projectId = "prj_0123456789abcdefghijkl";
const keyId = "key_0123456789abcdefghijkl";
const secret = "s".repeat(43);
const apiKey = `rus_v1.${keyId}.${secret}`;
const timestamp = "2026-08-23T08:00:00.000Z";
const metadata = { keyId, status: "active", createdAt: timestamp, updatedAt: timestamp } as const;
const issued: IssuedApiKey = { apiKey, metadata };

function event(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: "2.0",
    requestContext: {
      requestId: "credential-handler-request",
      http: { method: "POST", path: `/v1/control/projects/${projectId}/api-keys` },
      authorizer: { jwt: { claims: { sub: "owner-private", token_use: "access" } } },
    },
    headers: { authorization: "Bearer owner-token-private" },
    pathParameters: { projectId },
    ...overrides,
  };
}

function service(overrides: Partial<CredentialService> = {}): CredentialService {
  return {
    issue: vi.fn().mockResolvedValue(issued),
    list: vi.fn().mockResolvedValue({ items: [] } satisfies ApiKeyListPayload),
    revoke: vi.fn().mockResolvedValue({ metadata } satisfies RevokedApiKey),
    replace: vi.fn().mockResolvedValue(issued),
    ...overrides,
  };
}

function body(response: { body?: string | undefined }): unknown {
  return JSON.parse(response.body ?? "null") as unknown;
}

describe("credential lifecycle handlers", () => {
  it("issues through owner context with a 201 one-time envelope", async () => {
    const issue = vi.fn().mockResolvedValue(issued);
    const response = await createIssueProjectApiKeyHandler(service({ issue }))(event());
    expect(response.statusCode).toBe(201);
    expect(issue).toHaveBeenCalledWith({ ownerId: "owner-private" }, projectId);
    expect(body(response)).toEqual({ data: issued, requestId: "credential-handler-request" });
  });

  it("lists parsed pagination as metadata only", async () => {
    const list = vi.fn().mockResolvedValue({ items: [metadata] });
    const response = await createListProjectApiKeysHandler(service({ list }))(
      event({ queryStringParameters: { limit: "10" } }),
    );
    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith({ ownerId: "owner-private" }, projectId, { limit: 10 });
    expect(JSON.stringify(body(response))).not.toMatch(/secretHash|owner-private|owner-token/);
  });

  it("revokes and replaces only a strict project/key path", async () => {
    const revoke = vi.fn().mockResolvedValue({ metadata });
    const replace = vi.fn().mockResolvedValue(issued);
    const pathEvent = event({ pathParameters: { projectId, keyId } });
    const revoked = await createRevokeProjectApiKeyHandler(service({ revoke }))(pathEvent);
    const replaced = await createReplaceProjectApiKeyHandler(service({ replace }))(pathEvent);
    expect(revoked.statusCode).toBe(200);
    expect(replaced.statusCode).toBe(201);
    expect(revoke).toHaveBeenCalledWith({ ownerId: "owner-private" }, projectId, keyId);
    expect(replace).toHaveBeenCalledWith({ ownerId: "owner-private" }, projectId, keyId);
  });

  it("rejects malformed paths and non-empty lifecycle bodies before service calls", async () => {
    const issue = vi.fn().mockResolvedValue(issued);
    const handler = createIssueProjectApiKeyHandler(service({ issue }));
    const malformed = await handler(event({ pathParameters: { projectId: "bad" } }));
    const bodyInput = await handler(event({ body: JSON.stringify({ secret: "caller" }) }));
    expect([malformed.statusCode, bodyInput.statusCode]).toEqual([400, 400]);
    expect(issue).not.toHaveBeenCalled();
  });

  it("keeps owner headers, generated material, and logger evidence sparse", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const response = await createRevokeProjectApiKeyHandler(
      service(),
      logger,
    )(event({ pathParameters: { projectId, keyId } }));
    const evidence = JSON.stringify([
      body(response),
      logger.info.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(evidence).not.toMatch(/owner-private|owner-token-private|secretHash|Authorization/);
    expect(evidence).not.toContain(secret);
  });
});
