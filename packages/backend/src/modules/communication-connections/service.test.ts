/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../core/http/handler.js";
import {
  DuplicateProviderInstanceError,
  ProjectCommunicationAlreadyBoundError,
  createCommunicationConnectionService,
  type ConnectionRecord,
} from "./service.js";

const owner = { ownerId: "owner-a" };
const input = {
  provider: "green-api" as const,
  instanceId: "instance-a",
  credential: "credential-material-that-is-long-enough",
};

describe("communication connection service", () => {
  it("stores the credential through the secret port and never returns it", async () => {
    const records: ConnectionRecord[] = [];
    let stored: string | undefined;
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async (record) => void records.push(record),
        inspect: async () => records[0],
      },
      secretStore: {
        store: async ({ credential }) => {
          stored = credential;
          return { reference: "secret-ref", version: 1 };
        },
        remove: async () => undefined,
      },
      generateId: () => "con_1234567890123456789012",
      now: () => new Date("2026-11-09T00:00:00.000Z"),
    });
    const connection = await service.create(owner, "prj_1234567890123456789012", input);
    expect(stored).toBe(input.credential);
    expect(records[0]).toMatchObject({ secretReference: "secret-ref" });
    expect(connection).not.toHaveProperty("credential");
    expect(JSON.stringify(connection)).not.toContain(input.credential);
  });

  it("rejects an installation-wide duplicate instance", async () => {
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async () => {
          throw new DuplicateProviderInstanceError();
        },
        inspect: async () => undefined,
      },
      secretStore: {
        store: async () => ({ reference: "secret-ref", version: 1 }),
        remove: async () => undefined,
      },
      generateId: () => "con_1234567890123456789012",
    });
    await expect(service.create(owner, "prj_1234567890123456789012", input)).rejects.toMatchObject({
      statusCode: 409,
      code: "PROVIDER_INSTANCE_ALREADY_BOUND",
    });
  });

  it("rejects a second distinct provider instance for the same project, including disabled bindings", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async () => {
          throw new ProjectCommunicationAlreadyBoundError();
        },
        inspect: async () => undefined,
      },
      secretStore: {
        store: async () => ({ reference: "secret-ref", version: 1 }),
        remove,
      },
      generateId: () => "con_1234567890123456789012",
    });
    await expect(
      service.create(owner, "prj_1234567890123456789012", {
        ...input,
        instanceId: "distinct-instance",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "PROJECT_COMMUNICATION_ALREADY_BOUND",
    });
    expect(remove).toHaveBeenCalledWith("secret-ref");
  });

  it("hides guessed and cross-owner connections as not found", async () => {
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async () => undefined,
        inspect: async () => ({
          connectionId: "con_1234567890123456789012",
          projectId: "prj_1234567890123456789012",
          provider: "green-api",
          instanceId: "instance-a",
          status: "active",
          ownerId: "owner-b",
          secretReference: "ref",
          secretVersion: 1,
          createdAt: "2026-11-09T00:00:00.000Z",
          updatedAt: "2026-11-09T00:00:00.000Z",
        }),
      },
      secretStore: {
        store: async () => ({ reference: "secret-ref", version: 1 }),
        remove: async () => undefined,
      },
    });
    await expect(service.inspect(owner, "con_1234567890123456789012")).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it("returns the single redacted project connection for discovery", async () => {
    const discovered: ConnectionRecord = {
      connectionId: "con_1234567890123456789012",
      projectId: "prj_1234567890123456789012",
      provider: "green-api",
      instanceId: "instance-a",
      status: "disabled",
      ownerId: "owner-a",
      secretReference: "secret-ref",
      secretVersion: 1,
      createdAt: "2026-11-09T00:00:00.000Z",
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async () => undefined,
        inspect: async () => undefined,
        listForProject: async () => [discovered],
      },
      secretStore: {
        store: async () => ({ reference: "secret-ref", version: 1 }),
        remove: async () => undefined,
      },
    });
    await expect(service.list(owner, discovered.projectId)).resolves.toEqual([
      expect.objectContaining({ connectionId: discovered.connectionId, status: "disabled" }),
    ]);
  });

  it("rotates to a new opaque parameter and retires the previous reference after metadata CAS", async () => {
    const current: ConnectionRecord = {
      connectionId: "con_1234567890123456789012",
      projectId: "prj_1234567890123456789012",
      provider: "green-api",
      instanceId: "instance-a",
      status: "active",
      ownerId: "owner-a",
      secretReference: "ref",
      secretVersion: 1,
      createdAt: "2026-11-09T00:00:00.000Z",
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const updateLifecycle = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async () => undefined,
        inspect: async () => current,
        updateLifecycle,
      },
      secretStore: {
        store: async () => ({ reference: "ref-v2", version: 2 }),
        remove,
      },
      now: () => new Date("2026-11-10T00:00:00.000Z"),
    });
    await expect(
      service.rotate(owner, current.connectionId, input.credential),
    ).resolves.toMatchObject({ status: "active" });
    expect(updateLifecycle).toHaveBeenCalledWith(
      current.connectionId,
      1,
      expect.objectContaining({ secretReference: "ref-v2", secretVersion: 2 }),
    );
    expect(remove).toHaveBeenCalledWith("ref");
  });

  it("removes an orphaned rotated parameter when the metadata CAS loses the race", async () => {
    const current: ConnectionRecord = {
      connectionId: "con_1234567890123456789012",
      projectId: "prj_1234567890123456789012",
      provider: "green-api",
      instanceId: "instance-a",
      status: "active",
      ownerId: "owner-a",
      secretReference: "ref-v1",
      secretVersion: 1,
      createdAt: "2026-11-09T00:00:00.000Z",
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async () => undefined,
        inspect: async () => current,
        updateLifecycle: async () => {
          throw new DuplicateProviderInstanceError();
        },
      },
      secretStore: {
        store: async () => ({ reference: "ref-v2", version: 2 }),
        remove,
      },
    });
    await expect(
      service.rotate(owner, current.connectionId, input.credential),
    ).rejects.toMatchObject({ code: "CONNECTION_CHANGED" });
    expect(remove).toHaveBeenCalledWith("ref-v2");
    expect(remove).not.toHaveBeenCalledWith("ref-v1");
  });

  it("refuses to rotate a disabled connection", async () => {
    const current: ConnectionRecord = {
      connectionId: "con_1234567890123456789012",
      projectId: "prj_1234567890123456789012",
      provider: "green-api",
      instanceId: "instance-a",
      status: "disabled",
      ownerId: "owner-a",
      secretReference: "ref",
      secretVersion: 1,
      createdAt: "2026-11-09T00:00:00.000Z",
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const service = createCommunicationConnectionService({
      repository: { reserveAndCreate: async () => undefined, inspect: async () => current },
      secretStore: {
        store: async () => ({ reference: "ref", version: 2 }),
        remove: async () => undefined,
      },
    });
    await expect(
      service.rotate(owner, current.connectionId, input.credential),
    ).rejects.toMatchObject({ code: "CONNECTION_DISABLED" });
  });

  it("removes a newly stored credential when atomic connection reservation fails", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = createCommunicationConnectionService({
      repository: {
        reserveAndCreate: async () => {
          throw new Error("transient");
        },
        inspect: async () => undefined,
      },
      secretStore: { store: async () => ({ reference: "new-ref", version: 1 }), remove },
      generateId: () => "con_1234567890123456789012",
    });
    await expect(service.create(owner, "prj_1234567890123456789012", input)).rejects.toThrow(
      "transient",
    );
    expect(remove).toHaveBeenCalledWith("new-ref");
  });
});
