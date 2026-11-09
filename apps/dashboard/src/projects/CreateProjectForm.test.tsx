import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreateProjectForm } from "./CreateProjectForm.js";

describe("CreateProjectForm", () => {
  it("submits File Management with default lifetimes, quota, and trash retention", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<CreateProjectForm onCreate={onCreate} />);

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Documents" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create project" }).closest("form")!);

    await vi.waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: "Documents",
        enabledUtilities: ["file-management"],
        fileManagement: {
          uploadUrlLifetimeMinutes: 15,
          downloadUrlLifetimeMinutes: 5,
          storageQuotaBytes: 5 * 2 ** 30,
          trashRetentionDays: 14,
        },
      }),
    );
  });

  it("uses deployment policy limits as input bounds", () => {
    render(
      <CreateProjectForm
        onCreate={vi.fn().mockResolvedValue(undefined)}
        policyLimits={{
          minStorageQuotaBytes: 1024,
          maxStorageQuotaBytes: 1024 * 1024,
          minTrashRetentionDays: 2,
          maxTrashRetentionDays: 30,
        }}
      />,
    );

    expect(screen.getByLabelText("Storage quota (bytes)")).toHaveAttribute("min", "1024");
    expect(screen.getByLabelText("Trash retention (days)")).toHaveAttribute("max", "30");
    expect(screen.getByText(/still count toward storage quota/i)).toBeVisible();
  });

  it("rejects fractional and out-of-range lifetimes before calling the API", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<CreateProjectForm onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Documents" } });
    fireEvent.change(screen.getByLabelText(/upload URL lifetime/i), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText(/download URL lifetime/i), { target: { value: "61" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create project" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(/1 to 60/);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
