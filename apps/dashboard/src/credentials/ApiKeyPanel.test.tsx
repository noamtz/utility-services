import { act, fireEvent, render, screen } from "@testing-library/react";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function metadata(keyIdValue: string) {
  return {
    ...issued.metadata,
    keyId: keyIdValue,
  };
}

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
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(keyId);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm replacement" }));
    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledWith("prj_0123456789abcdefghijkl", keyId),
    );
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm revocation" }));
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

  it("does not reveal an issued secret after switching projects", async () => {
    const pendingIssue = deferred<typeof issued>();
    const api: CredentialApi = {
      list: vi.fn().mockResolvedValue({ items: [] }),
      issue: vi.fn().mockReturnValue(pendingIssue.promise),
      revoke: vi.fn(),
      replace: vi.fn(),
    };
    const { rerender } = render(<ApiKeyPanel projectId="prj_0123456789abcdefghijkl" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create API key" }));
    rerender(<ApiKeyPanel projectId="prj_bcdefghijklmnopqrstuvw" api={api} />);
    await act(async () => {
      pendingIssue.resolve(issued);
      await pendingIssue.promise;
    });
    expect(screen.queryByText(issued.apiKey)).not.toBeInTheDocument();
  });

  it("does not reveal a replacement secret after switching projects", async () => {
    const pendingReplacement = deferred<typeof issued>();
    const api: CredentialApi = {
      list: vi.fn().mockImplementation((projectId) =>
        Promise.resolve({
          items: projectId === "prj_0123456789abcdefghijkl" ? [issued.metadata] : [],
        }),
      ),
      issue: vi.fn(),
      revoke: vi.fn(),
      replace: vi.fn().mockReturnValue(pendingReplacement.promise),
    };
    const { rerender } = render(<ApiKeyPanel projectId="prj_0123456789abcdefghijkl" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm replacement" }));
    rerender(<ApiKeyPanel projectId="prj_bcdefghijklmnopqrstuvw" api={api} />);
    await act(async () => {
      pendingReplacement.resolve(issued);
      await pendingReplacement.promise;
    });
    expect(screen.queryByText(issued.apiKey)).not.toBeInTheDocument();
  });

  it("ignores a stale key list after switching projects", async () => {
    const pendingFirstList = deferred<{ items: Array<typeof issued.metadata> }>();
    const firstKeyId = "key_aaaaaaaaaaaaaaaaaaaaaa";
    const secondKeyId = "key_bbbbbbbbbbbbbbbbbbbbbb";
    const api: CredentialApi = {
      list: vi
        .fn()
        .mockImplementation((projectId) =>
          projectId === "prj_0123456789abcdefghijkl"
            ? pendingFirstList.promise
            : Promise.resolve({ items: [metadata(secondKeyId)] }),
        ),
      issue: vi.fn(),
      revoke: vi.fn(),
      replace: vi.fn(),
    };
    const { rerender } = render(<ApiKeyPanel projectId="prj_0123456789abcdefghijkl" api={api} />);
    rerender(<ApiKeyPanel projectId="prj_bcdefghijklmnopqrstuvw" api={api} />);
    expect(await screen.findByText(secondKeyId)).toBeVisible();
    await act(async () => {
      pendingFirstList.resolve({ items: [metadata(firstKeyId)] });
      await pendingFirstList.promise;
    });
    expect(screen.queryByText(firstKeyId)).not.toBeInTheDocument();
    expect(screen.getByText(secondKeyId)).toBeVisible();
  });
});
