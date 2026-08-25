import { Amplify } from "aws-amplify";
import {
  confirmSignIn as amplifyConfirmSignIn,
  fetchAuthSession as amplifyFetchAuthSession,
  getCurrentUser as amplifyGetCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
} from "aws-amplify/auth";

import type { DashboardConfig } from "../config.js";

type AuthConfig = Pick<DashboardConfig, "userPoolId" | "userPoolClientId">;

export type AuthSignInState = "signed-in" | "new-password-required";

export interface AuthClient {
  restoreSession: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<AuthSignInState>;
  confirmNewPassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string>;
}

interface AuthDependencies {
  configure(config: { Auth: { Cognito: { userPoolId: string; userPoolClientId: string } } }): void;
  signIn(input: { username: string; password: string }): Promise<{
    isSignedIn: boolean;
    nextStep: { signInStep: string };
  }>;
  confirmSignIn(input: { challengeResponse: string }): Promise<{
    isSignedIn: boolean;
    nextStep: { signInStep: string };
  }>;
  getCurrentUser(): Promise<unknown>;
  fetchAuthSession(): Promise<{ tokens?: { accessToken: { toString(): string } } }>;
  signOut(): Promise<void>;
}

const defaultDependencies: AuthDependencies = {
  configure: (config) => Amplify.configure(config),
  signIn: amplifySignIn,
  confirmSignIn: amplifyConfirmSignIn,
  getCurrentUser: amplifyGetCurrentUser,
  fetchAuthSession: amplifyFetchAuthSession,
  signOut: amplifySignOut,
};

let configuredKey: string | undefined;

function configureOnce(config: AuthConfig, dependencies: AuthDependencies) {
  const key = `${config.userPoolId}:${config.userPoolClientId}`;
  if (dependencies === defaultDependencies && configuredKey === key) return;
  dependencies.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
      },
    },
  });
  if (dependencies === defaultDependencies) configuredKey = key;
}

export function createAuthClient(
  config: AuthConfig,
  dependencies: AuthDependencies = defaultDependencies,
): AuthClient {
  configureOnce(config, dependencies);

  async function getAccessToken(): Promise<string> {
    const session = await dependencies.fetchAuthSession();
    const token = session.tokens?.accessToken.toString();
    if (!token) throw new Error("Authenticated session is unavailable");
    return token;
  }

  return {
    async restoreSession() {
      try {
        await dependencies.getCurrentUser();
        await getAccessToken();
        return true;
      } catch {
        return false;
      }
    },
    async signIn(email, password) {
      const result = await dependencies.signIn({ username: email, password });
      if (result.isSignedIn) return "signed-in";
      if (result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        return "new-password-required";
      }
      throw new Error("Unsupported authentication challenge");
    },
    async confirmNewPassword(newPassword) {
      const result = await dependencies.confirmSignIn({ challengeResponse: newPassword });
      if (!result.isSignedIn) throw new Error("Authentication challenge is incomplete");
    },
    signOut: () => dependencies.signOut(),
    getAccessToken,
  };
}
