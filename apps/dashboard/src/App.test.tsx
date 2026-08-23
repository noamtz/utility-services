import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import type { AuthClient } from "./auth/auth-client.js";
import { AuthProvider } from "./auth/AuthProvider.js";
import type { ProjectApi } from "./projects/api.js";

function renderApp(authOverrides: Partial<AuthClient> = {}) {
  const authClient: AuthClient = {
    restoreSession: vi.fn().mockResolvedValue(false),
    signIn: vi.fn().mockResolvedValue("signed-in"),
    confirmNewPassword: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockResolvedValue("access-token"),
    ...authOverrides,
  };
  const projectApi: ProjectApi = {
    create: vi.fn(),
    list: vi.fn().mockResolvedValue({ items: [] }),
    inspect: vi.fn(),
  };
  const rendered = render(
    <AuthProvider client={authClient}>
      <App projectApi={projectApi} />
    </AuthProvider>,
  );
  return { authClient, projectApi, ...rendered };
}

describe("App", () => {
  it("restores a session before showing invite-only sign-in with no registration path", async () => {
    const { container } = renderApp();
    expect(screen.getByRole("status")).toHaveTextContent("Restoring your session");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /sign up|register/i })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/Bearer |access-token|VITE_/i);
  });

  it("shows project control for an authenticated owner and signs out", async () => {
    const { authClient } = renderApp({ restoreSession: vi.fn().mockResolvedValue(true) });
    expect(await screen.findByRole("heading", { name: "Project control" })).toBeVisible();
    expect(await screen.findByText("No projects yet.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(authClient.signOut).toHaveBeenCalledOnce();
  });
});
