# Backend ownership map

`src/core` owns universal Lambda transport and observability infrastructure. Future business
capabilities belong in cohesive slices under `src/modules`, grouped by the approved bounded
contexts: identity/control, project authentication, File Management, and usage/pricing.

Functions under `src/functions` are thin deployment entry points. Shared public schemas come from
`@utility-services/contracts`; the backend must not import infrastructure composition from `infra`.

## Download metering boundary

`src/modules/usage-pricing/cloudtrail-log.ts` owns bounded gzip/JSON parsing and trusted CloudTrail
record classification. `download-metering.ts` owns evidence-only/priced orchestration,
deterministic quarantine, exact-key reconciliation, and aggregate rebuild coordination.
`metering-runtime.ts` composes only the private CloudTrail log reader and usage-pricing repository;
the processor has no File Management bucket read permission. `metering-worker.ts` handles both
batch-size-one SQS notifications and strict internal reconciliation jobs, and the function entry
point remains a one-line export.

The initial deployment gate is `evidence-only`. It retains accepted evidence for idempotent replay
but emits no priced download events and does not advance priced freshness. A priced event, once
separately approved, is one atomic transaction containing the processed-event promotion, request,
outbound-byte, and CloudTrail data-event usage entries, their metric projections, and the monthly
total. Known-project quarantine remains non-billable and marks freshness incomplete.

CloudTrail delivery is asynchronous, at least once, and unordered. Raw logs and processed or
quarantined evidence have 90-day retention, usage events retain for 14 months, and aggregates are
indefinite. Transient processing failures are retried through SQS and retained in the 14-day DLQ
after exhaustion; exact raw log keys can be replayed and affected project/month projections rebuilt
without double-counting. Never log raw records, event IDs, object keys/ARNs, bucket/table names,
presigned URLs, or credentials.

The future user-facing total is **AWS-equivalent usage cost**, not an AWS invoice allocation. It
excludes free tiers, discounts, credits, taxes, and shared infrastructure.
