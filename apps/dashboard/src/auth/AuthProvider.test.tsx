import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { AuthClient } from "./auth-client.js";
import { AuthProvider, useAuth } from "./AuthProvider.js";

function client(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    restoreSession: vi.fn().mockResolvedValue(false),
    signIn: vi.fn().mockResolvedValue("signed-in"),
    confirmNewPassword: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockResolvedValue("token"),
    ...overrides,
  };
}

function wrapper(authClient: AuthClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthProvider client={authClient}>{children}</AuthProvider>;
  };
}

describe("AuthProvider", () => {
  it("restores an authenticated session", async () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: wrapper(client({ restoreSession: vi.fn().mockResolvedValue(true) })),
    });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("signed-in"));
  });

  it("fails a rejected session restore closed to signed out", async () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: wrapper(client({ restoreSession: vi.fn().mockRejectedValue(new Error("private")) })),
    });

    await waitFor(() => expect(result.current.status).toBe("signed-out"));
  });

  it("moves through sign-in and required-new-password states", async () => {
    const authClient = client({ signIn: vi.fn().mockResolvedValue("new-password-required") });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(authClient) });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    await act(() => result.current.signIn("owner@example.com", "temporary"));
    expect(result.current.status).toBe("new-password-required");
    await act(() => result.current.confirmNewPassword("new-password"));
    expect(result.current.status).toBe("signed-in");
  });

  it("uses one generic error and signs out even if provider cleanup fails", async () => {
    const authClient = client({
      signIn: vi.fn().mockRejectedValue(new Error("private provider details")),
      signOut: vi.fn().mockRejectedValue(new Error("private signout details")),
    });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(authClient) });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    await act(() => result.current.signIn("owner@example.com", "wrong"));
    expect(result.current.error).toBe("We could not complete authentication. Please try again.");
    await expect(act(() => result.current.signOut())).rejects.toThrow();
    expect(result.current.status).toBe("signed-out");
  });
});
