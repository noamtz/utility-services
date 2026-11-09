import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectDetails } from "./ProjectDetails.js";
import { ProjectApiError } from "./api.js";

describe("ProjectDetails", () => {
  it("shows only the public project configuration", () => {
    const { container } = render(
      <ProjectDetails
        project={{
          projectId: "prj_0123456789abcdefghijkl",
          name: "Documents",
          enabledUtilities: ["file-management"],
          fileManagement: {
            uploadUrlLifetimeMinutes: 15,
            downloadUrlLifetimeMinutes: 5,
            storageQuotaBytes: 5 * 2 ** 30,
            trashRetentionDays: 14,
          },
          createdAt: "2026-08-23T08:00:00.000Z",
          updatedAt: "2026-08-23T08:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("prj_0123456789abcdefghijkl")).toBeVisible();
    expect(screen.getByText("15 minutes")).toBeVisible();
    expect(screen.getByText("5 minutes")).toBeVisible();
    expect(screen.getByText("5,368,709,120 bytes")).toBeVisible();
    expect(screen.getByText("14 days")).toBeVisible();
    expect(container.textContent).not.toMatch(/owner|internal|partition|subject/i);
  });

  it("updates policy with bounded values and shows a safe quota conflict", async () => {
    const onUpdatePolicy = vi
      .fn()
      .mockRejectedValue(new ProjectApiError("quota", 409, "STORAGE_QUOTA_BELOW_ACCOUNTED"));
    render(
      <ProjectDetails
        project={{
          projectId: "prj_0123456789abcdefghijkl",
          name: "Documents",
          enabledUtilities: ["file-management"],
          fileManagement: {
            uploadUrlLifetimeMinutes: 15,
            downloadUrlLifetimeMinutes: 5,
            storageQuotaBytes: 5 * 2 ** 30,
            trashRetentionDays: 14,
          },
          createdAt: "2026-08-23T08:00:00.000Z",
          updatedAt: "2026-08-23T08:00:00.000Z",
        }}
        policyLimits={{
          minStorageQuotaBytes: 1,
          maxStorageQuotaBytes: 10 * 2 ** 30,
          minTrashRetentionDays: 1,
          maxTrashRetentionDays: 90,
        }}
        onUpdatePolicy={onUpdatePolicy}
      />,
    );

    fireEvent.change(screen.getByLabelText("Storage quota (bytes)"), { target: { value: "1" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save policy" }).closest("form")!);

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be lower/i);
  });

  it("prompts for a selection without inventing details", () => {
    render(<ProjectDetails />);
    expect(screen.getByRole("heading", { name: "Select a project" })).toBeVisible();
  });
});
