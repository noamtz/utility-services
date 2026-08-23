import { useMemo } from "react";

import { SignInForm } from "./auth/SignInForm.js";
import { useAuth } from "./auth/AuthProvider.js";
import { ProjectView } from "./projects/ProjectView.js";
import { createProjectApi, type ProjectApi } from "./projects/api.js";

export function App({ projectApi }: { projectApi?: ProjectApi }) {
  const auth = useAuth();
  const api = useMemo(
    () => projectApi ?? createProjectApi({ getAccessToken: () => auth.getAccessToken() }),
    [auth.getAccessToken, projectApi],
  );

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
      <ProjectView api={api} onUnauthorized={() => auth.signOut()} />
    </main>
  );
}
