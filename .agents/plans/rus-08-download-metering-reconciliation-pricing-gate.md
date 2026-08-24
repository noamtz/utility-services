# Feature: RUS-08 Download Metering, Reconciliation, and Pricing Gate

The following plan should be complete, but it is important to validate documentation, codebase patterns, and task sanity before implementation starts.

Pay special attention to the existing usage source identity, bigint/fixed-point arithmetic, strict persisted schemas, and generated SST/Pulumi types. Import from the established module files; do not create a parallel pricing or file-identity model.

## Feature Description

Implement the asynchronous download-metering path for the already-deployed direct S3 download capability. A stage-local CloudTrail trail will record only `GetObject` data events for the private File Management bucket's canonical `projects/` object prefix and deliver compressed logs to a separate private bucket. Each object-created notification enters a durable SQS queue with a dead-letter queue before a bounded Lambda processor validates the delivered records, derives the trusted project from the canonical object key, reads the actual transferred-byte evidence, deduplicates by CloudTrail `eventID`, and atomically emits the three existing usage dimensions: S3 download requests, outbound bytes, and CloudTrail data events.

Raw logs and processed-event evidence remain replayable for 90 days. Usage events retain for 14 months and monthly aggregates indefinitely through the existing RUS-04 table. Malformed, failed, ambiguous, or unattributable evidence is deterministically quarantined without cost. Reconciliation reprocesses exact retained log objects and rebuilds affected monthly projections without double-counting.

Non-zero download charging is protected by an auditable deployment-time gate. The initial mode is `evidence-only`: accepted records are retained and deduplicated but do not enter the priced ledger. Only after the owner separately authorizes a non-production deployment and the required full/range/cancelled/repeated/expired/unused transfer matrix passes may the gate change to `priced`; retained accepted evidence is then replayed at its original occurrence time through immutable RUS-04 rates.

## User Story

As an owner of an application project,
I want actual successful S3 download activity to become trustworthy, project-attributable usage,
So that the dashboard can eventually show an accurate AWS-equivalent download cost without double-counting failures, retries, or ambiguous evidence.

## Problem Statement

RUS-06 issues private and public S3 `GetObject` capabilities, but authorization issuance is not proof that bytes moved. URLs can be unused, expired, retried, range-read, cancelled, or reused. The current usage ledger has all required metrics and prices, but it has no CloudTrail ingestion path, no raw-log retention bucket, no processed-event root dedupe, no replay entry point, and no download-pricing gate. Calling the existing single-metric `recordUsage` three times with one `eventID` is also incorrect: source identity excludes the metric, and each call advances a watermark before the whole CloudTrail event is durably accounted.

## Solution Statement

Add a dedicated download-metering infrastructure slice and a usage-pricing submodule with four explicit boundaries:

1. **Capture:** one regional CloudTrail trail uses advanced selectors for only S3 `GetObject` data events whose resource ARN starts with the stage FileBucket's `projects/` prefix; compressed logs land in a distinct private 90-day bucket, whose filtered object-created notifications enter a durable SQS queue with bounded retries and a dead-letter queue.
2. **Validate and attribute:** a strict gzip/JSON parser accepts only successful, in-region, in-account, in-bucket `AwsApiCall` records; it derives project/file identity using the existing canonical object-key parser and converts `additionalEventData.bytesTransferredOut` to a non-negative bigint. Every unsafe case becomes bounded hashed quarantine evidence.
3. **Deduplicate and price atomically:** one processed-event root keyed from CloudTrail `eventID` owns a three-metric ledger transaction. `evidence-only` stores accepted evidence without cost; `priced` conditionally promotes or creates that evidence and writes all three immutable usage events plus their aggregate deltas as one transaction. The canonical CloudTrail watermark advances only after that transaction succeeds and never clears an unresolved incomplete state merely because a later event succeeds.
4. **Replay and decide:** the same worker accepts a strict internal reconciliation job containing exact retained log keys, replays them idempotently, invokes the existing aggregate rebuild for affected project/month pairs, and supports controlled DLQ redrive after transient faults are fixed. A secret-safe operator harness runs the required real-transfer matrix and records a pass/fail gate decision; it never flips the gate, redrives messages, or deploys without the corresponding owner authorization.

## Out of Scope / Non-Goals

- Not included: CloudFront file delivery or CloudFront log metering; this is the documented fallback only if the acceptance gate fails.
- Not included: changing private/public download routes, presigned URL shapes, range behavior, visibility, trash semantics, or serving bytes through Lambda/API Gateway.
- Not included: billing collection, invoice allocation, free-tier/discount/credit/tax handling, or account-level AWS bill reconciliation.
- Not included: a public replay, quarantine, pricing, or usage-management API; reconciliation is an internal worker invocation over exact retained log objects.
- Not included: pricing-rate refresh or mutation of the existing immutable price version.
- Not included: production alarms, general backlog monitoring, or operational dashboards; RUS-10 owns production observability. This ticket must still emit safe structured counts and freshness/quarantine evidence.
- Not included: dashboard usage presentation; RUS-09 consumes the existing monthly projection contract.
- Not included: automatic repair or deletion of quarantined raw events. They remain non-billable and keep freshness incomplete until reviewed by a later authorized operational workflow.
- Not changing: RUS-04 upload/storage usage behavior or existing usage events.
- Not changing: the 90-day raw/dedupe, 14-month ledger, and indefinite aggregate retention decisions inherited from architecture.

## Feature Metadata

**Feature Type**: New Capability

**Estimated Complexity**: High

**Primary Systems Affected**: SST/Pulumi infrastructure, CloudTrail, private S3 log storage, SQS delivery/DLQ, Lambda background processing, usage/pricing DynamoDB model/repository/service/runtime, reconciliation tooling, integration tests

**Dependencies**: RUS-04 usage/pricing ledger, RUS-05 canonical File Management storage layout, RUS-06 direct download paths, Node.js 24, SST 4.17.1, Pulumi AWS provider 7.43.0, AWS SDK for JavaScript v3 S3/DynamoDB clients already installed, Zod 4.4.3, Node `zlib`

## Related Work

**Implements**: [GitHub issue RUS-08](https://github.com/noamtz/utility-services/issues/8) · **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) · **Architecture**: [Architecture — Download metering, reliability, and acceptance gate](https://github.com/noamtz/utility-services/wiki/Architecture#download-metering)

Native readiness checked on 2026-08-24: blockers [RUS-04](https://github.com/noamtz/utility-services/issues/4), [RUS-05](https://github.com/noamtz/utility-services/issues/5), and [RUS-06](https://github.com/noamtz/utility-services/issues/6) are all closed. RUS-08 blocks RUS-09 and RUS-10.

**Back-references**:

- `.agents/plans/rus-04-versioned-pricing-usage-ledger.md` - Inherit fixed-point pricing, event/dedupe/aggregate persistence, retention, quarantine, freshness, and rebuild semantics.
- `.agents/plans/rus-05-direct-upload-file-metadata-lifecycle.md` - Inherit the private stage bucket, canonical object keys, direct transfer, and async worker patterns.
- `.agents/plans/rus-06-private-download-stable-public-access.md` - Inherit exact private/public download paths, ready-only authorization, opaque URLs, and unconstrained S3 Range behavior.
- `.agents/plans/rus-07-trash-restore-scheduled-purge-force-deletion.md` - Preserve download denial for trashed/claimed files and stable object identity until physical removal.
- `.agents/reports/rus-04-versioned-pricing-usage-ledger-report.md` - Existing ledger validation and deployment caveats.
- `.agents/reports/rus-06-private-download-stable-public-access-report.md` - Deployed direct download/range/log-safety evidence on `dev-rus02`.
- `.agents/reports/rus-07-trash-restore-scheduled-purge-force-deletion-report.md` - Current default-branch and shared-stage lifecycle state.

**Forward-references**:

- RUS-09 will consume monthly download metrics and freshness without duplicating metering logic.
- RUS-10 will alarm on quarantine, stale watermark, Lambda error, and asynchronous backlog signals.
- RUS-11 will rerun the accepted transfer matrix as part of release readiness.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` - Mandatory AWS identity, shared-stage continuity, security, retention, metering, external-mutation, and validation rules. Re-read the active version because it currently has user changes.
- `sst.config.ts` (lines 16-45) - Root composition order. Create metering after File Management so the real file bucket ARN is available and before returning stack outputs.
- `package.json` (lines 1-31) - Node/npm pins and canonical validation scripts.
- `packages/backend/package.json` (lines 1-18) - Existing S3 and DynamoDB clients are sufficient; do not add a CloudTrail runtime SDK merely to parse delivered logs.
- `infra/config/app.ts` (lines 3-37) - Fixed `il-central-1`, Pulumi AWS 7.43.0, and stage removal/protection policy.
- `infra/config/file-management.ts` (lines 3-54) - Stable FileBucket name, `projects/` prefix, private/public-access-block/TLS policy to mirror for the log bucket.
- `infra/file-management.ts` (lines 30-101) - Existing resource factory, scoped links, worker permissions, S3 notification, Cron, and production/non-production bucket behavior.
- `infra/file-management.test.ts` (lines 19-155) - Exact mock-SST infrastructure assertion style.
- `infra/config/usage-pricing.ts` (lines 9-19, 79-137) - Existing table/TTL policy and immutable non-zero download/CloudTrail rates. Do not edit the price history to implement the gate.
- `infra/usage-pricing.ts` (lines 20-41) - Independent UsagePricingTable and retained immutable price seeds.
- `infra/usage-pricing.test.ts` (lines 16-89) - Table and retained-price infrastructure tests.
- `infra/bucket-link.ts` (lines 1-10) and `infra/dynamo-link.ts` (lines 1-17) - Resource links expose names with narrow baseline permissions; add explicit processor actions instead of relying on broad implicit IAM.
- `infra/sst-globals.d.ts` (lines 1-198) - Hand-maintained test/compiler surface that lacks CloudTrail, Function environment, lifecycle, service-principal policy, suffix notification, and component dependency types.
- `infra/composition.test.ts` (lines 18-100) - Root resource and route composition regression pattern.
- `packages/contracts/src/usage-pricing/contract.ts` (lines 3-17, 92-134) - Exact metric names and public projection/freshness contract. No new public metric is required.
- `packages/backend/src/modules/usage-pricing/model.ts` (lines 13-18, 45-174, 176-274) - Current usage event, dedupe, watermark, quarantine, key builder, hash, 90-day, and 14-month schemas/helpers.
- `packages/backend/src/modules/usage-pricing/fixed-point.ts` (lines 1-81) - Bigint quantity/cost scales and DynamoDB 38-digit guardrails.
- `packages/backend/src/modules/usage-pricing/pricing.ts` - Effective occurrence-time price selection and exact charge calculation to reuse for every batch metric.
- `packages/backend/src/modules/usage-pricing/repository.ts` (lines 48-118, 184-207, 213-364, 479-544) - Repository interface, paginated strong reads, single-event transaction, conflict classification, watermark, and quarantine implementations.
- `packages/backend/src/modules/usage-pricing/service.ts` (lines 60-88, 114-276, 376-536) - Single-metric recording, freshness precedence, quarantine, and monthly rebuild. Note that current record identity excludes metric and current watermark advancement clears `incompleteSince`.
- `packages/backend/src/modules/usage-pricing/runtime.ts` (lines 1-23) - Usage runtime composition and bigint-safe Dynamo document client.
- `packages/backend/src/modules/usage-pricing/model.test.ts`, `repository.test.ts`, `service.test.ts`, and `runtime.test.ts` - Exact fail-closed parsing, command-shape, retry, retention, freshness, and dependency-injection tests to extend.
- `packages/backend/src/modules/file-management/model.ts` (lines 41-45, 103-119, 165-175) - File states and canonical `parseFileObjectKey`; this is the only approved project/file attribution parser.
- `packages/backend/src/modules/file-management/downloads.ts` (lines 40-94) - Existing actual download issuance stays unmetered.
- `packages/backend/src/modules/file-management/presigning.ts` (lines 90-105) - `GetObjectCommand` intentionally does not bind Range; preserve it.
- `packages/backend/src/modules/file-management/completion.ts` (lines 7-30, 109-131, 161-241) - Strict opaque-event parsing, trusted bucket/key recheck, idempotent service orchestration, and batch handling pattern.
- `packages/backend/src/modules/file-management/workers.ts` (lines 5-42) and `packages/backend/src/functions/files/process-upload-completion.ts` (line 1) - Memoized worker runtime and one-line Lambda entry point pattern.
- `packages/backend/src/core/observability/powertools.ts` and `redact.ts` (lines 1-90) - Safe structured logger/redaction; raw CloudTrail records, object keys, presigned URLs, and secret-bearing request data must never be logged.
- `tests/integration/usage-pricing-ledger.test.ts` (lines 78-201, 203-315) - In-memory repository and assembled projection/rebuild/quarantine pattern.
- `tests/integration/direct-upload-file-lifecycle.test.ts` (lines 644-871) - Assembled private/public download, range, freshness, and log-safety evidence.
- `tooling/run-sst.mjs` (lines 21-47, 81-145) - Only allowed install/diff/deploy wrapper and exact account/principal preflight.
- `tooling/run-sst.test.ts` (lines 10-120) - Wrapper safety tests that must remain green.
- `README.md` (lines 1-30, 100-130) and `packages/backend/README.md` - Current status still describes CloudTrail ingestion as future work; update only after behavior exists.

### New Files to Create

- `infra/config/download-metering.ts` - Component names, log prefix/lifecycle, advanced selector, exact IAM actions, safe parser limits, watermark source, and auditable pricing-gate mode.
- `infra/config/download-metering.test.ts` - Pure policy tests for selector narrowness, retention, gate default, actions, and no wildcards.
- `infra/download-metering.ts` - Private log bucket, durable SQS queue and DLQ, explicit processor Function/subscriber, notification, CloudTrail bucket policy, regional trail, and returned outputs.
- `infra/download-metering.test.ts` - Mock-SST/Pulumi resource graph and least-privilege tests.
- `packages/backend/src/modules/usage-pricing/cloudtrail-log.ts` - Strict SQS-wrapped S3-notification/replay-job and gzip CloudTrail record parsing with safe evidence classification.
- `packages/backend/src/modules/usage-pricing/cloudtrail-log.test.ts` - Archive, event-shape, success/failure, scope, attribution, byte, duplicate, and safety tests.
- `packages/backend/src/modules/usage-pricing/download-metering.ts` - Evidence-first gate, atomic three-metric orchestration, deterministic quarantine, watermark, replay, and rebuild coordination.
- `packages/backend/src/modules/usage-pricing/download-metering.test.ts` - Gate, atomicity, retry, dedupe, quarantine, watermark, and reconciliation tests.
- `packages/backend/src/modules/usage-pricing/metering-runtime.ts` - S3 log reader plus usage repository/service composition from linked resources and injected gate mode.
- `packages/backend/src/modules/usage-pricing/metering-runtime.test.ts` - Resource/environment validation, bigint-safe client, lazy composition, and no FileBucket read tests.
- `packages/backend/src/modules/usage-pricing/metering-worker.ts` - Memoized worker with strict SQS/S3 notification and internal replay event dispatch.
- `packages/backend/src/modules/usage-pricing/metering-worker.test.ts` - Worker dispatch, safe logging, and retry/quarantine boundaries.
- `packages/backend/src/functions/usage-pricing/process-download-metering.ts` - One-line Lambda handler export.
- `tests/integration/download-metering.test.ts` - In-memory full/range/cancelled/repeated/failed/unused fixtures, replay, gate promotion, aggregate rebuild, and project-isolation proof.
- `tooling/acceptance/download-metering.mjs` - Explicitly operator-run, secret-safe deployed transfer matrix and reconciliation harness; it performs no work without exact stage/API/key/function/log-bucket inputs and the required AWS identity preflight.
- `tooling/acceptance/download-metering.test.ts` - Dry-run plan, secret redaction, identity refusal, matrix classification, timeouts, and no-default-stage tests.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Canonical Architecture — Download metering](https://github.com/noamtz/utility-services/wiki/Architecture#download-metering)
  - Specific sections: Usage pricing and metering; Download metering; Usage reliability and reconciliation; Spikes & experiments.
  - Why: Inherited product data flow, retention, fail-safe, and gate decision; do not reopen these decisions.
- [AWS CloudTrail advanced event selector filtering](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/filtering-data-events.html#filtering-data-events-aws-cli)
  - Specific facts: `eventCategory=Data`, `resources.type=AWS::S3::Object`, `eventName=GetObject`, and `resources.ARN StartsWith` are supported; wildcard selectors are not; advanced/basic selectors conflict.
  - Why: Capture only the file bucket's canonical GetObject path and avoid metering the log bucket or unrelated S3 activity.
- [Pulumi AWS 7.43.0 `aws.cloudtrail.Trail`](https://www.pulumi.com/registry/packages/aws/api-docs/cloudtrail/trail/)
  - Specific sections: Basic example, advanced event selector example, `enableLogging`, `enableLogFileValidation`, `isMultiRegionTrail`, and `dependsOn` bucket policy.
  - Why: This exactly matches the pinned provider version in `infra/config/app.ts`.
- [AWS CloudTrail S3 bucket policy](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/create-s3-bucket-policy-for-cloudtrail.html)
  - Specific sections: `s3:GetBucketAcl`, prefix-scoped `s3:PutObject`, `bucket-owner-full-control`, and `aws:SourceArn` conditions.
  - Why: CloudTrail must deliver into a private bucket without broadening access.
- [AWS CloudTrail log delivery and object layout](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/get-and-view-cloudtrail-log-files.html)
  - Specific facts: gzip JSON, `AWSLogs/{account}/CloudTrail/{region}/...`, average roughly five-minute delivery with no guarantee, and possible duplicate `eventID`s.
  - Why: Notification filters, decompression, replay, eventual freshness, and dedupe behavior.
- [AWS CloudTrail record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html)
  - Specific fields: `eventID`, `eventTime`, `eventType`, `eventSource`, `errorCode`, `resources`, `recipientAccountId`, `awsRegion`, and optional/variable `additionalEventData`.
  - Why: The official schema guarantees event identity but does **not** guarantee `bytesTransferredOut` for general-purpose S3; missing/invalid bytes must quarantine.
- [Amazon S3 CloudTrail event coverage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cloudtrail-logging-s3-info.html)
  - Specific section: general-purpose bucket object-level `GetObject` is an `AWS::S3::Object` read data event.
  - Why: Selector and semantic validation.
- [SST 4 Bucket](https://sst.dev/docs/component/aws/bucket/)
  - Specific sections: lifecycle `expiresIn`, service-principal policy, notification prefix/suffix filters, and linked function customization.
  - Why: Use established SST components for privacy, 90-day lifecycle, and S3 notification while keeping CloudTrail itself as a raw provider resource.
- [SST 4 Function](https://sst.dev/docs/component/aws/function/)
  - Specific sections: environment, link, permissions, timeout, `arn`, and `name`.
  - Why: An explicit named processor is needed for SQS subscription and controlled acceptance/reconciliation invocation.
- [SST 4 Queue](https://sst.dev/docs/component/aws/queue/)
  - Specific sections: dead-letter queue, retry count, `subscribe`, batch sizing, and visibility timeout.
  - Why: CloudTrail log notifications need durable retry state and terminal-failure evidence instead of relying on S3-to-Lambda retries alone.
- [Amazon S3 event notifications to SQS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ways-to-add-notification-config-to-bucket.html)
  - Specific sections: SQS destinations and the destination resource policy required for S3 delivery.
  - Why: Wire the private log bucket to the main queue with exact source-bucket/account restrictions.
- [AWS Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
  - Specific sections: at-least-once processing, visibility timeout, retry behavior, and dead-letter queues.
  - Why: Make consumer failure, retry, and redrive behavior explicit and testable.
- [Amazon SQS dead-letter queue redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)
  - Specific sections: `StartMessageMoveTask`, source/destination semantics, rate control, and minimum redrive permissions.
  - Why: The operator harness must use a bounded, auditable native redrive path after inspecting and correcting a terminal consumer failure.
- [Amazon S3 notification ordering and duplicates](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html#event-notification-types)
  - Specific section: notifications are at least once, unordered, and can duplicate.
  - Why: Entire log-object and event handling must be replay-safe.
- [DynamoDB `PutItem` conditional writes](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html)
  - Specific section: `attribute_not_exists` prevents overwrite.
  - Why: Durable processed-event and quarantine uniqueness.
- [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
  - Specific facts: numeric epoch seconds and deletion may lag by days.
  - Why: TTL is cleanup only; live event conditions and logical expiry still enforce dedupe/replay correctness.
- [Amazon S3 lifecycle management](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
  - Specific section: expiration eligibility/removal timing and UTC granularity.
  - Why: Interpret the 90-day raw-log retention correctly.

### Patterns to Follow

**Naming conventions:**

- Kebab-case source filenames, PascalCase SST component names, camelCase TypeScript functions/fields, SCREAMING_SNAKE_CASE policy constants, and literal kebab-case metric/source/reason codes.
- Keep infrastructure policy in `infra/config/download-metering.ts`, resource construction in `infra/download-metering.ts`, domain parsing/orchestration under the existing `usage-pricing` bounded context, and Lambda entry points under `packages/backend/src/functions/usage-pricing`.

**Runtime validation:**

```ts
const result = SomeStrictSchema.safeParse(rawInput);
if (!result.success) return quarantineSafeDigest(rawInput);
```

Mirror `completion.ts:213-234`: validate opaque AWS input, recheck the configured bucket/scope, then pass only a canonical typed record to business logic. Use `.passthrough()` only for AWS envelope levels where forward-compatible extra fields are expected; all owned persisted records remain `.strict()`.

**Project attribution:**

```ts
const { internalProjectId, fileId } = parseFileObjectKey(objectKey);
```

Never trust `requestParameters`, a caller-supplied project ID, file ID, bucket, prefix, or URL as authorization. First require exactly one matching `AWS::S3::Object` ARN for the configured FileBucket/prefix, then parse the key with the existing function.

**Usage identity and atomicity:**

- Root dedupe is `sha256("cloudtrail-event", eventID)` and binds a canonical fingerprint of project, file, event time, bytes, region/account/source/success semantics, and raw-log evidence digest.
- The three ledger events derive stable metric-specific source digests from the same event ID. Do not pass the same `(project, sourceKind, sourceId)` to the existing single-metric API three times.
- Promote evidence and write three immutable events, three metric aggregates, and one summed total aggregate in one Dynamo transaction. A transport retry reads the root evidence and classifies identical `priced` evidence as duplicate; a divergent fingerprint quarantines and never charges.
- Do not use `ClientRequestToken` as durable dedupe; it remains only a short transport-retry aid.

**Error handling:**

- Expected bad evidence becomes a deterministic bounded quarantine record and a successful worker result so poison data does not retry forever.
- S3 read failures, decompression/runtime faults, Dynamo throttling/conflicts beyond bounded retries, and other transient infrastructure failures throw so the SQS message retries and ultimately remains visible in the DLQ instead of being silently lost.
- Logs contain only request/job IDs, safe evidence hashes, reason codes, and aggregate counts. Never log the raw record, bucket name, object key/ARN, URL query, identity material, or `additionalEventData` object.

**Watermark behavior:**

- A successful atomic priced batch may move the canonical `cloudtrail-download` watermark forward; an older replay is a no-op, not retry exhaustion.
- Advancing a later success preserves an existing non-null `incompleteSince`.
- Known-project quarantine marks the canonical source incomplete even if the watermark already exists with `incompleteSince: null`.
- `evidence-only` observations do not advance freshness because priced projections are intentionally incomplete.

**Infrastructure:**

- Mirror the private FileBucket posture: block all public access, deny insecure transport, use AWS-managed encryption, and never expose the bucket publicly.
- The CloudTrail service-principal allow policy is prefix- and `aws:SourceArn`-scoped; the processor receives `s3:GetObject` only for the CloudTrail log prefix and exact usage-table actions. It does not need FileBucket read/write permission.
- Give the main queue an exact S3 `SendMessage` resource policy restricted by the log-bucket ARN and account, subscribe the named processor with batch size one, and route exhausted retries to a 14-day DLQ. Raw logs remain the 90-day recovery source.
- Build one deterministic stage-qualified trail name and its exact ARN from partition, account, region, and name inputs. Use that constructed ARN in the bucket policy before creating the trail; never reference `trail.arn` from a policy that the trail itself depends on.
- Explicitly order the trail after the log bucket policy and configure `enableLogging: true`, log validation, regional/single-account scope, and no management/global events.

---

## IMPLEMENTATION PLAN

### Phase 1: Infrastructure and gate policy

Define the auditable evidence-only gate, exact CloudTrail selector, log retention/privacy policy, processor resource contract, and root composition without changing existing download routes or price snapshots.

**Tasks:**

- Add pure policy constants/tests and the minimal SST/Pulumi global type surface.
- Create the log bucket, policy, main queue, DLQ, named processor subscription, notification, and trail.
- Compose resources after File Management and expose only operator-required outputs.

### Phase 2: Evidence model and repository atomicity

**Depends on:** Phase 1 for final source/gate names and retention constants.

Extend the RUS-04 persistence boundary with strict processed-event and deterministic quarantine evidence plus a single atomic three-metric write. Correct watermark semantics for out-of-order success and unresolved incompleteness.

**Tasks:**

- Add keys/schemas/retention/fingerprint builders.
- Add conditional evidence-only observation and atomic evidence promotion/ledger/aggregate commands.
- Add idempotent quarantine and monotonic, incomplete-preserving watermark behavior.

### Phase 3: CloudTrail parsing and processor orchestration

**Depends on:** Phase 2 for the durable evidence/repository APIs.

Build the bounded S3 log reader, gzip parser, per-record classifier, project attribution, gate orchestration, safe logging, and runtime/worker entry point.

**Tasks:**

- Parse SQS messages containing S3 notifications and internal exact-key replay jobs.
- Stream/read with compressed and inflated limits, gunzip, parse, and independently classify records.
- Record evidence or priced atomic batches, quarantine unsafe records, and return count-only summaries.

### Phase 4: Replay, rebuild, and automated acceptance

**Depends on:** Phase 3.

Make exact retained log objects replayable, make terminal consumer failures recoverable through inspected DLQ redrive, collect affected project/month pairs, invoke the existing rebuild path, and prove the transfer semantics with deterministic fixtures.

**Tasks:**

- Add reconciliation mode and aggregate rebuild.
- Add terminal-failure-to-DLQ and controlled-redrive coverage.
- Add full/range/cancelled/repeated/failed/unused fixtures and replay assertions.
- Prove zero double-counting, safe quarantine, project isolation, retention, and gate promotion.

### Phase 5: Documentation and local validation

Update truthful repository documentation and pass focused, full, coverage, type, lint, format, build, Codex-layer, and preview-only validation.

### Phase 6: Authorized non-production evidence gate

**Depends on:** Phases 1-5 and separate explicit owner authorization for AWS deployment/data mutation.

Deploy `evidence-only` to the existing sequential shared stage `dev-rus02`, run the real transfer matrix using disposable data, inspect/replay exact raw log objects, and apply the decision rule. If and only if it passes, make a reviewed code change to `priced`, preview/deploy again under separate authorization, and verify non-zero immutable events. If it fails, keep the gate disabled and open the documented CloudFront fallback decision; do not silently change transfer architecture in this ticket.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable. External AWS actions in Tasks 15-16 require explicit owner authorization at execution time; local implementation authorization does not imply it.

### 1. CREATE `infra/config/download-metering.ts` and `infra/config/download-metering.test.ts`

- **IMPLEMENT**: component names; a deterministic stage-qualified CloudTrail name and exact ARN builder from partition/account/region/name inputs; `AWSLogs/{account}/CloudTrail/il-central-1/` log prefix builder; 90-day raw-log lifecycle; 14-day DLQ retention; main-queue visibility/retry policy; canonical source kind `cloudtrail-download`; exact processor Dynamo/S3 actions; compressed/inflated/record-count limits; and `DOWNLOAD_PRICING_MODE: "evidence-only" | "priced"` defaulted to `evidence-only`.
- **IMPLEMENT**: one advanced selector containing `eventCategory=Data`, `resources.type=AWS::S3::Object`, `eventName=GetObject`, `readOnly=true`, and `resources.ARN StartsWith <FileBucketArn>/projects/`.
- **TEST**: trail names are stage-qualified and the constructed ARN is exact; no management events, wildcard selector, log-bucket selector, unrelated region/resource, wildcard IAM, invalid queue timing/retention, or accidental `priced` default.
- **GOTCHA**: do not alter `infra/config/usage-pricing.ts` rates; the gate controls evidence promotion, not immutable price history.
- **GOTCHA**: the CloudTrail bucket policy must use the deterministic ARN builder, not the future `Trail.arn` output, or the policy/trail dependency creates a Pulumi cycle.
- **VALIDATE**: `npm test -- --project node infra/config/download-metering.test.ts`
- **SATISFIES**: AC1, AC2, AC8.

### 2. UPDATE `infra/sst-globals.d.ts`

- **IMPLEMENT**: the smallest truthful declarations required by pinned generated types: Bucket lifecycle/service principals/SQS notification prefix-suffix filters, Queue DLQ/retention/visibility/subscriber options and ARN/URL outputs, Function environment/timeout/name/arn, `aws.cloudtrail.Trail` advanced selector and options, and component-resource dependencies.
- **PATTERN**: existing hand declarations at `infra/sst-globals.d.ts:1-198`; verify against `.sst/platform/config.d.ts` after `infra:install` rather than guessing provider shapes.
- **GOTCHA**: do not add broad `any` declarations or hand-copy the entire provider.
- **VALIDATE**: `npm run typecheck`
- **SATISFIES**: AC1 infrastructure correctness.

### 3. CREATE `infra/download-metering.ts` and `infra/download-metering.test.ts`

- **IMPLEMENT**: `createDownloadMeteringResources({ production, fileBucket, usageTable })` with a separate private SST Bucket, 90-day lifecycle, production no-force-destroy/non-production stage cleanup behavior, public access block, TLS deny, and CloudTrail delivery allows limited by service principal, log prefix, account, and the deterministic trail ARN from Task 1.
- **IMPLEMENT**: one encrypted standard DLQ retained for 14 days and one encrypted standard main queue with bounded retry/redrive and visibility longer than the processor timeout. Allow S3 `SendMessage` only from the exact log-bucket ARN and account; do not grant a wildcard producer.
- **IMPLEMENT**: explicit named SST Function linked only to log bucket and usage table, with Node 24, active tracing, bounded timeout/memory, `DOWNLOAD_PRICING_MODE` environment, `s3:GetObject` on the log prefix, and exact Dynamo actions for evidence/event/aggregate/watermark/quarantine/rebuild.
- **IMPLEMENT**: subscribe the explicit function to the main queue with batch size one, then send ObjectCreated:Put notifications filtered to the exact regional CloudTrail prefix and `.json.gz` to that queue. Explicitly order notification configuration after the exact SQS destination policy because S3 validates destination permission when the notification is created. Keep the function directly invocable only for controlled exact-key replay/acceptance.
- **IMPLEMENT**: raw `aws.cloudtrail.Trail` with the exact deterministic name, ordered after the bucket policy, regional/single-account, `enableLogging: true`, log validation enabled, no global/management events, and the exact advanced selector from Task 1.
- **TEST**: resource arguments, lifecycle, policy principals/conditions, exact constructed SourceArn, acyclic dependency order, S3-to-main-queue notification filters, queue-to-function subscription, DLQ/redrive/retention/visibility, processor links/environment/permissions, selector, no wildcard, no FileBucket data permission, and production/non-production removal posture.
- **VALIDATE**: `npm test -- --project node infra/download-metering.test.ts`
- **SATISFIES**: AC1, AC2, AC3.

### 4. UPDATE `sst.config.ts` and `infra/composition.test.ts`

- **IMPLEMENT**: dynamically import the metering composer, create it after `files`, and return safe operator outputs for processor function name, log bucket name, and main/DLQ queue identifiers only if the acceptance harness requires them. Never place credentials, object keys, signed URLs, or message bodies in outputs.
- **TEST**: composition order and that existing control/usage/file/API/dashboard outputs/routes/resources remain unchanged.
- **GOTCHA**: `dev-rus02` is shared and must be reused sequentially; composition is not deployment authorization.
- **VALIDATE**: `npm test -- --project node infra/composition.test.ts infra/download-metering.test.ts`
- **SATISFIES**: AC1, AC3, AC8.

### 5. UPDATE `packages/backend/src/modules/usage-pricing/model.ts` and `model.test.ts`

- **IMPLEMENT**: strict processed-download evidence and deterministic metering-quarantine schemas/key builders. Persist only hashes, trusted internal project ID when derivable, occurrence/observation times, non-negative bytes, pricing status (`observed-unpriced` or `priced`), canonical fingerprint, safe reason code, and TTL.
- **IMPLEMENT**: global event root digest from CloudTrail `eventID`; metric-specific source/event digests; 90-day logical expiry using the existing retention helper; 14-month event expiry and indefinite aggregate behavior remain unchanged.
- **TEST**: key relationships, strict extra-field rejection, UUID event ID canonicalization, same-event same-fingerprint stability, divergent fingerprint, zero/large byte boundaries, TTL lag logical expiry, no raw event ID/object key/bucket/ARN/URL in stored evidence, and parse failures.
- **GOTCHA**: a processed-event root is the required 90-day dedupe record; 14-month conditional usage-event keys remain the second defense after TTL expiry.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/model.test.ts -t "download|cloudtrail|evidence|quarantine|retention"`
- **SATISFIES**: AC2, AC4, AC6.

### 6. UPDATE `packages/backend/src/modules/usage-pricing/repository.ts` and `repository.test.ts`

- **IMPLEMENT**: strong processed-evidence get; conditional evidence-only put; deterministic quarantine put/classification; and `recordDownloadEvent` that promotes/creates one evidence root and atomically writes three metric-specific immutable events, three metric aggregate deltas, and one summed total aggregate delta.
- **IMPLEMENT**: classify conditional cancellation/races: identical `observed-unpriced` can promote once; identical `priced` is duplicate; divergent root/event evidence raises a typed conflict and never charges; transient conflicts use bounded retry.
- **REFACTOR**: extract existing event/aggregate transaction builders where useful so single-event and download-batch paths share exact key, bigint, price-set, and condition conventions.
- **IMPLEMENT**: change watermark advancement so an older/equal replay becomes a verified no-op, later success preserves existing `incompleteSince`, and `markWatermarkIncomplete` changes an existing null value to non-null.
- **TEST**: exact transaction item count/keys/conditions/ADD totals, all-or-nothing failure at every action, two concurrent processors, observed-to-priced promotion, duplicate after TTL lag, divergent event ID, out-of-order watermark, incomplete preservation, known-project quarantine, deterministic duplicate quarantine, pagination, no Scan/GSI/wildcards.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/repository.test.ts -t "download|batch|evidence|watermark|quarantine|replay"`
- **SATISFIES**: AC2, AC4, AC6, release blocker for double-counting/silent partial metering.

### 7. UPDATE `packages/backend/src/modules/usage-pricing/service.ts` and `service.test.ts`

- **IMPLEMENT**: build the three immutable occurrence-time priced events (`1` request, exact byte quantity, `1` CloudTrail event), calculate each with existing RUS-04 price selection/fixed-point code, and call the new atomic repository method.
- **IMPLEMENT**: `observeDownloadEvidence` for the evidence-only gate without ledger/aggregate/watermark mutation; `recordDownloadEvidence` for priced promotion; deterministic quarantine; and explicit canonical watermark advance only after the atomic batch returns recorded/duplicate evidence.
- **IMPLEMENT**: keep generic `recordUsage` behavior compatible while adopting incomplete-preserving/out-of-order-safe watermark semantics.
- **TEST**: each metric quantity/cost/version, one event spanning a price/month boundary by occurrence time, evidence-only zero ledger writes, later promotion at original time, duplicate and divergent identity, atomic failure/no partial metrics, watermark after success only, later success not clearing incomplete, and existing upload/storage regressions.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/service.test.ts -t "download|pricing gate|atomic|watermark|reconcile"`
- **SATISFIES**: AC4, AC5, AC6, AC8.

### 8. CREATE `packages/backend/src/modules/usage-pricing/cloudtrail-log.ts` and `cloudtrail-log.test.ts`

- **IMPLEMENT**: strict union for an SQS batch containing exactly one S3 notification and an internal reconcile job; validate the SQS envelope and exact configured log bucket/key prefix/suffix; retrieve the object with the existing S3 client; enforce compressed/inflated/record-count bounds; gunzip using Node `zlib`; parse a root `Records` array.
- **IMPLEMENT**: independently classify every record. Accept only `AwsApiCall`, `s3.amazonaws.com`, `GetObject`, read-only data events in the exact account/region/file bucket prefix, with no error fields, one matching S3 object ARN, a valid event ID/time, canonical file key, and non-negative integral `bytesTransferredOut`.
- **IMPLEMENT**: produce safe typed evidence or safe quarantine classification; a malformed queue/S3 envelope or archive-level parse/decompression/scope failure uses a hash and reason only. Expected poison evidence is quarantined and acknowledged; transient retrieval/dependency failures throw for SQS retry/DLQ.
- **TEST**: SQS-wrapped gzip happy path; invalid/multi-message batch rejection; malformed message body; multi-record object; full/range/zero-byte-cancel fixtures; repeated distinct event IDs; duplicate same ID; failed/expired fixture with error; unused URL represented by no event; missing/number/string/malformed bytes; wrong bucket/prefix/region/account/source/type/name; multiple matching ARNs; URL encoding; zip/JSON/size/count failures; no raw evidence in errors/loggable results.
- **GOTCHA**: official AWS docs do not contractually guarantee `bytesTransferredOut` for general-purpose S3. Parser acceptance is necessary but insufficient; Task 16 is the release gate.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/cloudtrail-log.test.ts`
- **SATISFIES**: AC3, AC4, AC5, AC6, AC8.

### 9. CREATE `packages/backend/src/modules/usage-pricing/download-metering.ts` and `download-metering.test.ts`

- **IMPLEMENT**: process each typed log record through gate mode, atomic service, or quarantine; continue after expected bad evidence; rethrow transient S3/Dynamo/runtime faults so the queue retry/DLQ contract remains effective; collect only count/hash/project-period summaries.
- **IMPLEMENT**: for reconcile jobs, replay exact supplied log keys and invoke `rebuildMonthlyProjection` once per unique affected project/month after all priced evidence is durable. Re-running the same job must be a no-op for ledger totals and reproduce aggregates.
- **IMPLEMENT**: no worker-level direct price math, FileRepository lookup, or client-provided project context.
- **TEST**: partial record failures, retry after each injected repository failure, duplicate/out-of-order SQS/S3 notifications, same log replay, multi-project log, project/month dedup of rebuild calls, quarantine not blocking valid neighbors, evidence-only then priced replay, terminal retry remains recoverable from the retained raw key, and exact result counts.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/download-metering.test.ts`
- **SATISFIES**: AC3, AC4, AC5, AC6, AC7, AC8.

### 10. CREATE metering runtime, worker, function entry point, and tests

- **CREATE**: `metering-runtime.ts`, `metering-runtime.test.ts`, `metering-worker.ts`, `metering-worker.test.ts`, and `functions/usage-pricing/process-download-metering.ts`.
- **IMPLEMENT**: compose linked log-bucket/usage-table names, environment gate enum, S3 log reader, bigint-safe Dynamo repository, usage service, metering service, and `safeLogger`; memoize per process and keep the function entry point one line.
- **IMPLEMENT**: dispatch either the batch-size-one SQS consumer event or a strict internal exact-key reconcile event; log start/completion counts and safe evidence hashes only. Expected quarantines return success; transient dependencies throw for queue retry and eventual DLQ retention.
- **TEST**: absent/malformed resources/environment, lazy singleton, dependency injection, S3/Dynamo client options, gate dispatch, SQS/S3/reconcile event union, expected-poison acknowledgement, transient throw, safe logs, and proof the runtime never resolves/reads FileBucket or logs a key/raw event/message body.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/metering-runtime.test.ts packages/backend/src/modules/usage-pricing/metering-worker.test.ts`
- **SATISFIES**: AC3, AC6, security/logging requirements.

### 11. CREATE `tests/integration/download-metering.test.ts`

- **IMPLEMENT**: assembled in-memory log reader + repository flow for full, range, zero-byte/cancelled, repeated use with new event IDs, duplicate delivery with same event ID, failed/expired, and unused authorization (no record).
- **IMPLEMENT**: assert project attribution from canonical keys, three metrics per accepted request, exact transferred bytes, event/data-event counts, no partial writes, no cross-project bleed, gate-off evidence, gate-on replay, 90-day/14-month/indefinite retention, quarantine/freshness, replay, aggregate deletion/rebuild, and stable source hashes.
- **IMPLEMENT**: model the queue delivery contract: a transient consumer failure is retried to the configured limit, the terminal message appears in a DLQ test double instead of disappearing, and redrive after recovery converges without double-counting.
- **TEST**: all RUS-08 acceptance criteria locally except AWS-specific byte semantics and deployment behavior.
- **VALIDATE**: `npm test -- --project node tests/integration/download-metering.test.ts`
- **SATISFIES**: AC2-AC8.

### 12. CREATE `tooling/acceptance/download-metering.mjs` and its tests; UPDATE `package.json`

- **IMPLEMENT**: a non-interactive, explicit-input harness with `--stage`, API URL, disposable server-side project key from environment/stdin, log bucket, processor function, main queue, DLQ, timeout, and `--dry-run`. Require `dev-rus02` or an explicit non-production stage; reject production/default/empty stage.
- **IMPLEMENT**: before AWS reads/invokes, set only `AWS_PROFILE=ntz-cli`, `AWS_REGION=il-central-1`, and the required CA bundle, call STS, and require account `162067902192` plus principal `arn:aws:iam::162067902192:user/ntz-cli`. Never echo credentials, bearer headers, signed URLs, bucket keys, or raw CloudTrail records.
- **IMPLEMENT**: full/range/cancelled/repeated/expired-or-failed/unused transfer matrix, bounded polling for delayed raw logs and queue/DLQ depth, exact-key internal replay invocation, count/byte/dedupe/quarantine/rebuild assertions, and a machine-readable pass/fail decision summary. Add an explicit redrive subcommand that moves inspected DLQ messages back to the main queue only after the cause is corrected and mutation is authorized. Default is dry-run/no mutation unless an explicit execution/redrive flag is supplied.
- **IMPLEMENT**: add a focused npm script, but do not include it in `npm run check` because it requires deployed AWS state and external authorization.
- **TEST**: dry run, missing input, wrong identity, secret redaction, timeout, response classification, exact matrix, gate-fail decision, DLQ detection, redrive refusal/command construction, and subprocess argument safety.
- **VALIDATE**: `npm test -- --project node tooling/acceptance/download-metering.test.ts`
- **SATISFIES**: AC8 and repeatable external acceptance preparation.

### 13. UPDATE `README.md` and `packages/backend/README.md`

- **IMPLEMENT**: describe the new asynchronous CloudTrail/log-bucket/SQS/DLQ/processor/evidence/replay path, retention, eventual freshness, evidence-only default, decision rule, safe internal acceptance/redrive command, and current implementation status.
- **IMPLEMENT**: retain the exact phrase **AWS-equivalent usage cost** and explicitly state that the value excludes free tiers, discounts, credits, taxes, and shared infrastructure and is not an AWS invoice allocation.
- **GOTCHA**: do not paste live resource names, raw log keys, account credentials, project keys, URLs, or acceptance fixtures.
- **VALIDATE**: `npm run format:check`
- **SATISFIES**: integration/operational clarity and RUS-09 handoff.

### 14. RUN focused and repository-wide local validation

- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing infra/config/download-metering.test.ts infra/download-metering.test.ts infra/composition.test.ts tests/integration/download-metering.test.ts tooling/acceptance/download-metering.test.ts`
- **VALIDATE**: `npm run format:check`
- **VALIDATE**: `npm run lint`
- **VALIDATE**: `npm run typecheck`
- **VALIDATE**: `npm test`
- **VALIDATE**: `npm run test:coverage`
- **VALIDATE**: `npm run build`
- **VALIDATE**: `npm run check`
- **VALIDATE**: `python tooling/validate_codex_layer.py`
- **VALIDATE**: `uv run --script tooling/mcp/codebase_search.py --self-test`
- **VALIDATE**: `git diff --check`
- **SATISFIES**: all local acceptance and no-regression requirements.

### 15. RUN preview-only infrastructure validation for `dev-rus02`

- **PRECONDITION**: no concurrent branch/process is changing `dev-rus02`; inspect current state and preserve retained users/projects/logs/fixtures.
- **VALIDATE**: `npm run infra:install -- --stage dev-rus02`
- **VALIDATE**: `npm run infra:diff -- --stage dev-rus02`
- **VERIFY**: exact identity preflight passes; diff adds one private log bucket/lifecycle/policy, one encrypted main queue plus 14-day DLQ and exact producer/subscriber/redrive wiring, one named processor, and one narrowly selected trail. Confirm the bucket policy's `aws:SourceArn` is the exact deterministically constructed trail ARN and the graph has no policy/trail cycle; there is no control/file/usage table or FileBucket replacement, public access, route change, wildcard IAM, price mutation, data deletion, or production target.
- **GOTCHA**: preview is read-only. Stop before deploy unless the owner explicitly authorizes the external mutation after reviewing the diff.
- **SATISFIES**: AC1-AC3 infrastructure evidence.

### 16. RUN the authorized deployed acceptance and pricing decision

- **PRECONDITION**: obtain explicit owner authorization for the exact non-production deployment and disposable data mutations. Re-run the wrapper diff immediately before deploy.
- **DEPLOY**: `npm run infra:deploy -- --stage dev-rus02` while the gate remains `evidence-only`.
- **EXERCISE**: run the harness for full, range, cancelled, repeated same-URL, expired/failed, and unused URLs; wait for asynchronous delivery without treating normal CloudTrail delay as failure until the bounded timeout. In a disposable test path, inject a terminal consumer failure, verify retry exhaustion lands the message in the DLQ, correct the failure, explicitly redrive it, and wait for recovery.
- **VERIFY**: actual byte values, separate request events, project attribution, same-event dedupe, failed/ambiguous quarantine, no unused event, raw-log retention, main-queue/DLQ visibility, successful redrive without double count, exact-key replay, projection rebuild, watermark behavior, and zero non-gated cost.
- **DECIDE**: pass only when successful transfers are measured as intended, range/cancellation semantics are trustworthy for the observed MVP path, duplicates never double-count, ambiguous/failed evidence quarantines, and replay is identical. Persist only a safe summary in the execution report/authorized tracker comment.
- **IF PASS**: change the reviewed gate constant to `priced`, rerun Tasks 12-15, obtain separate deploy authorization, deploy, replay retained accepted evidence, and verify immutable non-zero occurrence-time metrics once.
- **IF FAIL**: leave `evidence-only`, do not charge or mutate price versions, record the exact evidence gap, and raise the architecture's CloudFront delivery/log-metering fallback for owner decision.
- **CLEANUP**: revoke disposable project keys and remove disposable Cognito owners where applicable; report retained project/file records that cannot yet be deleted. Do not remove `dev-rus02`.
- **SATISFIES**: AC8 and the architecture decision rule.

---

## TESTING STRATEGY

### Unit Tests

- Infrastructure policy tests assert the exact event selector, deterministic trail ARN, acyclic log-bucket-policy/trail ordering, log bucket lifecycle/privacy, exact S3-to-SQS policy, main queue/DLQ/redrive settings, notification filters, processor gate/environment, and least privilege.
- CloudTrail parser tests cover every required/optional field, archive limits, success/failure classification, canonical attribution, byte conversion, and safe evidence output.
- Model tests cover processed-event and quarantine keys, fingerprints, retention, strict schema invariants, and sensitive-value exclusion.
- Repository tests inspect exact Dynamo commands and cancellation reasons for evidence-only, atomic three-metric pricing, duplicates, divergence, race/retry, aggregate sums, and watermarks.
- Service/orchestrator tests prove occurrence-time price selection, gate promotion, no partial metrics, quarantine, out-of-order processing, and reconciliation.
- Runtime/worker tests prove link/environment validation, lazy reuse, SQS retry/terminal-DLQ boundaries, and secret-safe logs.
- Acceptance-harness tests use fake subprocess/fetch/time dependencies; no real AWS/network calls occur in `npm test`.

### Integration Tests

- Extend the RUS-04 in-memory repository shape or add a purpose-built test double implementing the new atomic evidence API.
- Feed real gzip CloudTrail fixture objects through the parser and orchestrator, not pre-parsed usage inputs.
- Exercise multiple projects/months and delete aggregates before calling reconciliation to prove raw ledger authority and project isolation.
- Keep existing direct upload/download/trash suites green to prove that metering does not enter the transfer authorization path.
- The deployed non-production matrix is distinct evidence; local fixtures cannot prove general-purpose S3 `bytesTransferredOut` semantics.

### Edge Cases

- Empty/malformed/multi-record SQS batches, malformed nested S3 notification, duplicate queue delivery, exhausted retry, DLQ retention, and redrive after recovery.
- Empty/malformed gzip, invalid JSON, missing/empty/oversized `Records`, compressed or inflated size limit.
- Notification for wrong bucket, prefix, suffix, region, account, event name/source/type/category, or log object.
- CloudTrail record with `errorCode`, `errorMessage`, missing event ID/time/resource, multiple matching resources, malformed ARN/key, or unattributable project.
- Missing, negative, fractional, unsafe-number, non-digit, zero, and extremely large `bytesTransferredOut`.
- Full GET, bounded Range GET, open-ended Range GET, cancelled response with observed zero/partial bytes, repeated URL reuse, duplicate CloudTrail delivery, expired/failed request, and unused URL.
- Same `eventID`/same fingerprint; same `eventID`/divergent fingerprint; same log notification repeated/out of order; event older than current watermark.
- Evidence-only event replayed after priced activation; simultaneous promotion attempts; crash/conditional failure at every atomic transaction step.
- Existing incomplete watermark followed by later success; quarantine after an existing null watermark; known and unknown project quarantine.
- Event near UTC month and price-version boundaries; log delivered the next day/month; replay long after occurrence but within retention.
- Raw log and dedupe TTL eligibility/physical deletion lag; 14-month ledger expiry; aggregates without TTL.
- Quarantine neighbor does not suppress valid records in the same log object; transient dependency failure retries through SQS, then remains recoverable in the DLQ/raw bucket if retries exhaust.
- Logger/exception/summary serialization contains no bearer, signature, presigned URL, raw event ID, object ARN/key, bucket/table name, or internal evidence beyond approved safe hashes/counts.

---

## VALIDATION COMMANDS

Execute every local command before any preview. Execute AWS preview/deploy/acceptance only at the authorization levels stated below.

### Level 1: Syntax & Style

```powershell
npm run format:check
npm run lint
npm run typecheck
git diff --check
```

### Level 2: Focused Unit Tests

```powershell
npm test -- --project node packages/backend/src/modules/usage-pricing
npm test -- --project node infra/config/download-metering.test.ts infra/download-metering.test.ts infra/composition.test.ts
npm test -- --project node tooling/acceptance/download-metering.test.ts
```

### Level 3: Integration and Full Regression

```powershell
npm test -- --project node tests/integration/download-metering.test.ts tests/integration/usage-pricing-ledger.test.ts tests/integration/direct-upload-file-lifecycle.test.ts tests/integration/file-trash-lifecycle.test.ts
npm test
npm run test:coverage
npm run build
npm run check
```

Coverage must remain at least 80% for statements, branches, functions, and lines. Atomicity, dedupe, quarantine, watermark, replay, and the gate require direct assertions regardless of the aggregate percentage.

### Level 4: Infrastructure Preview (Read-Only)

```powershell
npm run infra:install -- --stage dev-rus02
npm run infra:diff -- --stage dev-rus02
```

Use only the wrapper. It must verify `162067902192`, `arn:aws:iam::162067902192:user/ntz-cli`, `ntz-cli`, `il-central-1`, and the required CA bundle. Do not deploy from this level.

### Level 5: Manual/Deployed Validation (Explicit Authorization Required)

```powershell
npm run infra:deploy -- --stage dev-rus02
npm run acceptance:download-metering -- --stage dev-rus02 --execute
```

The acceptance command's exact inputs should be documented by the implementation without showing real secrets. A second preview/deploy is required before changing from `evidence-only` to `priced`.

### Level 6: Codex Layer

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

These must remain green even though this ticket should not need to edit AI-layer configuration.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1 — Narrow CloudTrail capture:** one regional trail logs only `GetObject` data events for `FileBucket/projects/`, writes gzip logs to a separate private bucket, and has exact service delivery policy with a deterministic SourceArn and acyclic dependency ordering.
- [ ] **AC2 — Retention:** raw logs and processed-event/quarantine evidence have 90-day retention, usage ledger detail expires at the start of the fifteenth following UTC month, and monthly aggregates/watermarks/prices remain indefinite.
- [ ] **AC3 — Async processing:** delivered CloudTrail log objects enqueue filtered notifications to a durable main queue; a bounded batch-size-one processor handles at-least-once/unordered delivery independently, and exhausted transient failures remain in a 14-day DLQ.
- [ ] **AC4 — Trusted quantities/identity:** only successful in-scope S3 GetObject records derive project/file identity from the canonical object prefix and use a validated non-negative `additionalEventData.bytesTransferredOut` quantity.
- [ ] **AC5 — Actual activity:** each accepted event emits one S3 request, exact outbound bytes, and one CloudTrail data-event quantity; range/reuse follow actual events, while expired/failed/unused paths never create successful priced usage.
- [ ] **AC6 — No silent charging:** missing, malformed, ambiguous, failed, divergent, or unattributable evidence is deterministically quarantined with safe review evidence, never charged, and marks known-project freshness incomplete.
- [ ] **AC7 — Replay/reconciliation:** exact retained logs replay without double-counting, partial/transient failures converge, terminal queue failures can be inspected and redriven without loss, affected monthly aggregates rebuild from immutable events, and the canonical watermark advances only after complete processed evidence while preserving unresolved incomplete state.
- [ ] **AC8 — Pricing gate:** initial deployments are evidence-only; the required real full/range/cancelled/repeated/expired-or-failed/unused matrix passes before any reviewed switch to non-zero pricing. Gate failure leaves pricing disabled and surfaces the CloudFront fallback decision.
- [ ] All focused and repository-wide format, lint, type, test, 80% coverage, build, Codex-layer, and preview gates pass.
- [ ] No regression to direct/private/public/range download behavior, file lifecycle, project isolation, secret redaction, or upload/storage pricing.
- [ ] No deployment, AWS data mutation, credential creation, or gate flip occurred without exact owner authorization.

---

## COMPLETION CHECKLIST

- [ ] Issue #8 and all native blockers rechecked; canonical wiki pages and active AGENTS instructions re-read.
- [ ] Tasks 1-14 completed in order with immediate focused validation.
- [ ] Every persisted and external input is schema-validated and all evidence/log output is secret-safe.
- [ ] One CloudTrail event is root-deduplicated and all three metrics are atomic.
- [ ] Trail policy synthesis proves the deterministic exact SourceArn and no policy/trail dependency cycle.
- [ ] Main queue retry, 14-day DLQ retention, terminal-failure visibility, and idempotent redrive are proven.
- [ ] Watermark tests prove out-of-order no-op and incomplete preservation.
- [ ] Raw/evidence/ledger/aggregate retention is proven at each owning boundary.
- [ ] Full local suite and coverage pass.
- [ ] Fresh `dev-rus02` diff reviewed with no destructive/public/unrelated changes.
- [ ] If AWS deployment was not authorized, Tasks 15 preview evidence is recorded and Task 16 is explicitly pending—not reported complete.
- [ ] If deployment was authorized, real transfer evidence and cleanup are recorded without secrets.
- [ ] `priced` mode is enabled only after the decision rule passes and receives its own reviewed diff/deploy authorization.
- [ ] Code review treats double-counting, silent partial metering, premature freshness, raw evidence leakage, broad selector/IAM, and gate bypass as release blockers.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **No blocking ticket-level architecture question remains.** This plan inherits CloudTrail/S3 delivery, eventID dedupe, `bytesTransferredOut`, retention, replay, and the acceptance gate from the approved Architecture page.
- **Assumption — gate representation:** the gate is an auditable source-controlled deployment mode, initially `evidence-only`, rather than a mutable database flag or zero-price mutation. This keeps price versions immutable and makes enabling cost require review, diff, and deployment.
- **Assumption — evidence promotion:** accepted evidence-only events may be priced later only through exact raw-log/evidence replay at original occurrence time after the acceptance rule passes. Existing events are never repriced.
- **Assumption — three charges per successful event:** one accepted GetObject yields the existing S3 download request, outbound bytes, and CloudTrail data-event metrics. A zero-byte successful/cancelled event may produce request/data-event quantities and zero outbound bytes only if the deployed matrix establishes that the record is trustworthy; otherwise cancellation remains quarantined and the gate fails.
- **Assumption — quarantine resolution:** this ticket records/replays/quarantines but does not create a public/manual correction API. Later successes do not clear incompleteness. RUS-10 may add reviewed resolution tooling and alarms.
- **Assumption — replay addressing:** reconciliation accepts exact retained log object keys; it does not scan the usage table or list the entire bucket. The operator harness may perform a bounded, date/prefix-scoped S3 listing after exact AWS identity verification.
- **Assumption — durable delivery:** S3 sends filtered log-object notifications to a standard SQS main queue; the named processor consumes batch size one, exhausted messages remain in a 14-day DLQ, and the 90-day raw log remains the longer-lived source for exact-key replay.
- **Assumption — one processor:** the named processor handles both SQS-wrapped S3 notifications and strict internal replay jobs, avoiding a second compute deployment surface while remaining directly invocable for acceptance.
- **External completion gate:** full ticket acceptance cannot be claimed from local tests alone. General-purpose S3 byte/range/cancellation semantics require a separately authorized non-production deployment and real evidence.
- **Pre-existing observation, not scope:** the public download route's explicit action arrays look narrower than its runtime control-table lookup, while deployed RUS-06/RUS-07 evidence says the route passed. Recheck effective synthesized IAM during the fresh diff/acceptance run; do not bundle an unrelated policy change into RUS-08 unless the deployed path actually fails and the owner approves that scope.

## NOTES (open canvas)

### Why evidence-first instead of a zero-price version

The existing price version truthfully stores published non-zero list rates and is immutable. Mutating it, inserting a fake zero published rate, or recording non-zero events before the gate passes would violate RUS-04. Evidence-only mode retains trustworthy quantities and event identity without creating ledger cost. After the gate passes, the same raw event is promoted once and priced at its original occurrence time.

### Why a batch transaction instead of three `recordUsage` calls

The current source digest is based on project + source kind + source ID, not metric. Reusing one event ID across three metrics is classified as divergent evidence. Giving each metric a suffix fixes identity but still allows a crash after one metric and advances watermarks too early. A processed-event root plus one transaction gives durable eventID dedupe, all-or-nothing three-metric accounting, one aggregate total delta, and a clear point after which freshness may advance.

### Intended data flow

```text
S3 direct GetObject
  -> CloudTrail advanced selector (Data + GetObject + FileBucket/projects/)
  -> private 90-day gzip log bucket
  -> ObjectCreated notification
  -> durable SQS main queue -> bounded retries -> 14-day DLQ on exhaustion
  -> named batch-size-one processor
       -> strict archive + record validation
       -> canonical parseFileObjectKey attribution
       -> failed/ambiguous ---------------------> deterministic quarantine (no cost)
       -> accepted + evidence-only ------------> processed evidence only
       -> accepted + priced -------------------> one Dynamo transaction
                                                    evidence promotion/root dedupe
                                                    3 immutable usage events
                                                    3 metric aggregate deltas
                                                    1 total aggregate delta
                                                  -> canonical watermark advance

Inspected DLQ message -> authorized redrive to main queue -> same idempotent processor
Exact retained log key -> same processor reconcile mode -> idempotent replay
                                                     -> rebuild affected project/month
```

### Pricing-gate state sequence

```text
evidence-only (default)
  -> authorized non-production deploy
  -> real transfer matrix + raw log inspection + duplicate replay
  -> FAIL: remain evidence-only; raise CloudFront fallback decision
  -> PASS: reviewed source change to priced
           -> fresh diff + separate deploy authorization
           -> replay retained accepted evidence
           -> verify immutable non-zero usage once
```

### Main risks

1. AWS does not formally guarantee general-purpose S3 `bytesTransferredOut` presence or cancellation/range semantics. The real matrix is intentionally release-blocking.
2. CloudTrail delivery and S3 notifications are delayed, unordered, and duplicated. Correctness relies on persistent evidence and ledger conditions; SQS/DLQ preserves retry state and terminal failures, while retained raw logs remain the recovery source.
3. The current watermark implementation clears incomplete state on later success and mishandles an existing null field when marking incomplete. This ticket must correct those semantics with regression tests.
4. Raw provider/SST type surfaces are hand-declared for tests. Implementation must compare generated types after `infra:install` and avoid untyped globals.
5. A CloudTrail bucket policy that derives `aws:SourceArn` from `trail.arn` would create a provider graph cycle. The trail name/ARN must be deterministic before either resource exists and covered by synthesis tests.
6. The shared stage contains retained development fixtures. The harness must use unique disposable identities, revoke credentials, and never assume an empty table/bucket/queue.

Confidence score for one-pass implementation: **8.6/10**. Repository seams, metrics, prices, retention helpers, direct downloads, canonical keys, and tests already exist. The remaining uncertainty is deliberately isolated to the deployed AWS byte-semantics gate; local implementation is otherwise fully specified.

## AMENDMENTS

<!-- Append approved/executed plan changes here; newest entry at the bottom. -->
