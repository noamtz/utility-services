import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CredentialApi } from "./api.js";
import { ApiKeyPanel } from "./ApiKeyPanel.js";

const keyId = "key_0123456789abcdefghijkl";
const issued = {
  apiKey: `rus_v1.${keyId}.${"s".repeat(43)}`,
  metadata: {
    keyId,
    status: "active" as const,
    createdAt: "2026-08-24T10:00:00.000Z",
    updatedAt: "2026-08-24T10:00:00.000Z",
  },
};

describe("ApiKeyPanel", () => {
  it("reveals a newly issued secret once, then lets the owner dismiss it", async () => {
    const api: CredentialApi = {
      list: vi.fn().mockResolvedValue({ items: [] }),
      issue: vi.fn().mockResolvedValue(issued),
      revoke: vi.fn(),
      replace: vi.fn(),
    };
    render(<ApiKeyPanel projectId="prj_0123456789abcdefghijkl" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create API key" }));
    expect(await screen.findByText(issued.apiKey)).toBeVisible();
    expect(screen.getByText(/will not be shown again/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "I saved it" }));
    expect(screen.queryByText(issued.apiKey)).not.toBeInTheDocument();
  });

  it("lists active key metadata and supports replace and revoke operations", async () => {
    const active = issued.metadata;
    const replace = vi.fn().mockResolvedValue(issued);
    const revoke = vi.fn().mockResolvedValue({ metadata: { ...active, status: "revoked" } });
    const api: CredentialApi = {
      list: vi.fn().mockResolvedValue({ items: [active] }),
      issue: vi.fn(),
      replace,
      revoke,
    };
    render(<ApiKeyPanel projectId="prj_0123456789abcdefghijkl" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledWith("prj_0123456789abcdefghijkl", keyId),
    );
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await vi.waitFor(() =>
      expect(revoke).toHaveBeenCalledWith("prj_0123456789abcdefghijkl", keyId),
    );
  });

  it("renders non-active metadata without lifecycle actions", async () => {
    const api: CredentialApi = {
      list: vi.fn().mockResolvedValue({ items: [{ ...issued.metadata, status: "revoked" }] }),
      issue: vi.fn(),
      replace: vi.fn(),
      revoke: vi.fn(),
    };
    render(<ApiKeyPanel projectId="prj_0123456789abcdefghijkl" api={api} />);
    expect(await screen.findByText("revoked")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
  });
});
