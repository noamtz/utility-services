import {
  ApiKeyListResponseSchema,
  IssuedApiKeyResponseSchema,
  RevokedApiKeyResponseSchema,
} from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createHttpHandler } from "../../packages/backend/src/core/http/handler.js";
import {
  createIssueProjectApiKeyHandler,
  createListProjectApiKeysHandler,
  createReplaceProjectApiKeyHandler,
  createRevokeProjectApiKeyHandler,
} from "../../packages/backend/src/modules/identity-control/credentials/handlers.js";
import { generateProjectApiKey } from "../../packages/backend/src/modules/identity-control/credentials/credential.js";
import {
  assertCredentialRecordsMatch,
  withCredentialOperationalStatus,
  withReplacedStatus,
  withRevokedStatus,
  type ApiKeyLookupItem,
  type ProjectApiKeyMetadataItem,
} from "../../packages/backend/src/modules/identity-control/credentials/model.js";
import {
  CorruptCredentialRecordError,
  CredentialCollisionError,
  CredentialStateConflictError,
  type CredentialRepository,
  type CredentialVerificationSnapshot,
  type ListApiKeysInput,
} from "../../packages/backend/src/modules/identity-control/credentials/repository.js";
import { createCredentialService } from "../../packages/backend/src/modules/identity-control/credentials/service.js";
import type { InternalProject } from "../../packages/backend/src/modules/identity-control/projects/model.js";
import { createProjectAuthorization } from "../../packages/backend/src/modules/project-authentication/authorization.js";
import { createProjectAuthenticationService } from "../../packages/backend/src/modules/project-authentication/service.js";

const ownerA = "owner-a-private-subject";
const ownerB = "owner-b-private-subject";
const ownerBearer = "owner-private-bearer";
const timestamp = "2026-08-23T08:00:00.000Z";

function project(
  ownerId: string,
  publicProjectId: string,
  internalProjectId: string,
): InternalProject {
  return {
    internalProjectId,
    publicProjectId,
    ownerId,
    name: "Credential integration project",
    status: "active",
    enabledUtilities: ["file-management"],
    fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const projectA = project(
  ownerA,
  "prj_0123456789abcdefghijkl",
  "11111111-1111-4111-8111-111111111111",
);
const projectB = project(
  ownerB,
  "prj_0123456789abcdefghijkm",
  "22222222-2222-4222-8222-222222222222",
);

class MemoryCredentialRepository implements CredentialRepository {
  private readonly projects = new Map<string, InternalProject>();
  private readonly metadata = new Map<string, ProjectApiKeyMetadataItem>();
  private readonly lookups = new Map<string, ApiKeyLookupItem>();

  public constructor(...projects: InternalProject[]) {
    for (const item of projects) this.projects.set(item.publicProjectId, structuredClone(item));
  }

  private metadataKey(publicProjectId: string, keyId: string) {
    return `${publicProjectId}:${keyId}`;
  }

  public inspectProject(publicProjectId: string) {
    const item = this.projects.get(publicProjectId);
    return Promise.resolve(item ? structuredClone(item) : undefined);
  }

  public inspectMetadata(publicProjectId: string, keyId: string) {
    const item = this.metadata.get(this.metadataKey(publicProjectId, keyId));
    return Promise.resolve(item ? structuredClone(item) : undefined);
  }

  public list(input: ListApiKeysInput) {
    const owned = [...this.metadata.values()]
      .filter((item) => item.publicProjectId === input.publicProjectId)
      .sort((left, right) => left.keyId.localeCompare(right.keyId));
    const start = input.startAfter
      ? owned.findIndex((item) => item.keyId === input.startAfter?.keyId) + 1
      : 0;
    const page = owned.slice(start, start + input.limit).map((item) => structuredClone(item));
    const last = page.at(-1);
    return Promise.resolve({
      items: page,
      ...(start + page.length < owned.length && last ? { nextCursor: { keyId: last.keyId } } : {}),
    });
  }

  public getLookup(keyId: string) {
    const item = this.lookups.get(keyId);
    return Promise.resolve(item ? structuredClone(item) : undefined);
  }

  public getVerificationSnapshot(keyId: string, publicProjectId: string) {
    const lookup = this.lookups.get(keyId);
    const metadata = this.metadata.get(this.metadataKey(publicProjectId, keyId));
    const project = this.projects.get(publicProjectId);
    if (!lookup || !metadata || !project) return Promise.resolve(undefined);
    try {
      const records = assertCredentialRecordsMatch(metadata, lookup);
      if (
        records.lookup.publicProjectId !== project.publicProjectId ||
        records.lookup.internalProjectId !== project.internalProjectId
      ) {
        throw new CorruptCredentialRecordError();
      }
      return Promise.resolve(
        structuredClone({ ...records, project } satisfies CredentialVerificationSnapshot),
      );
    } catch {
      throw new CorruptCredentialRecordError();
    }
  }

  public issue(
    project: InternalProject,
    metadata: ProjectApiKeyMetadataItem,
    lookup: ApiKeyLookupItem,
  ) {
    const storedProject = this.projects.get(project.publicProjectId);
    if (
      !storedProject ||
      storedProject.internalProjectId !== project.internalProjectId ||
      storedProject.ownerId !== project.ownerId ||
      !storedProject.enabledUtilities.includes("file-management")
    ) {
      throw new CredentialStateConflictError();
    }
    assertCredentialRecordsMatch(metadata, lookup);
    const metadataKey = this.metadataKey(metadata.publicProjectId, metadata.keyId);
    if (this.metadata.has(metadataKey) || this.lookups.has(lookup.keyId)) {
      throw new CredentialCollisionError();
    }
    this.metadata.set(metadataKey, structuredClone(metadata));
    this.lookups.set(lookup.keyId, structuredClone(lookup));
    return Promise.resolve();
  }

  public revoke(metadata: ProjectApiKeyMetadataItem, updatedAt: string) {
    const metadataKey = this.metadataKey(metadata.publicProjectId, metadata.keyId);
    const currentMetadata = this.metadata.get(metadataKey);
    const currentLookup = this.lookups.get(metadata.keyId);
    if (!currentMetadata || !currentLookup) throw new CredentialStateConflictError();
    assertCredentialRecordsMatch(currentMetadata, currentLookup);
    if (currentMetadata.status === "revoked" || currentMetadata.status === "replaced") {
      return Promise.resolve(structuredClone(currentMetadata));
    }
    const nextMetadata = withRevokedStatus(currentMetadata, updatedAt);
    const nextLookup = withRevokedStatus(currentLookup, updatedAt);
    this.metadata.set(metadataKey, structuredClone(nextMetadata));
    this.lookups.set(metadata.keyId, structuredClone(nextLookup));
    return Promise.resolve(structuredClone(nextMetadata));
  }

  public replace(
    metadata: ProjectApiKeyMetadataItem,
    newMetadata: ProjectApiKeyMetadataItem,
    newLookup: ApiKeyLookupItem,
    updatedAt: string,
  ) {
    const oldKey = this.metadataKey(metadata.publicProjectId, metadata.keyId);
    const currentMetadata = this.metadata.get(oldKey);
    const currentLookup = this.lookups.get(metadata.keyId);
    const newKey = this.metadataKey(newMetadata.publicProjectId, newMetadata.keyId);
    if (
      !currentMetadata ||
      !currentLookup ||
      (currentMetadata.status !== "active" && currentMetadata.status !== "suspended")
    ) {
      throw new CredentialStateConflictError();
    }
    assertCredentialRecordsMatch(currentMetadata, currentLookup);
    assertCredentialRecordsMatch(newMetadata, newLookup);
    if (this.metadata.has(newKey) || this.lookups.has(newLookup.keyId)) {
      throw new CredentialCollisionError();
    }
    const nextMetadata = withReplacedStatus(currentMetadata, updatedAt, newMetadata.keyId);
    const nextLookup = withReplacedStatus(currentLookup, updatedAt, newMetadata.keyId);
    this.metadata.set(oldKey, structuredClone(nextMetadata));
    this.lookups.set(metadata.keyId, structuredClone(nextLookup));
    this.metadata.set(newKey, structuredClone(newMetadata));
    this.lookups.set(newLookup.keyId, structuredClone(newLookup));
    return Promise.resolve(structuredClone(nextMetadata));
  }

  public setOperationalStatus(
    metadata: ProjectApiKeyMetadataItem,
    expectedStatus: "active" | "suspended",
    nextStatus: "active" | "suspended",
    changedAt: string,
  ) {
    const metadataKey = this.metadataKey(metadata.publicProjectId, metadata.keyId);
    const currentMetadata = this.metadata.get(metadataKey);
    const currentLookup = this.lookups.get(metadata.keyId);
    if (
      !currentMetadata ||
      !currentLookup ||
      currentMetadata.status !== expectedStatus ||
      currentLookup.status !== expectedStatus
    ) {
      throw new CredentialStateConflictError();
    }
    const nextMetadata = withCredentialOperationalStatus(currentMetadata, nextStatus, changedAt);
    const nextLookup = withCredentialOperationalStatus(currentLookup, nextStatus, changedAt);
    this.metadata.set(metadataKey, structuredClone(nextMetadata));
    this.lookups.set(metadata.keyId, structuredClone(nextLookup));
    return Promise.resolve(structuredClone(nextMetadata));
  }

  public setStatus(keyId: string, status: "suspended" | "revoked" | "replaced") {
    const lookup = this.lookups.get(keyId)!;
    const metadataKey = this.metadataKey(lookup.publicProjectId, keyId);
    const metadata = this.metadata.get(metadataKey)!;
    if (status === "suspended") {
      this.lookups.set(keyId, { ...lookup, status, updatedAt: timestamp });
      this.metadata.set(metadataKey, { ...metadata, status, updatedAt: timestamp });
    } else if (status === "revoked") {
      this.lookups.set(keyId, withRevokedStatus(lookup, timestamp));
      this.metadata.set(metadataKey, withRevokedStatus(metadata, timestamp));
    } else {
      const replacementKeyId = "key_0123456789abcdefghijkz";
      this.lookups.set(keyId, withReplacedStatus(lookup, timestamp, replacementKeyId));
      this.metadata.set(metadataKey, withReplacedStatus(metadata, timestamp, replacementKeyId));
    }
  }

  public disableUtility(publicProjectId: string) {
    const existing = this.projects.get(publicProjectId)!;
    this.projects.set(publicProjectId, { ...existing, enabledUtilities: [] as never });
  }

  public corruptLookupProject(keyId: string) {
    const lookup = this.lookups.get(keyId)!;
    this.lookups.set(keyId, { ...lookup, internalProjectId: projectB.internalProjectId });
  }

  public storedEvidence() {
    return structuredClone({
      metadata: [...this.metadata.values()],
      lookups: [...this.lookups.values()],
    });
  }
}

function ownerEvent(
  ownerId: string,
  pathParameters: Record<string, string>,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    version: "2.0",
    requestContext: {
      requestId: "credential-integration-request",
      http: { method: "POST", path: "/v1/control/projects/project/api-keys" },
      authorizer: { jwt: { claims: { sub: ownerId, token_use: "access" } } },
    },
    headers: { authorization: `Bearer ${ownerBearer}` },
    pathParameters,
    ...overrides,
  };
}

function projectEvent(apiKey: string, extraHeaders: Record<string, string> = {}): unknown {
  return {
    version: "2.0",
    requestContext: {
      requestId: "project-auth-integration-request",
      http: { method: "GET", path: "/v1/future-utility" },
    },
    headers: { authorization: `Bearer ${apiKey}`, ...extraHeaders },
  };
}

function parsed(response: { body?: string | undefined }): unknown {
  return JSON.parse(response.body ?? "null") as unknown;
}

function assembled() {
  let sequence = 1;
  const repository = new MemoryCredentialRepository(projectA, projectB);
  const lifecycle = createCredentialService({
    repository,
    generateCredential: () => {
      const value = sequence++;
      return generateProjectApiKey((size) => Buffer.alloc(size, size === 16 ? value : value + 100));
    },
    now: () => new Date(timestamp),
  });
  const logger = { info: vi.fn(), error: vi.fn() };
  const authorization = createProjectAuthorization(
    createProjectAuthenticationService({ repository }),
  );
  const authorizedContexts: unknown[] = [];
  const consumer = createHttpHandler({
    schemas: { response: z.object({ authorized: z.literal(true) }).strict() },
    deriveAuthorization: authorization,
    callback: ({ authorization: context }) => {
      authorizedContexts.push(context);
      return { authorized: true } as const;
    },
    logger,
  });
  return {
    repository,
    logger,
    authorizedContexts,
    issue: createIssueProjectApiKeyHandler(lifecycle, logger),
    list: createListProjectApiKeysHandler(lifecycle, logger),
    revoke: createRevokeProjectApiKeyHandler(lifecycle, logger),
    replace: createReplaceProjectApiKeyHandler(lifecycle, logger),
    consumer,
  };
}

async function issueKey(
  handlers: ReturnType<typeof assembled>,
  ownerId: string,
  publicProjectId: string,
) {
  const response = await handlers.issue(ownerEvent(ownerId, { projectId: publicProjectId }));
  expect(response.statusCode).toBe(201);
  return { response, issued: IssuedApiKeyResponseSchema.parse(parsed(response)).data };
}

describe("project credential lifecycle and authentication integration", () => {
  it("preserves one-time display, multiple keys, atomic rotation, owner isolation, and trusted context", async () => {
    const handlers = assembled();
    const first = await issueKey(handlers, ownerA, projectA.publicProjectId);
    const second = await issueKey(handlers, ownerA, projectA.publicProjectId);
    const otherOwner = await issueKey(handlers, ownerB, projectB.publicProjectId);

    const storedAfterIssue = JSON.stringify(handlers.repository.storedEvidence());
    expect(storedAfterIssue.includes("secretHash")).toBe(true);
    for (const issued of [first.issued, second.issued, otherOwner.issued]) {
      expect(storedAfterIssue.includes(issued.apiKey)).toBe(false);
      const [, , rawSecret] = issued.apiKey.split(".");
      expect(storedAfterIssue.includes(rawSecret!)).toBe(false);
    }

    const listed = await handlers.list(
      ownerEvent(ownerA, { projectId: projectA.publicProjectId }, { queryStringParameters: {} }),
    );
    expect(ApiKeyListResponseSchema.parse(parsed(listed)).data.items).toHaveLength(2);
    expect(JSON.stringify(parsed(listed)).includes("secretHash")).toBe(false);

    expect((await handlers.consumer(projectEvent(first.issued.apiKey))).statusCode).toBe(200);
    expect((await handlers.consumer(projectEvent(second.issued.apiKey))).statusCode).toBe(200);

    const replacementResponse = await handlers.replace(
      ownerEvent(ownerA, {
        projectId: projectA.publicProjectId,
        keyId: first.issued.metadata.keyId,
      }),
    );
    const replacement = IssuedApiKeyResponseSchema.parse(parsed(replacementResponse)).data;
    expect((await handlers.consumer(projectEvent(first.issued.apiKey))).statusCode).toBe(401);
    expect((await handlers.consumer(projectEvent(second.issued.apiKey))).statusCode).toBe(200);
    expect(
      (
        await handlers.consumer(
          projectEvent(replacement.apiKey, { "x-project-id": projectB.publicProjectId }),
        )
      ).statusCode,
    ).toBe(200);
    expect(handlers.authorizedContexts.at(-1)).toMatchObject({
      internalProjectId: projectA.internalProjectId,
      keyId: replacement.metadata.keyId,
    });

    const revokeEvent = ownerEvent(ownerA, {
      projectId: projectA.publicProjectId,
      keyId: second.issued.metadata.keyId,
    });
    const revoked = await handlers.revoke(revokeEvent);
    const revokedAgain = await handlers.revoke(revokeEvent);
    expect(RevokedApiKeyResponseSchema.parse(parsed(revoked)).data.metadata.status).toBe("revoked");
    expect(parsed(revokedAgain)).toEqual(parsed(revoked));
    expect((await handlers.consumer(projectEvent(second.issued.apiKey))).statusCode).toBe(401);

    const forbiddenList = await handlers.list(
      ownerEvent(ownerA, { projectId: projectB.publicProjectId }, { queryStringParameters: {} }),
    );
    const forbiddenRevoke = await handlers.revoke(
      ownerEvent(ownerA, {
        projectId: projectB.publicProjectId,
        keyId: otherOwner.issued.metadata.keyId,
      }),
    );
    const forbiddenReplace = await handlers.replace(
      ownerEvent(ownerA, {
        projectId: projectB.publicProjectId,
        keyId: otherOwner.issued.metadata.keyId,
      }),
    );
    expect([
      forbiddenList.statusCode,
      forbiddenRevoke.statusCode,
      forbiddenReplace.statusCode,
    ]).toEqual([404, 404, 404]);

    const safeIssueBodies = [first, second, otherOwner].map(({ response, issued }) => ({
      ...((parsed(response) as { data: Record<string, unknown> }).data ?? {}),
      apiKey: undefined,
      keyId: issued.metadata.keyId,
    }));
    const evidence = JSON.stringify([
      safeIssueBodies,
      parsed(listed),
      parsed(revoked),
      parsed(forbiddenList),
      parsed(forbiddenRevoke),
      parsed(forbiddenReplace),
      handlers.logger.info.mock.calls,
      handlers.logger.error.mock.calls,
    ]);
    expect(evidence.includes(ownerA)).toBe(false);
    expect(evidence.includes(ownerB)).toBe(false);
    expect(evidence.includes(ownerBearer)).toBe(false);
    expect(evidence.includes("secretHash")).toBe(false);
    expect(evidence.includes("PROJECT#")).toBe(false);
    for (const apiKey of [
      first.issued.apiKey,
      second.issued.apiKey,
      otherOwner.issued.apiKey,
      replacement.apiKey,
    ]) {
      expect(evidence.includes(apiKey)).toBe(false);
    }
  });

  it("gives malformed, unknown, wrong-secret, inactive, disabled, and corrupt credentials one safe response", async () => {
    const baseline = assembled();
    const issued = (await issueKey(baseline, ownerA, projectA.publicProjectId)).issued;
    const [version, keyId] = issued.apiKey.split(".");
    const wrongSecret = `${version}.${keyId}.${"x".repeat(43)}`;
    const unknown = generateProjectApiKey((size) => Buffer.alloc(size, 44)).apiKey;
    const malformed = await baseline.consumer(projectEvent("malformed"));
    const unknownResponse = await baseline.consumer(projectEvent(unknown));
    const wrongSecretResponse = await baseline.consumer(projectEvent(wrongSecret));

    const inactiveResponses = [];
    for (const status of ["suspended", "revoked", "replaced"] as const) {
      const setup = assembled();
      const value = (await issueKey(setup, ownerA, projectA.publicProjectId)).issued;
      setup.repository.setStatus(value.metadata.keyId, status);
      inactiveResponses.push(await setup.consumer(projectEvent(value.apiKey)));
    }

    const disabled = assembled();
    const disabledKey = (await issueKey(disabled, ownerA, projectA.publicProjectId)).issued;
    disabled.repository.disableUtility(projectA.publicProjectId);
    const disabledResponse = await disabled.consumer(projectEvent(disabledKey.apiKey));

    const corrupt = assembled();
    const corruptKey = (await issueKey(corrupt, ownerA, projectA.publicProjectId)).issued;
    corrupt.repository.corruptLookupProject(corruptKey.metadata.keyId);
    const corruptResponse = await corrupt.consumer(projectEvent(corruptKey.apiKey));

    const responses = [
      malformed,
      unknownResponse,
      wrongSecretResponse,
      ...inactiveResponses,
      disabledResponse,
      corruptResponse,
    ];
    expect(responses.map(({ statusCode }) => statusCode)).toEqual(
      Array(responses.length).fill(401),
    );
    const envelopes = responses.map(parsed);
    expect(
      envelopes.every((envelope) => JSON.stringify(envelope) === JSON.stringify(envelopes[0])),
    ).toBe(true);
    const evidence = JSON.stringify([
      envelopes,
      baseline.logger.info.mock.calls,
      baseline.logger.error.mock.calls,
    ]);
    for (const privateValue of [issued.apiKey, wrongSecret, unknown, ownerA, ownerBearer]) {
      expect(evidence.includes(privateValue)).toBe(false);
    }
    expect(evidence.includes("secretHash")).toBe(false);
    expect(evidence.includes("authorization")).toBe(false);
  });
});
