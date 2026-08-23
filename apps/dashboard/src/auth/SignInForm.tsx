import { useState, type FormEvent } from "react";

import { useAuth } from "./AuthProvider.js";

export function SignInForm() {
  const { status, error, signIn, confirmNewPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "new-password-required") {
      await confirmNewPassword(newPassword);
    } else {
      await signIn(email, password);
    }
  }

  const changingPassword = status === "new-password-required";
  return (
    <section className="auth-card" aria-labelledby="sign-in-title">
      <p className="eyebrow">Invite-only access</p>
      <h1 id="sign-in-title">{changingPassword ? "Choose a new password" : "Sign in"}</h1>
      <p>Use the email address from your administrator invitation.</p>
      <form onSubmit={(event) => void submit(event)}>
        {!changingPassword && (
          <>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </>
        )}
        {changingPassword && (
          <>
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <button type="submit">{changingPassword ? "Set password" : "Sign in"}</button>
      </form>
    </section>
  );
}
