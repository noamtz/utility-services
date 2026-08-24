import { useEffect, useState } from "react";

import type { MonthlyUsageProjection, UsageMetric } from "@utility-services/contracts";

import { ControlApiError } from "../api/control-client.js";
import type { UsageApi } from "./api.js";

const METRIC_LABELS: Record<UsageMetric, string> = {
  "s3-storage-byte-milliseconds": "Retained storage",
  "s3-upload-requests": "Upload requests",
  "s3-download-requests": "Download requests",
  "s3-download-bytes-out": "Download bytes",
  "cloudtrail-s3-data-events": "CloudTrail data events",
};

export function UsagePanel({ projectId, api }: { projectId: string; api: UsageApi }) {
  const [usage, setUsage] = useState<MonthlyUsageProjection>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      setUsage(await api.currentMonth(projectId));
    } catch (failure) {
      setError(failure instanceof ControlApiError ? failure.message : "Usage could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => void load(), [projectId, api]);

  return (
    <section className="panel experience-panel" aria-labelledby="usage-title">
      <p className="eyebrow">Current calendar month</p>
      <div className="section-heading">
        <div>
          <h2 id="usage-title">AWS-equivalent usage cost</h2>
          <p>Published AWS list rates for this project, not an allocated AWS invoice.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>
      {loading && <p role="status">Loading usage…</p>}
      {error && <p role="alert">{error}</p>}
      {usage && (
        <>
          <p className="usage-total">
            ${usage.totalCostUsd} <small>{usage.currency}</small>
          </p>
          <p className={`freshness freshness-${usage.freshness.state}`}>
            Metering: {usage.freshness.state.replaceAll("-", " ")}
            {usage.freshness.lastMeteredAt &&
              ` · through ${new Date(usage.freshness.lastMeteredAt).toLocaleString()}`}
          </p>
          <p className="field-note">
            Evaluated {new Date(usage.freshness.evaluatedAt).toLocaleString()} · Price versions:{" "}
            {usage.priceVersionIds.length > 0
              ? usage.priceVersionIds.join(", ")
              : "none applied yet"}
          </p>
          <dl className="metric-grid">
            {usage.metrics.map((metric) => (
              <div key={metric.metric}>
                <dt>{METRIC_LABELS[metric.metric]}</dt>
                <dd>
                  {metric.quantity} · ${metric.costUsd}
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-note">
            Excludes free tiers, discounts, credits, taxes, and shared infrastructure.
          </p>
        </>
      )}
    </section>
  );
}
