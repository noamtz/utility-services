import { useMemo } from "react";

import { createControlClient } from "./api/control-client.js";
import { SignInForm } from "./auth/SignInForm.js";
import { useAuth } from "./auth/AuthProvider.js";
import { ProjectView } from "./projects/ProjectView.js";
import { createProjectApi, type ProjectApi } from "./projects/api.js";
import { createCredentialApi, type CredentialApi } from "./credentials/api.js";
import { createUsageApi, type UsageApi } from "./usage/api.js";

export function App({
  projectApi,
  credentialApi,
  usageApi,
  apiBaseUrl = "https://api.example.invalid",
}: {
  projectApi?: ProjectApi;
  credentialApi?: CredentialApi;
  usageApi?: UsageApi;
  apiBaseUrl?: string;
}) {
  const auth = useAuth();
  const controlClient = useMemo(
    () =>
      createControlClient({
        getAccessToken: () => auth.getAccessToken(),
        onUnauthorized: () => auth.signOut(),
      }),
    [auth.getAccessToken, auth.signOut],
  );
  const api = useMemo(
    () => projectApi ?? createProjectApi({ getAccessToken: () => auth.getAccessToken() }),
    [auth.getAccessToken, projectApi],
  );
  const keys = useMemo(
    () => credentialApi ?? createCredentialApi(controlClient),
    [credentialApi, controlClient],
  );
  const usage = useMemo(() => usageApi ?? createUsageApi(controlClient), [usageApi, controlClient]);

  if (auth.status === "loading") {
    return (
      <main className="shell">
        <p role="status">Restoring your session…</p>
      </main>
    );
  }

  if (auth.status === "signed-out" || auth.status === "new-password-required") {
    return (
      <main className="shell">
        <SignInForm />
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Reusable Utility Services</p>
          <h1>Project control</h1>
        </div>
        <button type="button" onClick={() => void auth.signOut().catch(() => undefined)}>
          Sign out
        </button>
      </header>
      <ProjectView
        api={api}
        credentialApi={keys}
        usageApi={usage}
        apiBaseUrl={apiBaseUrl}
        onUnauthorized={() => auth.signOut()}
      />
    </main>
  );
}
