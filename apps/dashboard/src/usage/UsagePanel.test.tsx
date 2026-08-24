import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  USAGE_COST_EXCLUSIONS,
  USAGE_COST_LABEL,
  USAGE_METRICS,
} from "@utility-services/contracts";
import { UsagePanel } from "./UsagePanel.js";

describe("UsagePanel", () => {
  it("labels the estimate and exposes metering freshness", async () => {
    render(
      <UsagePanel
        projectId="prj_0123456789abcdefghijkl"
        api={{
          currentMonth: vi.fn().mockResolvedValue({
            label: USAGE_COST_LABEL,
            currency: "USD",
            period: "2026-08",
            totalCostUsd: "0.01",
            metrics: USAGE_METRICS.map((metric) => ({
              metric,
              quantity: "0",
              costUsd: "0",
              priceVersionIds: [],
            })),
            priceVersionIds: [],
            exclusions: [...USAGE_COST_EXCLUSIONS],
            freshness: {
              state: "stale",
              lastMeteredAt: "2026-08-23T10:00:00.000Z",
              evaluatedAt: "2026-08-24T10:00:00.000Z",
            },
          }),
        }}
      />,
    );
    expect(await screen.findByText("$0.01", { exact: false })).toBeVisible();
    expect(screen.getByText(/Metering: stale/)).toBeVisible();
    expect(screen.getByText(/not an allocated AWS invoice/i)).toBeVisible();
  });

  it("renders a price version and a not-yet-metered projection without a watermark", async () => {
    render(
      <UsagePanel
        projectId="prj_0123456789abcdefghijkl"
        api={{
          currentMonth: vi.fn().mockResolvedValue({
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
            priceVersionIds: ["aws-il-central-1-2026-08-01"],
            exclusions: [...USAGE_COST_EXCLUSIONS],
            freshness: {
              state: "not-yet-metered",
              lastMeteredAt: null,
              evaluatedAt: "2026-08-24T10:00:00.000Z",
            },
          }),
        }}
      />,
    );
    expect(await screen.findByText(/aws-il-central-1-2026-08-01/)).toBeVisible();
    expect(screen.getByText(/Metering: not yet metered/)).toBeVisible();
  });
});
