import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  USAGE_COST_EXCLUSIONS,
  USAGE_COST_LABEL,
  USAGE_METRICS,
  type MonthlyUsageProjection,
} from "@utility-services/contracts";
import { UsagePanel } from "./UsagePanel.js";

function projection(totalCostUsd: string): MonthlyUsageProjection {
  return {
    label: USAGE_COST_LABEL,
    currency: "USD",
    period: "2026-08",
    totalCostUsd,
    metrics: USAGE_METRICS.map((metric) => ({
      metric,
      quantity: "0",
      costUsd: "0",
      priceVersionIds: [],
    })),
    priceVersionIds: [],
    exclusions: [...USAGE_COST_EXCLUSIONS],
    freshness: {
      state: "fresh",
      lastMeteredAt: "2026-08-24T09:00:00.000Z",
      evaluatedAt: "2026-08-24T10:00:00.000Z",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

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
    expect(screen.getByRole("note")).toHaveTextContent(
      "Download metering is in validation mode. Download requests, bytes, and costs are not included yet; refreshing will not add them until pricing is enabled after validation.",
    );
    expect(screen.getByText(/Period 2026-08 UTC/)).toBeVisible();
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

  it("ignores an older project's usage after switching projects", async () => {
    const firstUsage = deferred<MonthlyUsageProjection>();
    const api = {
      currentMonth: vi
        .fn()
        .mockImplementation((projectId: string) =>
          projectId === "prj_0123456789abcdefghijkl"
            ? firstUsage.promise
            : Promise.resolve(projection("2")),
        ),
    };
    const { rerender } = render(<UsagePanel projectId="prj_0123456789abcdefghijkl" api={api} />);
    rerender(<UsagePanel projectId="prj_bcdefghijklmnopqrstuvw" api={api} />);
    expect(await screen.findByText("$2", { exact: false })).toBeVisible();
    await act(async () => {
      firstUsage.resolve(projection("1"));
      await firstUsage.promise;
    });
    expect(screen.queryByText("$1", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText("$2", { exact: false })).toBeVisible();
  });
});
