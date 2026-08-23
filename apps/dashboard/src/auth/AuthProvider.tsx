import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AuthClient } from "./auth-client.js";

export type AuthStatus = "loading" | "signed-out" | "new-password-required" | "signed-in";

interface AuthContextValue {
  status: AuthStatus;
  error: string | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  confirmNewPassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const SAFE_AUTH_ERROR = "We could not complete authentication. Please try again.";

export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void client
      .restoreSession()
      .then((restored) => {
        if (active) setStatus(restored ? "signed-in" : "signed-out");
      })
      .catch(() => {
        if (active) setStatus("signed-out");
      });
    return () => {
      active = false;
    };
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      error,
      async signIn(email, password) {
        setError(undefined);
        try {
          const next = await client.signIn(email, password);
          setStatus(next === "signed-in" ? "signed-in" : "new-password-required");
        } catch {
          setStatus("signed-out");
          setError(SAFE_AUTH_ERROR);
        }
      },
      async confirmNewPassword(newPassword) {
        setError(undefined);
        try {
          await client.confirmNewPassword(newPassword);
          setStatus("signed-in");
        } catch {
          setError(SAFE_AUTH_ERROR);
        }
      },
      async signOut() {
        try {
          await client.signOut();
        } finally {
          setError(undefined);
          setStatus("signed-out");
        }
      },
      getAccessToken: () => client.getAccessToken(),
    }),
    [client, error, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
