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
    expect(screen.getAllByRole("button", { name: "Copy curl" })).toHaveLength(5);

    const examples = Array.from(
      container.querySelectorAll("pre code"),
      (element) => element.textContent ?? "",
    );
    expect(examples).toHaveLength(5);
    expect(examples.every((example) => example.includes("curl --fail-with-body"))).toBe(true);
    const canonicalExamples = examples.join("\n");
    expect(canonicalExamples).toContain("/v1/files/uploads");
    expect(canonicalExamples).toContain("/v1/files?limit=20");
    expect(canonicalExamples).toContain("/v1/files/$FILE_ID/downloads");
    expect(canonicalExamples).toContain("/files/public/$PUBLIC_PROJECT_ID/$PUBLIC_FILE_ID");
    expect(canonicalExamples).toContain("/v1/files/$FILE_ID/restore");
    expect(canonicalExamples).toContain("/v1/files/$FILE_ID?force=true");
    expect(canonicalExamples).toContain("Authorization: Bearer $RUS_API_KEY");
    expect(canonicalExamples).toContain("Content-Type: application/pdf");
    expect(canonicalExamples).toContain("Content-Length: 12345");
    expect(canonicalExamples).toContain("If-None-Match: *");
    expect(canonicalExamples).not.toMatch(/X-Amz-(?:Credential|Signature)=/u);
  });
});
