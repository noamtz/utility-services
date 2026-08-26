import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  USAGE_COST_EXCLUSIONS,
  USAGE_COST_LABEL,
  USAGE_METRICS,
} from "@utility-services/contracts";
import { ProjectView } from "./ProjectView.js";

const project = {
  projectId: "prj_0123456789abcdefghijkl",
  name: "Documents",
  enabledUtilities: ["file-management"] as const,
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: "2026-08-24T10:00:00.000Z",
  updatedAt: "2026-08-24T10:00:00.000Z",
};

describe("selected project experience", () => {
  it("loads owner key metadata and usage while teaching server-authorized direct transfers", async () => {
    const listKeys = vi.fn().mockResolvedValue({ items: [] });
    const currentMonth = vi.fn().mockResolvedValue({
      label: USAGE_COST_LABEL,
      currency: "USD",
      period: "2026-08",
      totalCostUsd: "0",
      metrics: USAGE_METRICS.map((metric) => ({
        metric,
        quantity: "0",
        costUsd: "0",
        priceVersionIds: [],
      })),
      priceVersionIds: [],
      exclusions: [...USAGE_COST_EXCLUSIONS],
      freshness: {
        state: "not-yet-metered" as const,
        lastMeteredAt: null,
        evaluatedAt: "2026-08-24T10:00:00.000Z",
      },
    });
    const { container } = render(
      <ProjectView
        api={{
          list: vi.fn().mockResolvedValue({ items: [project] }),
          inspect: vi.fn().mockResolvedValue(project),
          create: vi.fn(),
        }}
        credentialApi={{ list: listKeys, issue: vi.fn(), revoke: vi.fn(), replace: vi.fn() }}
        usageApi={{ currentMonth }}
        apiBaseUrl="https://api.example.com"
        onUnauthorized={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Documents/ }));
    expect(await screen.findByRole("heading", { name: "Project API keys" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "AWS-equivalent usage cost" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /Generate transfer URLs on your server/ }),
    ).toBeVisible();
    expect(listKeys).toHaveBeenCalledWith(project.projectId, undefined);
    expect(currentMonth).toHaveBeenCalledWith(project.projectId);
    expect(screen.getAllByText(project.projectId)).toHaveLength(2);
    const projectDetails = container.querySelector<HTMLElement>("section.project-details");
    expect(projectDetails).not.toBeNull();
    expect(within(projectDetails!).getByText(project.projectId)).toBeVisible();
  });
});
