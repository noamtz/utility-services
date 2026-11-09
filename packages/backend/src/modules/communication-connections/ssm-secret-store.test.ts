import { describe, expect, it, vi } from "vitest";

import {
  connectionCredentialParameterName,
  createSsmConnectionSecretStore,
} from "./ssm-secret-store.js";

describe("SSM communication credential store", () => {
  it("uses a stage-scoped opaque path", () => {
    expect(connectionCredentialParameterName("dev-israel-test", "con_1234567890123456789012")).toBe(
      "/utility-services/dev-israel-test/communication/con_1234567890123456789012",
    );
    expect(() =>
      connectionCredentialParameterName("bad/stage", "con_1234567890123456789012"),
    ).toThrow();
  });

  it("writes SecureString credentials and returns only reference and version", async () => {
    const send = vi.fn().mockResolvedValue({ Version: 4 });
    const store = createSsmConnectionSecretStore({
      client: { send } as never,
      stage: "dev-israel-test",
    });
    await expect(
      store.store({
        connectionId: "con_1234567890123456789012",
        credential: "credential-material-that-is-long-enough",
      }),
    ).resolves.toEqual({
      reference: "/utility-services/dev-israel-test/communication/con_1234567890123456789012",
      version: 4,
    });
    expect(JSON.stringify(send.mock.calls)).toContain("SecureString");
  });

  it("writes rotations to a distinct opaque parameter without overwriting the active reference", async () => {
    const send = vi.fn().mockResolvedValue({ Version: 1 });
    const store = createSsmConnectionSecretStore({
      client: { send } as never,
      stage: "dev-israel-test",
    });
    const rotated = await store.store({
      connectionId: "con_1234567890123456789012",
      credential: "credential-material-that-is-long-enough",
      version: 2,
    });
    expect(rotated).toMatchObject({ version: 2 });
    expect(rotated.reference).toMatch(
      /^\/utility-services\/dev-israel-test\/communication\/con_1234567890123456789012\/2-/,
    );
    const command = send.mock.calls[0]?.[0] as { input: { Overwrite?: boolean } };
    expect(command.input.Overwrite).toBe(false);
  });
});
