import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreateProjectForm } from "./CreateProjectForm.js";

describe("CreateProjectForm", () => {
  it("submits File Management with the independent default lifetimes", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<CreateProjectForm onCreate={onCreate} />);

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Documents" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create project" }).closest("form")!);

    await vi.waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: "Documents",
        enabledUtilities: ["file-management"],
        fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
      }),
    );
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
