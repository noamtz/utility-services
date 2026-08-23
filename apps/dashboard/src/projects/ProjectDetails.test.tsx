import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectDetails } from "./ProjectDetails.js";

describe("ProjectDetails", () => {
  it("shows only the public project configuration", () => {
    const { container } = render(
      <ProjectDetails
        project={{
          projectId: "prj_0123456789abcdefghijkl",
          name: "Documents",
          enabledUtilities: ["file-management"],
          fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
          createdAt: "2026-08-23T08:00:00.000Z",
          updatedAt: "2026-08-23T08:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("prj_0123456789abcdefghijkl")).toBeVisible();
    expect(screen.getByText("15 minutes")).toBeVisible();
    expect(screen.getByText("5 minutes")).toBeVisible();
    expect(container.textContent).not.toMatch(/owner|internal|partition|subject/i);
  });

  it("prompts for a selection without inventing details", () => {
    render(<ProjectDetails />);
    expect(screen.getByRole("heading", { name: "Select a project" })).toBeVisible();
  });
});
