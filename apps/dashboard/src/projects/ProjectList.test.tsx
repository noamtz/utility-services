import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "@utility-services/contracts";

import { ProjectList } from "./ProjectList.js";

const project: ProjectSummary = {
  projectId: "prj_0123456789abcdefghijkl",
  name: "Documents",
  enabledUtilities: ["file-management"],
  createdAt: "2026-08-23T08:00:00.000Z",
  updatedAt: "2026-08-23T08:00:00.000Z",
};

describe("ProjectList", () => {
  it("renders loading, empty, and error states", () => {
    const props = {
      projects: [],
      loading: true,
      hasMore: false,
      onSelect: vi.fn(),
      onLoadMore: vi.fn(),
    };
    const { rerender } = render(<ProjectList {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects");
    rerender(<ProjectList {...props} loading={false} />);
    expect(screen.getByText("No projects yet.")).toBeVisible();
    rerender(<ProjectList {...props} loading={false} error="Could not load projects." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load projects.");
  });

  it("selects a project and requests another cursor page", () => {
    const onSelect = vi.fn();
    const onLoadMore = vi.fn();
    render(
      <ProjectList
        projects={[project]}
        loading={false}
        hasMore
        onSelect={onSelect}
        onLoadMore={onLoadMore}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Documents/ }));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onSelect).toHaveBeenCalledWith(project.projectId);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
