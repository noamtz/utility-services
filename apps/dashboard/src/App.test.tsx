import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("App", () => {
  it("renders the accessible foundation shell", () => {
    render(<App />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Reusable Utility Services" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/shared TypeScript, REST, and infrastructure foundation/i),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /canonical architecture/i })).toHaveAttribute(
      "href",
      "https://github.com/noamtz/utility-services/wiki/Architecture",
    );
  });

  it("does not claim deferred product flows or expose credential material", () => {
    const { container } = render(<App />);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/api key|sign in|upload file|usage cost/i);
    expect(container.innerHTML).not.toMatch(/VITE_|Bearer |secret/i);
  });
});
