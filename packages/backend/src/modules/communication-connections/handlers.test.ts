/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import type { InternalProject } from "../identity-control/projects/model.js";
import {
  createDisableCommunicationConnectionHandler,
  createInspectCommunicationConnectionHandler,
  createListCommunicationConnectionsHandler,
  createRegisterCommunicationConnectionHandler,
  createRotateCommunicationConnectionHandler,
} from "./handlers.js";
import { createCommunicationConnectionService } from "./service.js";

const projectId = "prj_1234567890123456789012";
const otherProjectId = "prj_1234567890123456789013";
const connectionId = "con_1234567890123456789012";
const project: InternalProject = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: projectId,
  ownerId: "owner-a",
  name: "Communication project",
  status: "active",
  enabledUtilities: ["communication"],
  fileManagement: {
    uploadUrlLifetimeMinutes: 15,
    downloadUrlLifetimeMinutes: 5,
    storageQuotaBytes: 5 * 2 ** 30,
    trashRetentionDays: 14,
  },
  fileManagementPolicyVersion: 1,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
};

const event = (body: unknown, pathParameters: Record<string, string> = { projectId }) => ({
  headers: { authorization: "Bearer owner-token" },
  requestContext: {
    authorizer: { jwt: { claims: { sub: "owner-a", token_use: "access" } } },
    requestId: "request-id",
    http: { method: "POST", path: "/v1/control/projects/project/connections" },
  },
  pathParameters,
  body: JSON.stringify(body),
});

describe("communication connection handlers", () => {
  it("lists only redacted connections for an authorized communication project", async () => {
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async () => undefined,
        inspect: async () => undefined,
        listForProject: async () => [
          {
            connectionId,
            projectId,
            provider: "green-api" as const,
            instanceId: "instance-a",
            status: "active" as const,
            createdAt: "2026-11-09T00:00:00.000Z",
            updatedAt: "2026-11-09T00:00:00.000Z",
            ownerId: "owner-a",
            secretReference: "private-parameter",
            secretVersion: 1,
          },
        ],
      },
      secretStore: { store: vi.fn(), remove: async () => undefined },
    });
    const response = await createListCommunicationConnectionsHandler(service, {
      inspect: async () => project,
    })(event(undefined));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(connectionId);
    expect(response.body).not.toContain("private-parameter");
  });

  it("redacts registration credentials from handler logs and response", async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const service = createCommunicationConnectionService({
      repository: { reserveAndCreate: async () => undefined, inspect: async () => undefined },
      secretStore: {
        store: async () => ({ reference: "secret-reference", version: 1 }),
        remove: async () => undefined,
      },
      generateId: () => "con_1234567890123456789012",
      now: () => new Date("2026-11-09T00:00:00.000Z"),
    });
    const response = await createRegisterCommunicationConnectionHandler(
      service,
      { inspect: async () => project },
      logger,
    )(
      event({
        provider: "green-api",
        instanceId: "instance-a",
        credential: "credential-material-that-is-long-enough",
      }),
    );
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain("credential-material-that-is-long-enough");
    expect(JSON.stringify(logger)).not.toContain("credential-material-that-is-long-enough");
  });

  it("rejects missing, cross-owner, and utility-disabled projects before it stores a credential", async () => {
    const candidates: ReadonlyArray<InternalProject | undefined> = [
      undefined,
      { ...project, ownerId: "owner-b" },
      { ...project, enabledUtilities: ["file-management"] },
    ];
    for (const candidate of candidates) {
      const store = vi.fn();
      const service = createCommunicationConnectionService({
        repository: { reserveAndCreate: async () => undefined, inspect: async () => undefined },
        secretStore: { store, remove: async () => undefined },
      });
      const response = await createRegisterCommunicationConnectionHandler(service, {
        inspect: async () => candidate,
      })(
        event({
          provider: "green-api",
          instanceId: "instance-a",
          credential: "credential-material-that-is-long-enough",
        }),
      );

      expect(response.statusCode).toBe(404);
      expect(store).not.toHaveBeenCalled();
    }
  });

  it.each([
    [createInspectCommunicationConnectionHandler, "inspect"],
    [createRotateCommunicationConnectionHandler, "rotate"],
    [createDisableCommunicationConnectionHandler, "disable"],
  ])("rejects a same-owner connection bound to another project before %s", async (factory) => {
    const record = {
      connectionId,
      projectId: otherProjectId,
      provider: "green-api" as const,
      instanceId: "instance-a",
      status: "active" as const,
      createdAt: "2026-11-09T00:00:00.000Z",
      updatedAt: "2026-11-09T00:00:00.000Z",
      ownerId: "owner-a",
      secretReference: "parameter",
      secretVersion: 1,
    };
    const rotate = vi.fn();
    const disable = vi.fn();
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async () => undefined,
        inspect: async () => record,
        updateLifecycle: async (...args) => {
          if (args[2].status === "disabled") disable();
          else rotate();
        },
      },
      secretStore: { store: vi.fn(), remove: async () => undefined },
    });
    const handler = factory(service, { inspect: async () => project });
    const response = await handler(
      event(
        factory === createRotateCommunicationConnectionHandler
          ? { credential: "credential-material-that-is-long-enough" }
          : undefined,
        { projectId, connectionId },
      ),
    );

    expect(response.statusCode).toBe(404);
    expect(rotate).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });
});
