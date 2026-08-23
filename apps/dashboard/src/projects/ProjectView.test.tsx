import { fireEvent, render, screen } from "@testing-library/react";
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
});
