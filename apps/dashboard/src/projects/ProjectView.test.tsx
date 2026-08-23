import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProjectApi } from "./api.js";
import { ProjectApiError } from "./api.js";
import { ProjectView } from "./ProjectView.js";

const summary = {
  projectId: "prj_0123456789abcdefghijkl",
  name: "Documents",
  enabledUtilities: ["file-management"] as const,
  createdAt: "2026-08-23T08:00:00.000Z",
  updatedAt: "2026-08-23T08:00:00.000Z",
};
const project = {
  ...summary,
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("ProjectView", () => {
  it("loads, inspects, creates, and refreshes owner projects", async () => {
    const api: ProjectApi = {
      list: vi
        .fn()
        .mockResolvedValueOnce({ items: [summary] })
        .mockResolvedValueOnce({ items: [summary] }),
      inspect: vi.fn().mockResolvedValue(project),
      create: vi.fn().mockResolvedValue(project),
    };
    render(<ProjectView api={api} onUnauthorized={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Documents/ }));
    expect(await screen.findByText("15 minutes")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Documents" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create project" }).closest("form")!);
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("ends the local session when the API reports an unauthorized request", async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(undefined);
    const api: ProjectApi = {
      list: vi.fn().mockRejectedValue(new ProjectApiError("Session expired", 401, "UNAUTHORIZED")),
      inspect: vi.fn(),
      create: vi.fn(),
    };
    render(<ProjectView api={api} onUnauthorized={onUnauthorized} />);
    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    expect(screen.queryByText(/Session expired/)).not.toBeInTheDocument();
  });

  it("keeps a post-create refresh when an older list request finishes later", async () => {
    const initial = deferred<{ items: (typeof summary)[] }>();
    const refreshed = deferred<{ items: (typeof summary)[] }>();
    const newerSummary = {
      ...summary,
      projectId: "prj_0123456789abcdefghijkm",
      name: "Newer project",
    };
    const api: ProjectApi = {
      list: vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(refreshed.promise),
      inspect: vi.fn(),
      create: vi.fn().mockResolvedValue(project),
    };
    render(<ProjectView api={api} onUnauthorized={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Created" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create project" }).closest("form")!);
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    await act(() => {
      refreshed.resolve({ items: [newerSummary] });
      return refreshed.promise;
    });
    expect(await screen.findByRole("button", { name: /Newer project/ })).toBeVisible();

    await act(() => {
      initial.resolve({ items: [summary] });
      return initial.promise;
    });
    expect(screen.getByRole("button", { name: /Newer project/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Documents/ })).not.toBeInTheDocument();
  });

  it("requests an in-flight pagination cursor only once", async () => {
    const nextPage = deferred<{ items: (typeof summary)[] }>();
    const api: ProjectApi = {
      list: vi
        .fn()
        .mockResolvedValueOnce({ items: [summary], nextCursor: "cursor-1" })
        .mockReturnValueOnce(nextPage.promise),
      inspect: vi.fn(),
      create: vi.fn(),
    };
    render(<ProjectView api={api} onUnauthorized={vi.fn()} />);
    const loadMore = await screen.findByRole("button", { name: "Load more" });

    act(() => {
      loadMore.click();
      loadMore.click();
    });

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenLastCalledWith({ cursor: "cursor-1" });
    await act(() => {
      nextPage.resolve({ items: [] });
      return nextPage.promise;
    });
  });
});
