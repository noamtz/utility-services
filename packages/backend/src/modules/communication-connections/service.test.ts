import { describe, expect, it } from "vitest";

import { HttpError } from "../../core/http/handler.js";
import { DuplicateProviderInstanceError, createCommunicationConnectionService, type ConnectionRecord } from "./service.js";

const owner = { ownerId: "owner-a" };
const input = { provider: "green-api" as const, instanceId: "instance-a", credential: "credential-material-that-is-long-enough" };

describe("communication connection service", () => {
  it("stores the credential through the secret port and never returns it", async () => {
    const records: ConnectionRecord[] = [];
    let stored: string | undefined;
    const service = createCommunicationConnectionService({
      repository: { reserveAndCreate: async (record) => void records.push(record), inspect: async () => records[0] },
      secretStore: { store: async ({ credential }) => { stored = credential; return { reference: "secret-ref", version: 1 }; }, remove: async () => undefined },
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
      repository: { reserveAndCreate: async () => { throw new DuplicateProviderInstanceError(); }, inspect: async () => undefined },
      secretStore: { store: async () => ({ reference: "secret-ref", version: 1 }), remove: async () => undefined }, generateId: () => "con_1234567890123456789012",
    });
    await expect(service.create(owner, "prj_1234567890123456789012", input)).rejects.toMatchObject({ statusCode: 409, code: "PROVIDER_INSTANCE_ALREADY_BOUND" });
  });

  it("hides guessed and cross-owner connections as not found", async () => {
    const service = createCommunicationConnectionService({
      repository: { reserveAndCreate: async () => undefined, inspect: async () => ({ connectionId: "con_1234567890123456789012", projectId: "prj_1234567890123456789012", provider: "green-api", instanceId: "instance-a", status: "active", ownerId: "owner-b", secretReference: "ref", secretVersion: 1, createdAt: "2026-11-09T00:00:00.000Z", updatedAt: "2026-11-09T00:00:00.000Z" }) },
      secretStore: { store: async () => ({ reference: "secret-ref", version: 1 }), remove: async () => undefined },
    });
    await expect(service.inspect(owner, "con_1234567890123456789012")).rejects.toBeInstanceOf(HttpError);
  });
});
