import { useEffect, useState } from "react";

import type { ApiKeyMetadata, IssuedApiKey } from "@utility-services/contracts";

import { ControlApiError } from "../api/control-client.js";
import { CopyButton } from "../shared/CopyButton.js";
import type { CredentialApi } from "./api.js";

export function ApiKeyPanel({ projectId, api }: { projectId: string; api: CredentialApi }) {
  const [keys, setKeys] = useState<ApiKeyMetadata[]>([]);
  const [issued, setIssued] = useState<IssuedApiKey>();
  const [busy, setBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const [error, setError] = useState<string>();

  async function load(cursor?: string) {
    try {
      setError(undefined);
      const page = await api.list(projectId, cursor ? { cursor } : undefined);
      setKeys((current) => (cursor ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (failure) {
      setError(
        failure instanceof ControlApiError ? failure.message : "API keys could not be loaded.",
      );
    }
  }

  useEffect(() => {
    setIssued(undefined);
    setKeys([]);
    void load();
  }, [projectId, api]);

  async function run(operation: () => Promise<IssuedApiKey | undefined>) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await operation();
      if (result) setIssued(result);
      await load();
    } catch (failure) {
      setError(
        failure instanceof ControlApiError ? failure.message : "The API key request failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel experience-panel" aria-labelledby="api-key-title">
      <p className="eyebrow">Server authentication</p>
      <div className="section-heading">
        <div>
          <h2 id="api-key-title">Project API keys</h2>
          <p>Use these secrets only on your server. Never ship one in browser or mobile code.</p>
          <p className="field-note">
            Revoking or replacing a key stops new authorizations; already-issued presigned URLs can
            remain usable until their short expiry.
          </p>
        </div>
        <button type="button" disabled={busy} onClick={() => void run(() => api.issue(projectId))}>
          Create API key
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {issued && (
        <div className="secret-reveal" role="status">
          <strong>Copy this key now. It will not be shown again.</strong>
          <code>{issued.apiKey}</code>
          <div className="button-row">
            <CopyButton value={issued.apiKey} label="Copy API key" />
            <button type="button" className="quiet-button" onClick={() => setIssued(undefined)}>
              I saved it
            </button>
          </div>
        </div>
      )}
      {nextCursor && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void load(nextCursor)}
        >
          Load more keys
        </button>
      )}
      {keys.length === 0 ? (
        <p>No API keys yet.</p>
      ) : (
        <ul className="key-list">
          {keys.map((key) => (
            <li key={key.keyId}>
              <div>
                <code>{key.keyId}</code>
                <span className={`status status-${key.status}`}>{key.status}</span>
              </div>
              <small>Created {new Date(key.createdAt).toLocaleString()}</small>
              {key.status === "active" && (
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void run(() => api.replace(projectId, key.keyId))}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.revoke(projectId, key.keyId);
                        return undefined;
                      })
                    }
                  >
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
