import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AuthClient } from "./auth-client.js";
import { AuthProvider } from "./AuthProvider.js";
import { SignInForm } from "./SignInForm.js";

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

describe("SignInForm", () => {
  it("submits an invited owner's email and password without a sign-up path", async () => {
    const signIn = vi.fn().mockResolvedValue("signed-in");
    render(
      <AuthProvider client={client({ signIn })}>
        <SignInForm />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Sign in" });

    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "temporary");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signIn).toHaveBeenCalledWith("owner@example.com", "temporary");
    expect(screen.queryByRole("link", { name: /sign up/i })).not.toBeInTheDocument();
  });

  it("collects a new password for the Cognito invitation challenge", async () => {
    const confirmNewPassword = vi.fn().mockResolvedValue(undefined);
    render(
      <AuthProvider
        client={client({
          restoreSession: vi.fn().mockResolvedValue(false),
          signIn: vi.fn().mockResolvedValue("new-password-required"),
          confirmNewPassword,
        })}
      >
        <SignInForm />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "temporary");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Choose a new password" });

    await user.type(screen.getByLabelText("New password"), "replacement");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(confirmNewPassword).toHaveBeenCalledWith("replacement");
  });
});
