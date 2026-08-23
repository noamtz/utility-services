import { describe, expect, it, vi } from "vitest";

import { createAuthClient } from "./auth-client.js";

const config = {
  userPoolId: "il-central-1_AbCdEf123",
  userPoolClientId: "0123456789abcdefghijklmnop",
};

function dependencies() {
  return {
    configure: vi.fn(),
    signIn: vi.fn().mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } }),
    confirmSignIn: vi
      .fn()
      .mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } }),
    getCurrentUser: vi.fn().mockResolvedValue({ username: "owner" }),
    fetchAuthSession: vi.fn().mockResolvedValue({
      tokens: { accessToken: { toString: () => "access-token" } },
    }),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Amplify auth client", () => {
  it("configures only the existing public Cognito resources", () => {
    const deps = dependencies();
    createAuthClient(config, deps);

    expect(deps.configure).toHaveBeenCalledWith({
      Auth: {
        Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.userPoolClientId },
      },
    });
    expect(JSON.stringify(deps.configure.mock.calls)).not.toMatch(/secret|identityPool/i);
  });

  it("restores a current session and returns the access token only on demand", async () => {
    const deps = dependencies();
    const client = createAuthClient(config, deps);

    await expect(client.restoreSession()).resolves.toBe(true);
    await expect(client.getAccessToken()).resolves.toBe("access-token");
    expect(deps.getCurrentUser).toHaveBeenCalledOnce();
    expect(deps.fetchAuthSession).toHaveBeenCalledTimes(2);
  });

  it("treats unavailable restore state as signed out", async () => {
    const deps = dependencies();
    deps.getCurrentUser.mockRejectedValue(new Error("private provider error"));

    await expect(createAuthClient(config, deps).restoreSession()).resolves.toBe(false);
  });

  it("supports normal sign-in and the required-new-password challenge", async () => {
    const deps = dependencies();
    const client = createAuthClient(config, deps);

    await expect(client.signIn("owner@example.com", "temporary")).resolves.toBe("signed-in");
    deps.signIn.mockResolvedValueOnce({
      isSignedIn: false,
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" },
    });
    await expect(client.signIn("owner@example.com", "temporary")).resolves.toBe(
      "new-password-required",
    );
    await expect(client.confirmNewPassword("new-password")).resolves.toBeUndefined();
    expect(deps.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: "new-password" });
  });

  it("rejects unsupported challenges and missing access tokens safely", async () => {
    const deps = dependencies();
    deps.signIn.mockResolvedValueOnce({ isSignedIn: false, nextStep: { signInStep: "MFA" } });
    const client = createAuthClient(config, deps);

    await expect(client.signIn("owner@example.com", "password")).rejects.toThrow(
      "Unsupported authentication challenge",
    );
    deps.fetchAuthSession.mockResolvedValueOnce({});
    await expect(client.getAccessToken()).rejects.toThrow("Authenticated session is unavailable");
  });

  it("signs out without retaining session material", async () => {
    const deps = dependencies();
    const client = createAuthClient(config, deps);

    await client.signOut();

    expect(deps.signOut).toHaveBeenCalledOnce();
    expect(Object.keys(client)).not.toContain("token");
  });
});
