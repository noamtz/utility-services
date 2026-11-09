import { describe, expect, it, vi } from "vitest";

import { connectionCredentialParameterName, createSsmConnectionSecretStore } from "./ssm-secret-store.js";

describe("SSM communication credential store", () => {
  it("uses a stage-scoped opaque path", () => {
    expect(connectionCredentialParameterName("dev-israel-test", "con_1234567890123456789012")).toBe(
      "/utility-services/dev-israel-test/communication/con_1234567890123456789012",
    );
    expect(() => connectionCredentialParameterName("bad/stage", "con_1234567890123456789012")).toThrow();
  });

  it("writes SecureString credentials and returns only reference and version", async () => {
    const send = vi.fn().mockResolvedValue({ Version: 4 });
    const store = createSsmConnectionSecretStore({ client: { send } as never, stage: "dev-israel-test" });
    await expect(store.store({ connectionId: "con_1234567890123456789012", credential: "credential-material-that-is-long-enough" })).resolves.toEqual({ reference: "/utility-services/dev-israel-test/communication/con_1234567890123456789012", version: 4 });
    expect(JSON.stringify(send.mock.calls)).toContain("SecureString");
  });
});
