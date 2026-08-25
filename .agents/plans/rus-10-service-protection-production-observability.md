# Feature: RUS-10 Service Protection and Production Observability

This plan is implementation-ready against `main` at commit `04c9fb0`. Implementation must first revalidate issue relationships, the default branch, cited seams, installed SST/Pulumi types, and current official documentation. It must not deploy, mutate AWS data, execute operator suspension/backfill, subscribe an alert destination, or write to GitHub without separate owner authorization.

## Feature Description

Protect project-key-authenticated File Management control operations with a shared per-project rate limit, rapid operator-controlled key/project suspension, narrower resource policies, explicit storage security, and actionable production observability without exposing secrets or AWS internals.

The implementation adds a DynamoDB fixed-window counter keyed only after authentication, internal active/suspended state, fail-safe private/public authorization, redaction at the logging boundary, low-cardinality metrics, explicit retry/dead-letter behavior, a queryable metering-freshness index, production CloudWatch alarms, and an unsubscribed SNS alarm topic.

## User Story

As the service operator,
I want abusive, suspended, backlogged, and failed workloads to stop safely and produce actionable signals,
So that one project cannot degrade others, compromised credentials can be contained quickly, and faults can be diagnosed without leaking transfer capabilities.

## Problem Statement

RUS-03 through RUS-08 established verified project context, direct S3 transfers, lifecycle workers, usage pricing, and download metering. Production gaps remain:

- Active keys can authorize unlimited control calls; API Gateway throttles cannot enforce an exact shared quota per verified internal project.
- The key enum has `suspended` but no atomic mutation; projects have no operational status; stable public redirects ignore project suspension.
- Logs depend on every caller choosing safe fields despite an existing recursive redactor.
- Powertools metrics are constructed but unused; caught HTTP 500s do not increment native Lambda `Errors`.
- File-completion and scheduled workers have no explicit failure destination; no production alarms exist.
- Project-partitioned watermarks cannot be evaluated across projects without a new index.
- File-bucket HTTPS is custom, encryption is implicit, and completion has unused `s3:ListBucket`.

## Solution Statement

Authenticate first, then use one conditional DynamoDB update to admit requests 1-60 in the current UTC minute for the trusted internal project. Request 61 returns the standard envelope plus deterministic `Retry-After`. All six private `/v1/files` operations share the counter across active keys. Health, owner-control routes, direct S3 traffic, workers, and the public redirect do not consume it.

Add backward-compatible `active | suspended` project state and atomic dual-record key transitions. A guarded local operator command reuses repository services, exact `ntz-cli` identity policy, an explicit stage, dry-run default, and `--apply`. No public admin API is added. Private failures remain generic 401s; suspended public projects map to the existing generic file 404.

Make `safeLogger` redact every forwarded attribute. Add a Powertools invocation/metric helper that flushes and resets in `finally`. Instrument HTTP and async outcomes, add worker failure destinations, correct SQS visibility, explicitly enforce bucket transport/encryption, add sparse watermark indexing/freshness monitoring, and create production-only alarms/actions.

## Out of Scope / Non-Goals

- No public suspension endpoint, dashboard operator UI, role model, or unauthenticated admin surface.
- No API Gateway usage plan or caller-supplied project ID; no per-key quota.
- No throttling direct S3 bytes, Cognito owner routes, health, workers, or public redirects.
- No established contract change except safe 429 plus `Retry-After`.
- No immediate revocation of already-issued presigned URLs.
- No STS/session-tag redesign or bucket-per-project architecture; static IAM remains on stage `projects/*` objects.
- No file-bucket lifecycle expiration; trash/purge remains authoritative.
- No download-pricing gate change, evidence replay, price change, or live RUS-08 exercise.
- No automatic external alarm subscription.
- No deploy, data mutation, suspension, backfill, or notification test during implementation.

## Feature Metadata

**Feature Type**: Security hardening / operational reliability

**Estimated Complexity**: High

**Primary Systems Affected**: project authentication, identity/control persistence, File Management authorization/public access, HTTP/observability, usage watermarks, async workers, SST infrastructure, operator tooling, integration/policy tests

**Dependencies**: Node 24, TypeScript 6, SST 4.17.1, Pulumi AWS 7.43.0, Zod 4.4.3, AWS SDK v3, Powertools 2.34.0, DynamoDB, API Gateway, Lambda, S3, SQS, EventBridge Scheduler, CloudWatch, SNS

## Related Work

**Implements**: [RUS-10 / issue #10](https://github.com/noamtz/utility-services/issues/10) - **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) - **Architecture**: [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture)

Native readiness verified 2026-08-25: blockers #3, #5, #7, and #8 are closed. RUS-10 blocks open RUS-11. Project status is `Todo`.

Back-references: RUS-03 credential/authentication, RUS-05 upload/lifecycle, RUS-06 download/public access, RUS-07 trash/purge, RUS-08 metering, and RUS-09 dashboard/integration plans. Preserve their established contracts, idempotency, evidence-only pricing, and server-side-secret boundaries.

Forward-reference: RUS-11 must subscribe/verify an approved alert destination and execute authorized live abuse, suspension, backlog, and assembled-system proof.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: READ BEFORE IMPLEMENTING

- `AGENTS.md`; `package.json`; `vitest.config.ts`; `tooling/run-sst.mjs:12-151` and tests.
- `packages/backend/src/modules/project-authentication/authorization.ts:1-16` and `service.ts:21-95` with tests: bearer extraction, generic denial, constant-time verification, four-record consistent snapshot.
- `packages/backend/src/modules/identity-control/credentials/model.ts:11-190` and `repository.ts:48-83,173-520`: dual key records and atomic lifecycle patterns.
- `packages/backend/src/modules/identity-control/projects/model.ts:10-145` and `repository.ts:31-35,85-181`: strict stored/public project models and status-update seam.
- `packages/backend/src/modules/file-management/handlers.ts:30-119`, `downloads.ts:14-92`, and `runtime.ts:32-220`: six private routes, separate public redirect, shared control client.
- `packages/backend/src/core/http/handler.ts:38-330` and `core/observability/{powertools,redact,request-context}.ts`: error/header order, request IDs, redaction seam.
- `packages/backend/src/modules/file-management/workers.ts` and `usage-pricing/metering-worker.ts`: completion/reconciliation/purge and poison/transient behavior.
- `packages/backend/src/modules/usage-pricing/model.ts:130-170,332-440` and `repository.ts:74-125,379-392,789-858`: watermark records/updates.
- `packages/backend/src/modules/identity-control/usage/policy.ts:1-15`: existing 24-hour freshness precedent.
- `infra/config/control.ts:22-31` and `infra/control.ts:12-55`: ControlTable lacks TTL.
- `infra/config/file-management.ts:1-170` and `infra/file-management.ts:30-105`: route IAM, `projects/*`, unused ListBucket, bucket, notification, crons.
- `infra/config/download-metering.ts:7-111` and `infra/download-metering.ts:41-175`: queue/DLQ, visibility, log lifecycle, trail.
- `infra/config/usage-pricing.ts:9-25,144-161` and `infra/usage-pricing.ts:20-65`: fields/indexes/TTL/protection.
- `infra/{dynamo-link,bucket-link,api}.ts`, `infra/sst-globals.d.ts`, `sst.config.ts`, and composition tests: least-privilege links and resource ordering.
- Existing project-auth, upload, private/public download, trash lifecycle, and metering integration tests.
- `README.md` and `.agents/references/backend-api-best-practices.md`.

### New Files to Create

- `project-authentication/rate-limit/{model,repository,service}.ts` plus tests.
- `identity-control/operations/suspension.ts` plus test.
- `tooling/aws-access.mjs`, `tooling/run-operator.mjs`, `tooling/operations/set-suspension.mjs`, and `tooling/operations/backfill-watermark-index.mjs`, each with a Vitest `.test.ts` file. The dedicated wrapper may invoke only these two allowlisted tools through SST linked-resource context.
- `core/observability/metrics.ts` plus test.
- `usage-pricing/freshness-monitor.ts`, thin scheduled function, and tests.
- `infra/config/observability.ts`, `infra/observability.ts`, and tests.
- `tests/integration/service-protection.test.ts`.

Keep rate limiting inside project authentication and suspension persistence in identity/control.

### Relevant Official Documentation

- [DynamoDB conditions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html), [updates](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html), and [TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html): atomically increment below 60; TTL is cleanup, never correctness.
- [API Gateway usage plans](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html) and [throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html): best-effort gateway limits do not implement the verified shared-project boundary.
- [Cognito token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html): owner tokens do not control server-side project credentials.
- [S3 IAM](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security_iam_service-with-iam.html), [prefix policy keys](https://docs.aws.amazon.com/AmazonS3/latest/userguide/amazon-s3-policy-keys.html), [BPA](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html), and [encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingEncryption.html): strongest static prefix, private/HTTPS/BPA, explicit SSE-S3.
- [SST Bucket](https://sst.dev/docs/component/aws/bucket), [ApiGatewayV2](https://sst.dev/docs/component/aws/apigatewayv2), and installed SST Cron/Function declarations: pinned links, retries, DLQs, and transforms.
- [Powertools Metrics](https://docs.aws.amazon.com/powertools/typescript/latest/api/classes/_aws-lambda-powertools_metrics.index.Metrics.html), [usage patterns](https://docs.aws.amazon.com/powertools/typescript/latest/getting-started/usage-patterns/), and [Logger](https://docs.aws.amazon.com/powertools/typescript/latest/features/logger/): dimensions, per-invocation publish/reset, structured logging.
- [Lambda SQS configuration](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html) and [error handling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html): visibility at least six times timeout; poison/transient behavior.
- [SQS metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html), [EventBridge DLQs](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html), and [CloudWatch missing data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html): native metrics, destinations, sparse versus continuous alarms.
- [CloudTrail delivery](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-working-with-log-files.html): delivery is generally within minutes, not guaranteed; queue-age warning is 15 minutes while domain freshness remains 24 hours.

### Patterns and Invariants

**Verified-context limiting**

```ts
const project = await authentication.authenticate(parsedCredential);
await limiter.admit(project.internalProjectId, now);
return project;
```

- Authenticate first so invalid credentials cannot create counters or exhaust another project.
- Use server-derived `RATE#<internalProjectId>` / `MINUTE#<epochMinute>` and short-lived `expiresAt`.
- One conditional update initializes/increments while count is below 60. Never read then write.
- Return `Retry-After: max(1, secondsUntilNextUtcMinute)` without exposing counts/keys.

**Suspension**

- New projects persist active; missing legacy status parses active, but later writes are explicit.
- Key lookup and metadata transition atomically. Only active-to-suspended-to-active is reversible; revoked/replaced stay terminal.
- Project transition changes metadata only; it does not rewrite keys.
- Private auth checks both statuses. Public auth checks project status before file lookup/presigning and maps suspended/missing to the same 404.

**Safe observability**

- `safeLogger` redacts at final forwarding. Callers still pass allowlisted summaries; never log raw events.
- Never log credentials, auth/cookie headers, full URL queries, S3 payloads, bucket/object keys, project/file IDs, or provider errors.
- Correlation ID can be a log attribute, never a metric dimension.
- Use `UtilityServices` with static `Stage`, `Service`, `Operation`, `Outcome` only; flush/reset metrics in `finally`.

**Least privilege**

- Keep object permissions on the stage bucket's `projects/*` objects; trusted key generation enforces exact project prefix.
- Add ControlTable `UpdateItem` only to six private functions; public redirect remains read/query-only.
- Freshness monitor gets GSI query only; operator backfill permissions do not enter runtime roles.
- Remove unused completion `s3:ListBucket`; do not widen global links.

---

## IMPLEMENTATION PLAN

### Phase 1: Protection State and Exact Project Throttling

Add backward-compatible project status, atomic key/project suspension, trusted-context limiting, and safe 429 headers.

### Phase 2: Redacted Observability and Async Failure Handling

Harden logging, add low-cardinality metrics, instrument outcomes, and configure retries/failure queues.

### Phase 3: Storage/IAM Hardening and Freshness Signals

Remove unused permissions, make transport/encryption/retention explicit, index watermarks, and emit freshness gauges without scans.

### Phase 4: Production Alarms, Tooling, and Proof

Create production-only alarms/topic, finish guarded tools, add cross-boundary proof/documentation, and run local/read-only validation.

---

## STEP-BY-STEP TASKS

Execute every task in order. Each is atomic and independently testable.

### 1. UPDATE internal project status and persistence

- **UPDATE**: project model/repository and tests/fixtures.
- **IMPLEMENT**: `ProjectOperationalStatusSchema = active | suspended`; default missing stored status to active; persist active on creation; omit status from public contracts/projections.
- **IMPLEMENT**: conditional `setOperationalStatus(publicProjectId, expected, next, changedAt)` with typed not-found/state-conflict behavior and idempotent orchestration.
- **TEST**: new/legacy/invalid state, round trip, idempotency, missing/race conflict, no public leak.
- **GOTCHA**: do not alter utility/settings/owner records or dashboard behavior.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/projects/model.test.ts packages/backend/src/modules/identity-control/projects/repository.test.ts`
- **SATISFIES**: AC2 project state foundation and contract safety.

### 2. UPDATE atomic key suspension lifecycle

- **UPDATE**: credential model/repository, lifecycle helpers, service fixtures/tests.
- **IMPLEMENT**: one transaction conditionally updates metadata and lookup with matching expected/next status/timestamp.
- **RULES**: active-to-suspended and suspended-to-active only; desired-state repeat is idempotent after strong inspect; revoked/replaced terminal; mismatches fail closed.
- **TEST**: both directions, atomicity, concurrency, missing/mismatch, terminal refusal, verification snapshot after transition.
- **GOTCHA**: never return/log plaintext or digest; preserve revoke/replace.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/credentials/model.test.ts packages/backend/src/modules/identity-control/credentials/repository.test.ts packages/backend/src/modules/identity-control/credentials/service.test.ts`
- **SATISFIES**: AC2 key suspension and safe lifecycle.

### 3. CREATE guarded suspension service and operator command

- **CREATE/UPDATE**: suspension orchestration; shared `tooling/aws-access.mjs`; dedicated `tooling/run-operator.mjs`; operator command/tests; refactor `run-sst.mjs` to import shared preflight without changing its accepted commands; add package help/scripts.
- **IMPLEMENT**: `run-operator.mjs` accepts only the suspension and watermark-backfill script identifiers, performs exact profile/region/CA/STS identity preflight, then invokes pinned SST `shell` with the explicit stage so the child reads `Resource.ControlTable`/`Resource.UsagePricingTable`; reject arbitrary commands, executable paths, unknown arguments, and caller-supplied physical table names.
- **IMPLEMENT**: suspension command requires target project/key, public project ID, optional key ID, action suspend/resume; dry-run default; `--apply` plus confirmation token. Production is permitted only when the explicit stage, exact identity, confirmation, and separately granted external-mutation authorization all agree.
- **OUTPUT**: target kind/public ID, stage, current/desired state, applied flag only. No secrets, hashes, Dynamo keys/items, or provider response.
- **TEST**: wrapper allowlist and argument forwarding, linked resource resolution, parser, dry-run, identity mismatch, wrong profile/region, production-without-confirmation rejection, apply gate, idempotency, terminal refusal, injected calls.
- **GOTCHA**: building the command is local; executing `--apply` is an external mutation requiring separate authorization.
- **VALIDATE**: `npm test -- --project node tooling/aws-access.test.ts tooling/run-operator.test.ts tooling/operations/set-suspension.test.ts packages/backend/src/modules/identity-control/operations/suspension.test.ts tooling/run-sst.test.ts`
- **SATISFIES**: AC2 containment and AWS continuity.

### 4. CREATE the per-project fixed-window limiter

- **CREATE**: rate-limit model/repository/service/tests; add ControlTable TTL `expiresAt` and 60-request/60-second/cleanup constants.
- **IMPLEMENT**: UTC minute keys/expiry/retry from injected time; one conditional update initializes count 1 or increments below 60; typed admitted/limited result; safe 429.
- **TEST**: 1-60 admit, 61 deny, exact rollover, independent projects, retry 1-60 seconds, 61 concurrent updates never admit over 60, TTL not correctness, invalid inputs rejected before Dynamo.
- **GOTCHA**: key only by authenticated internal UUID.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/project-authentication/rate-limit/model.test.ts packages/backend/src/modules/project-authentication/rate-limit/repository.test.ts packages/backend/src/modules/project-authentication/rate-limit/service.test.ts infra/config/control.test.ts infra/control.test.ts`
- **SATISFIES**: AC1 exact quota/retry and AC8 concurrency/config.

### 5. COMPOSE suspension and limiting into private authorization

- **UPDATE**: authentication service/authorization/runtime, file handlers/runtime/tests, API IAM descriptors, control links.
- **IMPLEMENT**: reject non-active project with generic unauthorized; after successful auth call limiter; use protected derivation on all six private routes.
- **IMPLEMENT**: extend `HttpError` with narrow validated response headers or a dedicated retry value; serialize only `Retry-After` with content type/request ID.
- **IAM**: grant ControlTable `UpdateItem` only to six private file functions.
- **TEST**: invalid/revoked/suspended credentials do not count; same-project keys share; projects isolate; all routes protected; 429 envelope/header; header injection rejected.
- **GOTCHA**: protection stays before domain work and presigning.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/project-authentication/authorization.test.ts packages/backend/src/modules/project-authentication/service.test.ts packages/backend/src/core/http/handler.test.ts packages/backend/src/modules/file-management/handlers.test.ts infra/config/file-management.test.ts infra/api.test.ts`
- **SATISFIES**: AC1, AC2 private path, AC7 safe errors, AC8.

### 6. ENFORCE project suspension on stable public access

- **UPDATE**: downloads service/runtime, project-reader typing, tests.
- **IMPLEMENT**: require active project before public file lookup/presign; map missing/suspended to the same generic `FILE_NOT_FOUND`.
- **TEST**: active unchanged; suspended gets no redirect/presign; private/missing/suspended indistinguishable; resume restores authorization.
- **GOTCHA**: public redirect does not consume private quota, preventing unauthenticated quota exhaustion.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/file-management/downloads.test.ts tests/integration/service-protection.test.ts`
- **SATISFIES**: AC2 whole-project suspension without public leakage.

### 7. HARDEN structured logging and metric boundaries

- **UPDATE/CREATE**: Powertools/redactor/HTTP handler and new metrics helper/tests.
- **IMPLEMENT**: redact immediately before every logger call; safely summarize unknown errors; allowlist metric names/dimensions; publish in `finally`; reset warm state.
- **HTTP METRICS**: completion, project-auth rejection, project-rate rejection, caught internal failure. Do not rely on native Lambda Errors for converted 500s.
- **TEST**: nested/case-insensitive bearer/token/cookie/signature/credential/presigned URL redaction; circular/deep values; boundary cannot bypass; publish on all paths; no warm bleed; low-card dimensions.
- **GOTCHA**: no raw gateway event, headers/body, error, URL, or trusted context to observability calls.
- **VALIDATE**: `npm test -- --project node packages/backend/src/core/observability/redact.test.ts packages/backend/src/core/observability/powertools.test.ts packages/backend/src/core/observability/metrics.test.ts packages/backend/src/core/http/handler.test.ts`
- **SATISFIES**: AC5, AC6 signals, AC7 correlation, AC8 redaction proof.

### 8. INSTRUMENT asynchronous workers without changing idempotency

- **UPDATE**: file workers, metering worker, runtimes/functions, tests with the invocation helper.
- **EMIT**: completion/reconciliation/purge processed/succeeded/failed/page/item counts; metering processed/recorded/observed/duplicate/quarantine/quarantine-duplicate/rebuilt/transient-failure counts.
- **CORRELATE**: opaque invocation ID in logs only; preserve approved safe evidence hashes, never event/key/bucket/project/file/URL detail.
- **BEHAVIOR**: poison stays quarantined/acknowledged; transient failures rethrow; duplicates stay idempotent.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/file-management/workers.test.ts packages/backend/src/modules/usage-pricing/metering-worker.test.ts packages/backend/src/modules/usage-pricing/download-metering.test.ts`
- **SATISFIES**: AC5, AC6 metering signals, AC7 retry/quarantine/correlation, AC8.

### 9. ADD explicit async retries and failure destinations

- **UPDATE**: File Management and download-metering infra config/resources/tests.
- **IMPLEMENT**: encrypted 14-day file-operations DLQ; upload-completion async two retries/on-failure destination; both crons two retries/same operational DLQ using installed supported SST properties/transforms.
- **IMPLEMENT**: metering visibility 180 to 360 seconds for the 60-second processor; preserve max receives 5, 14-day DLQ, batch 1, encryption, transient rethrow.
- **PERMISSIONS**: destination-send only; leave failure queue unconsumed for evidence.
- **TEST**: retries, encryption/retention, destination policy, visibility, redrive, poison behavior.
- **GOTCHA**: inspect pinned declarations first; do not redesign primary S3 delivery.
- **VALIDATE**: `npm test -- --project node infra/config/file-management.test.ts infra/file-management.test.ts infra/config/download-metering.test.ts infra/download-metering.test.ts infra/composition.test.ts`
- **SATISFIES**: AC6 backlog/failure, AC7 retry/DLQ, AC8 config.

### 10. TIGHTEN S3 transport, encryption, retention, and IAM

- **UPDATE**: file/download-metering config/resources/tests and `sst-globals.d.ts` from installed provider types.
- **IMPLEMENT**: FileBucket `enforceHttps: true`; remove custom transport policy; preserve BPA/private ownership; explicitly declare AES256 SSE-S3 for file/log buckets with Pulumi companion resources if SST lacks a property.
- **VERIFY**: production protect/retain; no file expiration; CloudTrail logs 90 days; queue/DLQ encryption/retention.
- **REMOVE**: completion `s3:ListBucket`; keep only used object actions.
- **TEST**: HTTPS, BPA, encryption, protect/retain/forceDestroy, lifecycle, exact `projects/*` ARNs, no wildcard expansion.
- **GOTCHA**: do not require an SSE upload header; default encryption must not change the upload contract.
- **VALIDATE**: `npm test -- --project node infra/config/file-management.test.ts infra/file-management.test.ts infra/config/download-metering.test.ts infra/download-metering.test.ts infra/composition.test.ts`
- **SATISFIES**: AC3, AC4, AC8.

### 11. INDEX watermarks and CREATE the freshness monitor

- **UPDATE/CREATE**: usage model/repository/config/resource/runtime/tests; monitor domain/function/tests; guarded legacy backfill tool/tests.
- **MODEL**: sparse `gsi1pk = WATERMARK#<sourceKind>` and `gsi1sk = <lastMeteredAt>#<internalProjectId>`; legacy rows may omit; add one GSI.
- **REPOSITORY**: watermark updates maintain the index monotonically; incomplete keeps effective time; bounded paginated GSI query returns older-than-cutoff rows for configured sources; never scan.
- **MONITOR**: every five minutes query `cloudtrail-download` and configured sources at the existing 24-hour threshold; always emit stale count, incomplete count, and check-success gauge.
- **BACKFILL**: resolve UsagePricingTable only through the allowlisted SST-linked operator wrapper; find only watermark records, report aggregate source counts, dry-run default, paginated conditional updates, exact identity/stage/apply gates, never print projects/items.
- **TEST**: new/legacy parse, monotonic keys, cutoff/pagination, no scan, fresh/stale/incomplete/empty/failure metrics, backfill idempotency/conflict/dry-run.
- **GOTCHA**: historical rows enter the GSI only after attributes exist; inspect and separately authorize backfill before trusting production alarms.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/model.test.ts packages/backend/src/modules/usage-pricing/repository.test.ts packages/backend/src/modules/usage-pricing/freshness-monitor.test.ts infra/config/usage-pricing.test.ts infra/usage-pricing.test.ts tooling/operations/backfill-watermark-index.test.ts`
- **SATISFIES**: AC6 stale/incomplete signal and AC8 migration/index proof.

### 12. CREATE production-only alarms and alert topic

- **CREATE/COMPOSE**: observability config/resources/tests after API/file/metering resources; return safe outputs.
- **CREATE WHEN**: production only. Other stages emit logs/metrics and keep queues but no alarm topic/resources.
- **TOPIC**: encrypted stage SNS topic for every alarm action; no subscription; output ARN plus `subscriptionRequired`.
- **CUSTOM ALARMS**: auth failures >=5/5m; rate limit >=1/5m; caught HTTP failure >=1/5m; file worker failure, metering transient failure, quarantine, or failed freshness check >=1/5m; stale/incomplete gauge >=1 for two 5m periods.
- **NATIVE ALARMS**: API Count >=1200/5m and 5xx >=1/5m; Lambda Errors/Throttles >=1/5m; metering queue oldest age >=900s for two periods; either DLQ visible >=1.
- **MISSING DATA**: not-breaching for sparse counters/native errors; breaching for scheduled check-success; stale/incomplete monitors emit zero each run.
- **TEST**: prod/nonprod counts, namespace/dimensions/thresholds/periods/missing-data/actions, all functions/queues/API represented, encrypted topic, no subscription/identifier.
- **GOTCHA**: centralize tunable MVP thresholds; alarm descriptions contain component/runbook direction, not data IDs.
- **VALIDATE**: `npm test -- --project node infra/config/observability.test.ts infra/observability.test.ts infra/composition.test.ts`
- **SATISFIES**: AC6 complete alarms, AC7 async visibility, AC8 config.

### 13. ADD cross-boundary integration proof

- **CREATE/EXTEND**: service-protection and existing auth/download/metering integration tests.
- **PROVE**: six routes share one project counter across two keys; project B is independent; 61 is 429/retry; rollover; unauth/public cannot count.
- **PROVE**: key suspension isolates one; project suspension blocks all keys plus stable-public fresh authorization; resume restores nonterminal keys; no domain/presigner after denial.
- **PROVE**: concurrency <=60; limit condition is not 500; async duplicates do not duplicate state/cost; transient errors rethrow; redaction removes nested credentials/queries.
- **GOTCHA**: document that in-flight authorization can race suspension and an existing S3 URL can last until expiry.
- **VALIDATE**: `npm test -- --project node tests/integration/service-protection.test.ts tests/integration/project-credential-authentication.test.ts tests/integration/direct-upload-file-lifecycle.test.ts tests/integration/file-trash-lifecycle.test.ts tests/integration/download-metering.test.ts`
- **SATISFIES**: AC1, AC2, AC5, AC7, AC8 end-to-end local proof.

### 14. UPDATE documentation and RUN every gate

- **UPDATE**: README status/resources/operations and AGENTS only if implementation makes an instruction stale.
- **DOCUMENT**: shared quota/429, dry-run/apply boundary, residual URL/in-flight behavior, redaction, retry/DLQ topology, alarm subscription requirement, watermark backfill prerequisite, evidence-only truth.
- **RUN**: all Validation Commands; fix and rerun before advancing.
- **PREVIEW**: after exact identity/no-concurrency checks, wrapper install/diff for `dev-rus02`; inspect TTL/GSI/IAM/buckets/queues/destinations/monitor and production-conditional alarms. Never deploy or run operator/backfill.
- **VALIDATE**: `npm run check`, applicable Codex checks, `git diff --check`.
- **SATISFIES**: every AC and completion gate.

---

## TESTING STRATEGY

### Unit and Policy Tests

- Project/key legacy state, transitions, atomicity, idempotency, races, and terminal states.
- Rate identity/time/TTL/retry calculations and atomic conditional commands.
- Safe retry-header serialization and protection order.
- Redaction, metric dimension validation, flush/reset, and caught-error signals.
- Worker success/duplicate/quarantine/transient outcomes.
- Retry/DLQ/visibility, HTTPS/BPA/encryption/retention, exact IAM, production alarms.
- Sparse watermark keys, monotonic updates, paginated cutoff, monitor gauges, and backfill safety.
- Operator parser, exact identity, stage/apply gates, and safe output.

### Integration Tests

- Same-project keys share 60; another project has its own 60; unauthenticated/public traffic cannot poison counters.
- Key suspension isolates one; project suspension blocks all credentials and stable-public refreshes without enumeration.
- Every private route protects before domain/presigner work.
- Async duplicate/retry/quarantine stays idempotent and summaries stay secret-free.
- Existing upload/download/trash/metering suites remain green without contract changes.

### Edge Cases

- Exact minute boundary, 60 concurrent calls, Dynamo condition conflict, stale TTL item, stage isolation.
- Missing/invalid/terminal/mismatched key, legacy project, simultaneous suspend/auth, repeated action.
- Suspended project with public/private/missing file and URL issued before suspension.
- Case-varied nested secrets, URL fragments/queries, circular data, malformed errors, warm reuse.
- S3/scheduled poison/transient failure, nonempty DLQ, queue age, no/legacy/incomplete watermarks, monitor failure.
- Production versus nonproduction composition and missing metric data.

---

## VALIDATION COMMANDS

Execute in this order.

### Level 1: Syntax and Style

```powershell
npm run format:check
npm run lint
npm run typecheck
```

### Level 2: Focused Tests

```powershell
npm test -- --project node packages/backend/src/modules/identity-control/projects/model.test.ts packages/backend/src/modules/identity-control/projects/repository.test.ts packages/backend/src/modules/identity-control/credentials/model.test.ts packages/backend/src/modules/identity-control/credentials/repository.test.ts packages/backend/src/modules/identity-control/operations/suspension.test.ts packages/backend/src/modules/project-authentication/service.test.ts packages/backend/src/modules/project-authentication/authorization.test.ts packages/backend/src/modules/project-authentication/rate-limit/model.test.ts packages/backend/src/modules/project-authentication/rate-limit/repository.test.ts packages/backend/src/modules/project-authentication/rate-limit/service.test.ts
npm test -- --project node packages/backend/src/core/http/handler.test.ts packages/backend/src/core/observability/redact.test.ts packages/backend/src/core/observability/powertools.test.ts packages/backend/src/core/observability/metrics.test.ts packages/backend/src/modules/file-management/handlers.test.ts packages/backend/src/modules/file-management/downloads.test.ts packages/backend/src/modules/file-management/workers.test.ts packages/backend/src/modules/usage-pricing/metering-worker.test.ts packages/backend/src/modules/usage-pricing/freshness-monitor.test.ts
npm test -- --project node infra/config/control.test.ts infra/control.test.ts infra/config/file-management.test.ts infra/file-management.test.ts infra/config/download-metering.test.ts infra/download-metering.test.ts infra/config/usage-pricing.test.ts infra/usage-pricing.test.ts infra/config/observability.test.ts infra/observability.test.ts infra/api.test.ts infra/composition.test.ts
npm test -- --project node tooling/aws-access.test.ts tooling/run-sst.test.ts tooling/run-operator.test.ts tooling/operations/set-suspension.test.ts tooling/operations/backfill-watermark-index.test.ts tests/integration/service-protection.test.ts
```

### Level 3: Full Regression, Coverage, and Build

```powershell
npm test
npm run test:coverage
npm run build
npm run check
```

### Level 4: Static Security and Diff Review

```powershell
rg -n -i "authorization|bearer|api.?key|x-amz-signature|x-amz-credential|presigned|secret" packages/backend/src infra tooling README.md
git diff --check
```

Review matches; verify no usable secret, full query, provider error, or identifier in logs, alarms, fixtures, or tool output. If AGENTS or Codex configuration changes:

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

### Level 5: Read-Only Infrastructure Preview

```powershell
npm run infra:install -- --stage dev-rus02
npm run infra:diff -- --stage dev-rus02
```

Use only `tooling/run-sst.mjs` after exact account `162067902192`, principal `arn:aws:iam::162067902192:user/ntz-cli`, region `il-central-1`, CA bundle, and no-concurrent-branch verification. Inspect:

- Control TTL and UsagePricing GSI without replacement/data loss.
- Six private functions' narrow update grant; public stays read/query-only.
- File/log HTTPS, BPA, SSE-S3, retention/lifecycle, no ListBucket.
- File operations DLQ/retry and 360-second metering visibility.
- Freshness monitor schedule/query permissions.
- No production alarm/topic in `dev-rus02`; no unexpected replacement/deletion.

Do not deploy, suspend/resume, backfill, create data/credentials, subscribe alerts, or mutate GitHub/wiki/AWS.

---

## ACCEPTANCE CRITERIA

- [ ] Every private File Management control route enforces 60 admitted requests per verified project per UTC minute before domain/presigner work.
- [ ] Active keys share project quota; projects isolate; invalid/public requests cannot create or consume project counters.
- [ ] Request 61 returns safe 429, request ID, deterministic `Retry-After`; the next minute resets without TTL correctness.
- [ ] Guarded tooling can dry-run and, only when authorized, atomically suspend/resume a nonterminal key or project after exact identity/stage verification.
- [ ] Suspended keys/projects cannot authorize private operations; project suspension also prevents fresh stable-public redirects without revealing state.
- [ ] Revoked/replaced keys stay terminal; legacy project status is compatible and new writes explicit.
- [ ] IAM stays stage/`projects/*` scoped; unused ListBucket is removed; runtime keys derive from trusted context.
- [ ] Buckets are private, BPA/HTTPS/SSE-S3 protected; production retention and domain lifecycle remain intact.
- [ ] Final logger boundary redacts credentials, auth/cookie headers, presigned queries, sensitive URLs, and unknown errors.
- [ ] Correlation IDs expose no auth internals; metrics use static low-cardinality dimensions.
- [ ] Workers signal success/failure/duplicate/quarantine while preserving idempotency.
- [ ] Completion/crons have retry/failure destinations; metering visibility is 360 seconds and redrive explicit.
- [ ] Watermarks are sparsely indexed/evaluated without scans and emit stale/incomplete/check-success metrics; legacy backfill is safe/dry-run.
- [ ] Production alarms cover auth, limiting, HTTP/Lambda failures, unexpected volume, backlog, DLQs, metering/quarantine, stale/incomplete/failed freshness.
- [ ] Every production alarm targets an encrypted topic; no subscription is created without owner decision.
- [ ] Unit/integration/policy/alarm/redaction/abuse/suspension/concurrency tests and full gates pass.
- [ ] Any preview is exact-identity/read-only; no deployment or mutation occurs.

---

## COMPLETION CHECKLIST

- [ ] Tasks and task-level validation completed in order.
- [ ] Public shapes stay stable apart from documented 429/`Retry-After`.
- [ ] No counter uses unverified input; no suspended context reaches domain/presigner.
- [ ] No credential, token, query, bucket/object, provider error, or auth internal appears in observability/docs/tools.
- [ ] Metric state flushes/resets on every warm invocation.
- [ ] Retry/DLQ settings and alarm references match resources.
- [ ] GSI/backfill compatibility is proved; production monitor has no scan.
- [ ] Full format/lint/typecheck/test/coverage/build/check/diff gates pass.
- [ ] Preview/deploy/operator/backfill/subscription boundaries are followed.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Control scope**: The limit covers all six private project-key `/v1/files` operations: upload authorization, list, inspect, download authorization, trash/force-delete, and restore. It excludes transfer bytes and public redirects.
- **Operator surface**: No admin HTTP principal exists, so a guarded local command is the narrowest rapid control. Remote/operator UI requires architecture amendment.
- **Residual capability**: Suspension applies after committed state. One in-flight request can race, and an issued presigned URL can last until its 1-60 minute expiry. Immediate revocation needs a different architecture.
- **IAM limit**: A shared Lambda role can restrict to stage `projects/*`, not a runtime project ARN. Trusted-context keys/tests provide isolation; STS delegation is out of scope.
- **Alert delivery**: SNS has no subscription because endpoint/recipient is an external decision. RUS-11 must attach/verify one before release.
- **Threshold baseline**: Values are conservative MVP defaults and centralized for tuning. `1200/5m` flags gross volume; exact project limiting remains DynamoDB.
- **Freshness**: Existing 24-hour semantics are reused. Stale/incomplete are warning signals; queue age/DLQ/failure identify processor faults. Evidence-only download metering can legitimately have no priced watermark.
- **Legacy watermarks**: The GSI cannot see old rows before attribute backfill. A guarded tool is included, but execution requires separate authorization after dry-run.
- **No critical ambiguity remains** under these assumptions. Quota scope, remote suspension, immediate URL revocation, alert recipients, pricing, or IAM redesign requires amendment.

## NOTES (open canvas)

### Protection flow

```text
Bearer credential
      |
      v
parse + constant-time verify + consistent snapshot
      |
      +-- key/project inactive ----------------> generic 401
      |
      v
trusted internal project
      |
      v
atomic project/minute counter (1..60)
      |
      +-- over limit --------------------------> safe 429 + Retry-After
      |
      v
validated domain operation / temporary S3 presign
```

Public stable access follows a separate active-project/public-file validation path and does not touch private quota.

### Operational signal flow

```text
HTTP + workers + metering + freshness monitor
                    |
                    +--> redacted structured logs
                    +--> UtilityServices low-cardinality metrics
AWS native API/Lambda/SQS/EventBridge metrics
                    |
                    v
production-only CloudWatch alarms
                    |
                    v
encrypted SNS topic (subscription pending owner decision)
```

### Confidence Score

**8/10** for one-pass local implementation. Existing auth snapshots, idempotent workers, explicit IAM descriptors, strict schemas, and infrastructure tests are strong. Main risks are pinned-SST async-destination syntax, backward-compatible watermark indexing, Powertools reset behavior, and narrow shared-counter IAM. Installed-type drift checks and focused tests cover each.

## AMENDMENTS

(None at creation.)
