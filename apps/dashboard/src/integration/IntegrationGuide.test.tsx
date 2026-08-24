import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IntegrationGuide } from "./IntegrationGuide.js";

describe("IntegrationGuide", () => {
  it("documents server-side key use and direct opaque presigned transfers", () => {
    const { container } = render(
      <IntegrationGuide
        apiBaseUrl="https://api.example.com"
        project={{
          projectId: "prj_0123456789abcdefghijkl",
          name: "Docs",
          enabledUtilities: ["file-management"],
          fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
          createdAt: "2026-08-24T10:00:00.000Z",
          updatedAt: "2026-08-24T10:00:00.000Z",
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Generate transfer URLs on your server/i }),
    ).toBeVisible();
    expect(container.textContent).toMatch(/directly to S3/i);
    expect(container.textContent).toContain("paste-the-key-shown-once");
    expect(container.textContent).not.toMatch(/rus_v1\.key_/u);
    expect(container.textContent).not.toMatch(/VITE_|Cognito/u);
  });
});
