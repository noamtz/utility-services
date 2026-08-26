# Feature: RUS-11 End-to-End Activation and Release Readiness

This plan is implementation-ready against `main` at commit `da7a682`. Before implementation, revalidate the issue relationships, default branch, cited seams, installed package versions, and current official documentation. Local implementation does not authorize deployment, Cognito user creation or password changes, project/key/file mutations, CloudTrail replay/redrive, pricing-mode changes, alarm subscriptions, GitHub/Wiki writes, or the two-user product experiment.

## Feature Description

Prove that the assembled File Management MVP is safe, attributable, recoverable, observable, and usable within the five-minute activation target. The work adds the repository's first real browser-level end-to-end suite, a dry-run-by-default release harness, focused regression coverage for the remaining cross-boundary risks, and a canonical release-evidence procedure.

The automated deployed journey uses two independent invited Cognito owners and two independent projects. Each owner signs in through the real dashboard, creates a project, issues a one-time project key, and exercises the server-side REST/direct-S3 flow. The journey verifies upload completion, list/inspect, private and stable public downloads, trash, restore, force delete, owner/project isolation, guessed identifiers, key replacement/revocation, expiry semantics, usage freshness, safe errors, and a measured key-to-first-upload/download activation time. State-heavy protection and asynchronous failure cases that are unsafe or impractical to induce against a shared stage remain deterministic local tests. The already-built RUS-08 harness remains the only owner-authorized live CloudTrail transfer/pricing-gate exercise.

Release evidence is deliberately split into:

1. repeatable local tests and static/synthesis validation;
2. an opt-in, guarded Playwright journey against one explicitly named non-production stage;
3. separately authorized CloudTrail, alarm-delivery, and operator checks; and
4. the human two-owner/three-day product experiment recorded in the canonical GitHub Wiki.

## User Story

As the product owner preparing the private MVP,
I want repeatable proof of the complete two-owner activation journey and every release-blocking boundary,
so that I can invite real users knowing the service is isolated, recoverable, attributable, observable, and fast to integrate.

## Problem Statement

RUS-01 through RUS-10 implemented and locally tested every bounded context, but the repository still has no browser runner and no automated journey across the deployed dashboard, Cognito, control API, project authentication, direct S3 transfer, file lifecycle, and usage view. Existing `tests/integration` suites are strong in-memory assembled-boundary tests; they are not deployed end-to-end evidence. Live CloudTrail semantics, alert delivery, and the product hypothesis also cannot be proven by local mocks.

Without a deliberate release layer, the project could pass 577+ isolated tests while still failing at CloudFront forwarding, Cognito challenge handling, cross-owner composition, real presigned transfer, eventual consistency, secret-safe evidence capture, or five-minute activation. Conversely, running an ad-hoc live script against `dev-rus02` could mutate shared data, leak one-time secrets into artifacts, retry destructive actions, or falsely claim pricing/alert readiness.

## Solution Statement

Add standalone Playwright Test, pinned to the implementation-time stable version compatible with Node 24 (`@playwright/test` was `1.62.1`, Node `>=20`, when this plan was written). Keep Vitest for unit, component, integration, infrastructure, and acceptance-harness tests. Configure one serial Chromium project for an explicitly authorized deployed stage, with zero retries and secret-bearing traces/screenshots/video disabled. Use two isolated browser contexts without persisted storage state, and API request contexts for server-side File Management calls after keys are issued through the UI.

Wrap Playwright execution in a tested, no-network dry-run-by-default Node harness that validates the non-production stage and HTTPS origins, requires an exact stage-bound execution confirmation, reads owner credentials only from process environment, performs the mandated AWS identity preflight, launches only the local Playwright binary without a shell, and emits a bounded redacted summary. The spec itself also refuses to run without the execution marker so direct invocation cannot bypass the guard.

Extend the existing owning-boundary suites only where the release matrix exposes gaps. Do not duplicate every domain fixture into one giant local test or change production behavior merely to make a test convenient. Retain the existing RUS-08 transfer harness for actual CloudTrail byte/replay evidence. Update `README.md` with the safe release procedure, then—only after explicit external-write authorization—record the human experiment and release decisions in the canonical Wiki/Issue rather than creating a competing local evidence document.

## Out of Scope / Non-Goals

- Not included: new File Management behavior, dashboard file-management controls, browser-side use of project API keys, or S3 CORS changes. The dashboard provisions projects/keys and shows guidance/usage; file calls remain server-side REST plus direct opaque S3 URLs.
- Not included: public signup, automatic Cognito user creation, permanent test credentials, or committed browser storage state.
- Not included: changing project, file, usage, error, pricing, rate-limit, retention, or public URL contracts solely for test convenience.
- Not included: automatic retry of the state-mutating deployed journey. A retry can duplicate projects, credentials, usage, and CloudTrail evidence.
- Not included: automatic deletion of projects. No project-delete contract exists; authorized live runs must use an isolated stage or explicitly accept retained project records.
- Not included: production deployment support or weakening `production`-only observability. The current wrapper rejects production deploy/dev, and non-production stages intentionally create no alert topic/alarms.
- Not included: automatically enabling non-zero download pricing. A passing RUS-08 matrix only makes a separate reviewed `priced` source/deployment change eligible.
- Not included: treating a local mock, Playwright request timing, or one operator run as the two-user/three-day product experiment.
- Not included: dedicated SDKs, browser upload, multipart upload, mutable visibility, folders/rename/versioning, CloudFront file delivery, or any other deferred epic feature.

## Feature Metadata

**Feature Type**: New Capability / Release Verification

**Estimated Complexity**: High

**Primary Systems Affected**: Playwright/browser test layer, acceptance tooling, dashboard authentication/control journey, project credential lifecycle, File Management REST/direct-transfer lifecycle, usage freshness presentation, error/redaction boundaries, release documentation

**Dependencies**: Node 24.x, npm 11.x, TypeScript 6, Vitest 4, React 19/Vite 8, SST 4, AWS/Cognito/API Gateway/S3/DynamoDB/CloudTrail deployed by the existing app, standalone `@playwright/test`, local Chromium browser, two invited owner accounts, and an explicitly authorized isolated non-production stage

## Related Work

**Implements**: [GitHub issue #11 / RUS-11](https://github.com/noamtz/utility-services/issues/11) · **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) · **Architecture**: [Reusable Utility Services Architecture](https://github.com/noamtz/utility-services/wiki/Architecture) · **Ticket graph**: [MVP Ticket Breakdown](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown)

Native readiness was verified on 2026-08-26: blockers [RUS-09](https://github.com/noamtz/utility-services/issues/9) and [RUS-10](https://github.com/noamtz/utility-services/issues/10) are closed; issue #11 is open and in `Todo`. `main` and `origin/main` were aligned at `da7a682`.

**Back-references**:

- `.agents/plans/rus-03-project-credential-lifecycle-authentication.md` - One-time key reveal, owner isolation, replacement/revocation, and uniform project-auth denial.
- `.agents/plans/rus-05-direct-upload-file-metadata-lifecycle.md` - Direct PUT, pending-to-ready completion, quota, and server-generated identity.
- `.agents/plans/rus-06-private-download-stable-public-access.md` - Private authorization, stable public redirects, opaque URLs, and log safety.
- `.agents/plans/rus-07-trash-restore-scheduled-purge-force-deletion.md` - Recoverable deletion, identity-preserving restore, idempotent purge, and physical-removal ordering.
- `.agents/plans/rus-08-download-metering-reconciliation-pricing-gate.md` - Exact live transfer matrix, evidence-only default, replay/redrive safeguards, and pricing decision rule.
- `.agents/plans/rus-09-dashboard-five-minute-integration-experience.md` - Dashboard provisioning, canonical curl guide, one-time secret handling, and the explicit forward hand-off of assembled proof to RUS-11.
- `.agents/plans/rus-10-service-protection-production-observability.md` - Project rate limiting/suspension, redaction, async failure signals, production alarms, and the unfulfilled alert-destination hand-off.
- `.agents/reports/rus-08-download-metering-reconciliation-pricing-gate-report.md` - The deployed transfer matrix and gate flip were intentionally not executed.
- `.agents/reports/rus-09-dashboard-five-minute-integration-experience-report.md` - Live sign-in/key/S3 proof remained separately authorized; dashboard race/secret regressions to preserve.
- `.agents/reports/rus-10-service-protection-production-observability-report.md` - No deploy, operator apply, backfill, or alert subscription was performed.

**Forward-references**:

- A separate reviewed pricing-mode change/deployment is required if and only if the RUS-08 decision is `pass`.
- Broader-market access, production deployment operations, and post-MVP product decisions remain follow-up work driven by the two-user experiment.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` (project source-of-truth, AWS continuity, external mutation, release blockers, and validation sections) - Re-read the active instruction chain before any work or external action.
- `package.json` (lines 1-53) - Node/npm pins, workspace shape, exact dependency pinning, and current local/AWS scripts.
- `package-lock.json` - Must be updated only through npm when adding Playwright.
- `vitest.config.ts` (lines 4-50) - Two current Vitest projects and global 80% V8 thresholds; Playwright specs must not be accidentally collected by Vitest.
- `tsconfig.base.json` (lines 2-20) and `tsconfig.json` (lines 2-16) - Strict TypeScript and current root includes; add `playwright.config.ts` explicitly.
- `.gitignore` (lines 1-29) - Add Playwright results/auth/artifact paths because browser state and traces can contain credentials.
- `README.md` (lines 18-29, 52-112, 114-196, 202-216) - Current test taxonomy, stage wrapper rules, operational controls, download acceptance command, and dashboard integration boundary.
- `sst.config.ts` (lines 20-109) - Composition order and safe stage outputs needed by an authorized live run.
- `infra/config/control.ts` (lines 10-20, 34-94) - Admin-create-only Cognito policy, seven owner routes, and authenticated CloudFront forwarding.
- `infra/api.ts` (lines 6-14, 31-141) - CORS-disabled HTTP API, Cognito JWT authority for control routes, and project-key file routes.
- `infra/dashboard.ts` (lines 23-87) - Deployed dashboard/API origin wiring; Playwright must target the dashboard origin and let `/v1/control/*` flow through CloudFront.
- `apps/dashboard/src/App.tsx` (lines 11-75) - Injectable API seams, auth gate, and dashboard composition.
- `apps/dashboard/src/auth/auth-client.ts` (lines 14-22, 64-101), `AuthProvider.tsx` (lines 19-75), and `SignInForm.tsx` (lines 20-64) - Real Amplify invited-owner and `NEW_PASSWORD_REQUIRED` flow.
- `apps/dashboard/src/api/control-client.ts` (lines 20-62) - Fresh Cognito access token, strict envelope parsing, and 401 sign-out behavior.
- `apps/dashboard/src/projects/ProjectView.tsx` (lines 36-137) - Project create/list/select/inspect journey and request-race protection.
- `apps/dashboard/src/credentials/ApiKeyPanel.tsx` (lines 38-50, 52-141, 164-183) - One-time reveal, replacement/revocation, confirmations, and stale-project suppression.
- `apps/dashboard/src/usage/UsagePanel.tsx` (lines 16-103) - Current month request, AWS-equivalent wording, freshness/stale/incomplete presentation.
- `apps/dashboard/src/integration/IntegrationGuide.tsx` (lines 12-57, 64-96) - Canonical copyable server-side curl path and server-secret/opaque-URL warnings. Reuse and verify it; do not create a divergent guide.
- `packages/backend/src/core/http/handler.ts` (lines 127-197, 216-287) and `core/observability/redact.ts` (lines 57-103) - Shared public error envelope and redacted structured logging boundary.
- `packages/backend/src/modules/project-authentication/service.ts` (lines 44-99), `authorization.ts` (lines 4-12), and `rate-limit/service.ts` (lines 15-25) - Trusted context, generic 401, suspension, and post-auth 429 behavior.
- `packages/backend/src/modules/file-management/service.ts` (lines 76-142), `completion.ts` (lines 109-204, 239-262), `downloads.ts` (lines 55-93), and `lifecycle.ts` (lines 69-163) - Upload/quota, completion, private/public authorization, and lifecycle/purge orchestration.
- `packages/backend/src/modules/usage-pricing/cloudtrail-log.ts` (lines 184-230, 266-380), `download-metering.ts` (lines 72-145), and `metering-worker.ts` (lines 22-88) - Exact accepted/quarantined evidence, replay, and safe worker summaries.
- `tests/integration/owner-project-control.test.ts` (lines 116-242) - Owner claims, project isolation, validated envelopes, and safe errors.
- `tests/integration/project-credential-authentication.test.ts` (lines 346-506) - One-time key, replace/revoke, two-owner isolation, uniform auth failure, and log-secret assertions.
- `tests/integration/direct-upload-file-lifecycle.test.ts` (lines 477-646, 649-876) - Assembled bearer/upload/completion/list/download/public path, quota concurrency, isolation, and redaction.
- `tests/integration/file-trash-lifecycle.test.ts` (lines 274-407) - Trash/restore/force/purge, retained quota, failure ordering, and foreign-project denial.
- `tests/integration/service-protection.test.ts` (lines 72-229) - Shared 60-request project limit, rollover/concurrency, suspension/resume, and public-route separation.
- `tests/integration/download-metering.test.ts` (lines 339-451) - Evidence-only promotion, deduplication, quarantine, replay/rebuild, retry/DLQ, and project attribution.
- `tests/integration/usage-pricing-ledger.test.ts` (lines 207-317) and `tests/integration/owner-usage-view.test.ts` (lines 55-74) - Incomplete/stale projection semantics, safe public shape, and owner-only usage.
- `apps/dashboard/src/App.test.tsx` (lines 9-47), `projects/ProjectExperience.test.tsx` (lines 20-63), `credentials/ApiKeyPanel.test.tsx` (lines 33-156), and `usage/UsagePanel.test.tsx` (lines 42-129) - Current jsdom owner-journey, one-time-secret, stale-request, and freshness patterns.
- `tooling/acceptance/download-metering.mjs` (lines 20-149, 184-240, 356-433) and `.test.ts` (lines 42-188, 192-287) - Mandatory dry-run/identity/redaction/explicit-execution pattern and the existing live RUS-08 matrix.
- `tooling/run-sst.mjs` (lines 10-42, 62-80) and `tooling/aws-access.mjs` (lines 1-21, 29-70) - Exact stage and AWS identity protections; reuse the fixed constants rather than introducing alternate profiles.
- `infra/observability.ts` (lines 19-122), `infra/observability.test.ts` (lines 12-103), and `sst.config.ts` (lines 107-108) - Production-only alarms/topic and the explicit missing-subscription signal.

### New Files to Create

- `playwright.config.ts` - Standalone, serial, zero-retry, deployed-stage Chromium configuration with safe artifact policy and a list-only/no-network mode.
- `tests/e2e/support/release-config.ts` - Strict environment/URL/confirmation validation shared by config and spec; no secret values in errors or serializable results.
- `tests/e2e/support/owner-journey.ts` - Browser helpers for invite sign-in/new-password challenge, project creation/selection, one-time key capture in memory, and secret clearing.
- `tests/e2e/support/file-journey.ts` - API/direct-transfer helpers that validate shared envelopes, treat transfer URLs as opaque, poll bounded eventual consistency, and never attach secrets/URLs to Playwright steps or errors.
- `tests/e2e/activation.spec.ts` - One serial two-owner deployed journey covering AC1, AC2, the live-safe portion of AC3/AC4, and five-minute timing.
- `tooling/acceptance/release-readiness.mjs` - Dry-run-by-default gate, exact AWS identity preflight, local Playwright launcher, redacted evidence summary, and no implicit cleanup/retry.
- `tooling/acceptance/release-readiness.test.ts` - Parse/refusal/identity/secret/artifact/spawn/result-classification tests with mocked process execution and no network.

Do not create a local product-experiment or architecture evidence document. Stable experiment outcomes belong on the canonical Product Requirements Wiki page; execution status/evidence can be summarized on issue #11 after explicit GitHub-write authorization.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Canonical Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic)
  - Specific sections: Hypothesis, MVP, Success Metrics, Non-goals, Open Questions.
  - Why: Defines the two-user/three-day and five-minute falsifiable product experiment.
- [Canonical Architecture](https://github.com/noamtz/utility-services/wiki/Architecture#spikes--experiments)
  - Specific sections: First principles, Authentication and authorization, File contracts, Presigned transfers, Usage reliability, Security guardrails, API instructions, Spikes & experiments.
  - Why: Defines every release-blocking boundary and the exact CloudTrail pricing gate.
- [Playwright Test projects](https://playwright.dev/docs/test-projects#configure-projects-for-multiple-environments)
  - Specific section: per-environment `baseURL`, retries, and project options.
  - Why: Keeps the authorized deployed target explicit and separate from local Vitest.
- [Playwright Test configuration: `baseURL`](https://playwright.dev/docs/api/class-testoptions#test-options-base-url)
  - Why: The spec must resolve dashboard paths only against the owner-approved HTTPS stage.
- [Playwright authentication](https://playwright.dev/docs/auth#introduction)
  - Specific sections: sensitive storage state, state-mutating tests, and multiple roles.
  - Why: This journey uses two independent owners and must not persist impersonation material.
- [Playwright environment parameters](https://playwright.dev/docs/test-parameterize#passing-environment-variables)
  - Why: Owner identifiers/passwords enter only through local/CI secret environment variables.
- [Playwright retries](https://playwright.dev/docs/test-retries)
  - Why: Retry-pass is classified as flaky, and this state-creating journey must use zero retries.
- [Playwright traces and artifacts](https://playwright.dev/docs/api/class-testoptions#test-options-trace)
  - Why: Trace/screenshot/video can capture the one-time key and signed URLs; disable them for this project and retain only the custom redacted summary.
- [Playwright API testing](https://playwright.dev/docs/api-testing)
  - Why: After UI issuance, use an isolated request context to exercise server-side REST and direct opaque transfers without putting the key in browser code.
- [Amazon Cognito admin-created users](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html)
  - Specific section: temporary passwords and `NEW_PASSWORD_REQUIRED`.
  - Why: The real journey must accept either first-login challenge or already-confirmed invited accounts without creating users itself.
- [curl manual](https://curl.se/docs/manpage.html)
  - Specific options: `--fail-with-body`, `--write-out`, `time_total`, and redirect behavior.
  - Why: Validate the rendered canonical walkthrough and use safe timing output during the observed human activation run.

### Patterns to Follow

**Naming and organization:**

- Keep deployed browser specs under `tests/e2e/**/*.spec.ts`; existing Vitest includes only `tests/**/*.test.ts`, preventing runner collision.
- Keep reusable Playwright helpers in `tests/e2e/support`, acceptance launch policy under `tooling/acceptance`, and production/domain logic in its existing bounded context.
- Use `createX` dependency injection and deterministic clocks/IDs in Vitest, matching existing services and integration suites.

**Dry-run and external-action guard:**

Mirror `tooling/acceptance/download-metering.mjs:84-111`: parse all arguments first, forbid `production`/`default`/`main`, require HTTPS, and return a redacted `decision: "not-run"` plan without spawning AWS, Playwright, or network work. `--execute` must additionally require an exact stage-bound confirmation and all secret env names. The Playwright spec repeats the marker check to prevent direct invocation.

**AWS identity and process spawning:**

Reuse the exact profile `ntz-cli`, region `il-central-1`, CA bundle, account, and full principal from `tooling/aws-access.mjs`. Launch `aws` and the local `node_modules/.bin/playwright` with `execFile`/`spawn`, `windowsHide: true`, `shell: false`, and a sanitized environment. Never fall back to `default`, invoke `npx` in a way that can download an unpinned package, or put a credential in argv.

**Two-owner browser isolation:**

Use two independent `BrowserContext`s inside one serial test. Do not write `storageState`; Cognito browser state may contain tokens. Each owner signs in through the rendered form. Handle `NEW_PASSWORD_REQUIRED` only when presented. Keep the one-time project key in a closure/in-memory request context, dismiss it promptly, and verify it does not reappear after navigation/project switching.

**Server-side transfer boundary:**

The Playwright page exercises dashboard/control only. File requests use a separate API request context with `Authorization: Bearer <key>`; the browser page never receives that bearer. Extract signed transfer URLs only into local variables, never test titles, annotations, attachments, reporters, console logs, error strings, snapshots, or persisted files.

**Safe errors and redaction:**

For every expected 4xx/5xx, parse the shared envelope and assert only public `error.code`, `error.message`, and `requestId`. Scan bodies and captured logs for AWS account details, bucket/object keys, internal IDs, API key/token fragments, stack traces, `X-Amz-*`, and URL queries. Do not fail by interpolating a raw response or URL.

**Evidence:**

Emit only case names, pass/fail, sanitized stage label, elapsed seconds, public HTTP status/code, aggregate counts, and timestamps. No HTML report, trace, screenshot, video, storage state, raw request/response, one-time secret, token, full URL, file content, bucket/log key, internal ID, or raw CloudTrail evidence. `line`/custom redacted reporting is preferred over Playwright HTML output.

**Existing behavior is the oracle:**

- Dashboard control is same-origin through CloudFront; do not enable API CORS or direct dashboard-to-API calls to make the test pass.
- The stable public route may return a successful 302 with an opaque `Location`; errors must never contain that header.
- Revocation/replacement stops new authorizations but does not revoke a previously issued presigned URL; expiry bounds the residual capability.
- Evidence-only download metering can truthfully remain `not-yet-metered`; do not fake a priced watermark.
- Project deletion does not exist. Use unique disposable names and an isolated stage; force-delete files and revoke keys, then report unavoidable project residue.

---

## IMPLEMENTATION PLAN

### Phase 1: Safe Browser-Test Foundation

Add the pinned Playwright dependency, isolated config, ignored artifact paths, strict release configuration, and the dry-run acceptance launcher. Establish safety invariants before any test can target a deployed stage.

### Phase 2: Close Local Release-Matrix Gaps

Extend the owning Vitest suites for the exact cross-boundary assertions not already present: the complete two-owner denial matrix, expiry contract, purge retry/no-double-close, quota/rate boundaries, quarantine/replay/stale presentation, and uniform public error/redaction scan. Preserve existing domain architecture and avoid a duplicate mega-fixture.

**Independent of:** Phase 3 helper implementation after Phase 1; both must finish before Phase 4 validation.

### Phase 3: Automated Deployed Activation Journey

Build the serial two-owner Playwright spec and helpers. Use the real dashboard for Cognito/project/key operations, then server-side request contexts and direct transfer URLs for files. Measure from successful key issuance to the first completed upload and download and require less than 300 seconds.

### Phase 4: Release Procedure and Local Validation

Document the release matrix, secret handling, non-production stage requirements, evidence classification, cleanup/residue, and the human experiment. Run focused tests, list-only/dry-run browser checks, full quality gates, static leak review, and Codex-layer validation.

### Phase 5: Authorized Non-Production Proof

**Depends on:** Phases 1-4, two owner-provided invited accounts, an owner-selected isolated stage, a fresh clean diff, explicit deploy/data-mutation authorization, and no concurrent stage use.

Deploy the reviewed code to that stage, run the guarded two-owner journey once, run the existing RUS-08 transfer matrix with disposable files, inspect replay/queue/DLQ/freshness evidence, and record a pass/fail release summary. Do not automatically retry, redrive, flip pricing, or update GitHub/Wiki.

### Phase 6: Alert Delivery and Product Experiment

**Depends on:** a separately approved production deployment path and alert recipient for alarm delivery; two actual invited users; explicit AWS/GitHub write authorization.

Attach and verify the approved alert destination only in the real production alarm topology, then conduct the two-user/three-day observed experiment. Record activation time, trust failures, attribution usefulness, repeated work avoided, and product decisions on the canonical Product Requirements Wiki and issue #11. Local implementation can complete while this phase remains externally pending; RUS-11 itself cannot be called fully complete until the owner resolves and executes these gates.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute Tasks 1-8 in order for local implementation. Tasks 9-11 are external execution phases and require their stated authorization at the time; implementation authorization does not imply it.

### 1. UPDATE `package.json`, `package-lock.json`, `.gitignore`, and `tsconfig.json`; CREATE `playwright.config.ts`

- **IMPLEMENT**: add exact `@playwright/test` through npm (recheck current stable; plan-time version `1.62.1`, Node `>=20`); add `acceptance:release` and a no-network `test:e2e:list` script; include `playwright.config.ts` in root TypeScript; ignore Playwright auth, output, report, trace, screenshot, and video paths.
- **IMPLEMENT**: configure only one `authorized-deployed` Chromium project for now; `testDir: tests/e2e`, `testMatch: **/*.spec.ts`, one worker, serial execution, zero retries, bounded test/expect/global timeouts, no `webServer`, no automatic artifact capture, and a terse reporter.
- **PATTERN**: exact dependency pins and scripts in `package.json:15-53`; strict TS in `tsconfig.base.json:2-20`; Vitest runner separation in `vitest.config.ts:4-28`.
- **GOTCHA**: `npm run check` must remain local/no-network and must not execute deployed Playwright. `playwright test --list` may load config but cannot require secrets or contact a target. Do not add a localhost server that could masquerade as deployed proof.
- **VALIDATE**: `npm install --save-dev --save-exact @playwright/test@1.62.1 && npm run typecheck && npm run test:e2e:list`
- **SATISFIES**: AC1, AC7.

### 2. CREATE `tests/e2e/support/release-config.ts`, `tooling/acceptance/release-readiness.mjs`, and `tooling/acceptance/release-readiness.test.ts`

- **IMPLEMENT**: strict parse/validation for explicit stage, HTTPS dashboard/API URLs, `--execute`, exact `--confirm-stage <stage>`, bounded completion/expiry timeouts, and optional safe run label. Forbid `production`, `default`, `main`, unexpected positional args, and unknown flags.
- **IMPLEMENT**: require two distinct owner emails/passwords only in execute mode through documented environment variable names; support optional first-login permanent-password values. Validate presence/distinctness without including values in error messages or results.
- **IMPLEMENT**: return a no-network dry-run plan by default; on execute, perform exact AWS identity preflight, sanitize inherited environment, set only validated non-secret target values plus secret env pass-through, and spawn the repository-local Playwright binary without a shell or retry.
- **IMPLEMENT**: accept exactly one bounded `RUS_RELEASE_RESULT:<json>` sentinel from the child process, validate its strict safe schema, and classify it into pass/fail, case counts, activation seconds, stage, run timestamp, unavoidable residue flag, and external gates still pending. Do not forward arbitrary child stdout/stderr. The spec must also reject a missing/mismatched execution marker.
- **PATTERN**: `tooling/acceptance/download-metering.mjs:34-149` and `.test.ts:42-188`.
- **TEST**: dry run invokes no process/network; no default stage; invalid/prod stage; non-HTTPS origins; missing/mismatched confirmation; missing/same owners; wrong AWS identity; exact fixed environment; local binary/no shell; child failure; timeout; result parsing; zero secret/URL-query leakage in errors, calls, and summaries.
- **GOTCHA**: do not accept passwords/tokens/keys on argv, write environment dumps, or enable Playwright HTML/blob reports. Do not implement cleanup for project records because the product has no project-delete operation.
- **VALIDATE**: `npm test -- --project node tooling/acceptance/release-readiness.test.ts && npm run acceptance:release -- --stage dev-rus11-e2e --dashboard-url https://dashboard.example.invalid --api-url https://api.example.invalid`
- **SATISFIES**: AC1, AC2, AC4, AC5, AC7.

### 3. UPDATE owning local suites for the release matrix

- **UPDATE**: `tests/integration/owner-project-control.test.ts`, `project-credential-authentication.test.ts`, `direct-upload-file-lifecycle.test.ts`, `file-trash-lifecycle.test.ts`, `service-protection.test.ts`, `download-metering.test.ts`, `usage-pricing-ledger.test.ts`, and the narrow dashboard tests only where a listed AC is not already explicit.
- **PROVE**: owner A/B cannot inspect or mutate each other's projects/keys/files/usage; key A cannot use file B; guessed file/public project/public file IDs fail; private files never redirect publicly; wrong-owner resources remain indistinguishable from missing.
- **PROVE**: replaced/revoked keys cannot authorize new requests; generated URL expiry/fresh re-authorization contract; 100 MB file and 5 GB retained quota boundaries (including concurrent last-slot reservation); 60/project/min across keys and project isolation; no browser/public route charging against private quota.
- **PROVE**: duplicate upload/CloudTrail delivery does not duplicate state/cost; force/purge failure injected at each ordering boundary retries without double close/removal; quarantine never charges and marks incomplete; exact replay rebuilds without duplication; UI renders `not-yet-metered`, `stale`, and `incomplete` honestly.
- **PROVE**: table-drive every expected error response through the shared envelope and assert bodies/logs exclude account/ARN, bucket, object key/prefix, internal ID, credential/token fragments, stack, raw exception, full presigned URL, and `X-Amz-*` query material.
- **PATTERN**: extend the exact assertions at `direct-upload-file-lifecycle.test.ts:477-876`, `file-trash-lifecycle.test.ts:274-407`, `service-protection.test.ts:72-229`, and `download-metering.test.ts:339-451`; do not copy their in-memory repositories into a new parallel architecture.
- **GOTCHA**: locally generated expiry timestamps do not prove S3 rejects a live expired signature; mark that portion for Task 9. Evidence-only is a valid state, not a test failure.
- **VALIDATE**: `npm test -- --project node tests/integration/owner-project-control.test.ts tests/integration/project-credential-authentication.test.ts tests/integration/direct-upload-file-lifecycle.test.ts tests/integration/file-trash-lifecycle.test.ts tests/integration/service-protection.test.ts tests/integration/owner-usage-view.test.ts tests/integration/usage-pricing-ledger.test.ts tests/integration/download-metering.test.ts`
- **SATISFIES**: AC2, AC3, AC4.

### 4. UPDATE dashboard journey and curl-guide tests

- **UPDATE**: `apps/dashboard/src/App.test.tsx`, `projects/ProjectExperience.test.tsx`, `credentials/ApiKeyPanel.test.tsx`, `usage/UsagePanel.test.tsx`, and `integration/IntegrationGuide.test.tsx` only for missing assembled UI states.
- **PROVE**: invited sign-in and new-password flow enters project control; project create/select loads keys and usage; issue secret is revealed once then cleared; replacement/revocation confirmations are explicit; project switching cannot surface stale secret/key/usage/inspect results; 401 signs out; usage refresh recovers from error and renders incomplete/stale/not-yet states.
- **PROVE**: every canonical curl block is copyable, uses `/v1`, `--fail-with-body`, placeholder environment variables, exact required upload headers, opaque transfer URLs, guarded force delete, and no real credential/bucket/key. Assert server-side-secret and expiry wording.
- **GOTCHA**: do not add dashboard file actions or browser fetches to S3. The UI's role is provisioning, usage, and instructions; the deployed spec performs file calls in a server-side request context.
- **VALIDATE**: `npm test -- --project dashboard apps/dashboard/src/App.test.tsx apps/dashboard/src/projects/ProjectExperience.test.tsx apps/dashboard/src/credentials/ApiKeyPanel.test.tsx apps/dashboard/src/usage/UsagePanel.test.tsx apps/dashboard/src/integration/IntegrationGuide.test.tsx`
- **SATISFIES**: AC1, AC3, AC4, AC5.

### 5. CREATE `tests/e2e/support/owner-journey.ts` and `tests/e2e/support/file-journey.ts`

- **IMPLEMENT**: accessible role/label locators for sign-in, optional new-password challenge, project creation with 1-minute upload/download lifetimes for disposable testing, project selection, key issue/replace/revoke, one-time key in-memory handoff, usage refresh, and sign-out.
- **IMPLEMENT**: strict schemas/helpers for public envelopes; upload authorization; direct PUT using exact returned required headers; bounded polling from pending to ready; list/inspect; private GET; stable public 302 without logging `Location`; trash/restore/force delete; safe expected-error assertions; activation stopwatch.
- **IMPLEMENT**: unique run-scoped project/file names without secrets; `try/finally` closes request/browser contexts, force-deletes files where still legal, and revokes active keys. Report but do not conceal project records or failed cleanup.
- **PATTERN**: public contract schemas in `packages/contracts/src/index.ts:1-146`, integration guide at `IntegrationGuide.tsx:12-57`, and existing download-metering redaction at `tooling/acceptance/download-metering.mjs:143-149`.
- **GOTCHA**: helpers must never interpolate bearer values, signed URLs, response bodies, or file bytes into `test.step`, expect messages, attachments, console output, or thrown errors. Do not follow a public redirect while asserting the service response; use a separate opaque transfer request afterward if needed.
- **VALIDATE**: `npm run typecheck && npm run test:e2e:list`
- **SATISFIES**: AC1, AC2, AC4, AC5.

### 6. CREATE `tests/e2e/activation.spec.ts`

- **IMPLEMENT**: one serial test (or one serial describe with strictly ordered, non-retriable steps) creates two browser contexts, signs in two distinct invited owners, creates one project each, issues keys through the dashboard, and immediately dismisses secret UI.
- **IMPLEMENT**: start activation timing when owner A's key becomes available; authorize/upload disposable private and public files, poll ready, list/inspect, authorize and complete the first private download, stop timing, and require `elapsedSeconds < 300`.
- **IMPLEMENT**: exercise owner B independently and assert the cross-owner/project matrix at every applicable control/private/public boundary; test guessed identifiers and private-through-public denial without signer/redirect leakage.
- **IMPLEMENT**: prove stable public success, trash denial, same-identity restore, explicit force delete, old-key failure after replace/revoke, fresh URL issuance, and real expiry rejection using the configured one-minute lifetime and a bounded wait. Assert an already-issued URL's residual validity only according to the documented contract.
- **IMPLEMENT**: refresh the dashboard usage panel and verify correct project attribution plus truthful freshness (`fresh`, `stale`, `incomplete`, or evidence-only `not-yet-metered` as returned); do not require immediate priced download cost.
- **IMPLEMENT**: emit exactly one bounded `RUS_RELEASE_RESULT:<json>` sentinel containing only the safe case-status object expected by the launcher. All expected external errors must match the shared envelope and leak scan. Disable traces/screenshots/video for the entire secret-bearing run.
- **GOTCHA**: do not use multiple Playwright workers, storage-state files, retries, shared project names, or an automatic rerun. A failure after mutation is evidence requiring operator review, not permission to repeat.
- **VALIDATE**: `npm run test:e2e:list` (local); actual execution is Task 9 only.
- **SATISFIES**: AC1, AC2, the live-safe parts of AC3/AC4, AC5.

### 7. UPDATE `README.md` and validation configuration

- **DOCUMENT**: `tests/e2e` is now the opt-in deployed browser journey; exact prerequisites and env variable names (never values); Playwright Chromium install; dry-run/list commands; isolated-stage recommendation; explicit mutation confirmation; zero-retry/artifact policy; residual project records; cleanup boundaries; result schema; and the distinction among local, deployed, CloudTrail, alert, and human evidence.
- **DOCUMENT**: keep the existing rendered curl guide canonical; add an observed timing procedure using curl `--write-out` without showing real keys or signed URLs; state that the five-minute clock begins at key availability and ends after first completed upload and download.
- **DOCUMENT**: keep download pricing `evidence-only` until the RUS-08 matrix passes and a separate reviewed change is deployed; list alert subscription and Wiki experiment update as separately authorized pending gates.
- **UPDATE**: add `tooling/acceptance/release-readiness.mjs` to V8 coverage if practical and drive its branches above threshold; otherwise explicitly justify the same tested-executable exception already used by the RUS-08 harness. Do not reduce the 80% gates.
- **GOTCHA**: README may document operational procedure but must not become a local copy of the PRD/Architecture or contain user emails, passwords, project keys, signed URLs, stage output dumps, or raw evidence.
- **VALIDATE**: `npm run format:check && npm run lint && npm run typecheck && npm test -- --project node tooling/acceptance/release-readiness.test.ts && npm test -- --project dashboard apps/dashboard/src/integration/IntegrationGuide.test.tsx`
- **SATISFIES**: AC4, AC5, AC6, AC7, AC8.

### 8. RUN local release validation and review the diff

- **RUN**: all commands in Validation Commands Levels 1-5. Fix each failure and rerun the exact failing command before advancing.
- **REVIEW**: verify only test/tooling/documentation/dependency files changed unless a failing release assertion exposed a real production defect; any production fix needs focused regression tests and an amendment explaining the scope change.
- **REVIEW**: perform the static secret/URL/IAM scan and inspect generated reports/artifact directories before commit. Remove only newly generated ignored test artifacts, never user data or broad directories.
- **GOTCHA**: do not run `infra:diff`, deploy, create users/keys/files, execute Playwright, run the CloudTrail harness, apply operators, subscribe alarms, or write GitHub/Wiki in this local task.
- **VALIDATE**: `npm run check && python tooling/validate_codex_layer.py && uv run --script tooling/mcp/codebase_search.py --self-test && git diff --check`
- **SATISFIES**: AC7 and all local portions of AC1-AC5.

### 9. EXECUTE the authorized isolated-stage activation proof

- **PREREQUISITES**: owner selects an explicit non-production stage (recommended `dev-rus11-e2e` because the suite is destructive and leaves projects; use `dev-rus02` only after explicit shared-state inspection/approval); two invited owner accounts exist and credentials are loaded from a local secret source; stage is not in concurrent use; explicit diff/deploy/data-mutation authorization is current.
- **RUN**: exact AWS identity preflight; `npm run infra:install -- --stage <stage>` if provider artifacts need regeneration; fresh `npm run infra:diff -- --stage <stage>`; inspect replacements/IAM/retention/outputs; after explicit deploy approval, `npm run infra:deploy -- --stage <same-stage>`.
- **RUN**: install the pinned Chromium binary locally, dry-run `acceptance:release`, then execute it once with exact stage/origins/confirmation. Observe and retain only the redacted summary; inspect unexpected residue/failure before any rerun.
- **VERIFY**: two-owner journey, cross-boundary denial matrix, live URL expiry, measured activation under five minutes, safe errors, no secret artifacts, file cleanup/key revocation, and honest usage freshness.
- **GOTCHA**: deployment approval does not authorize a second run, user creation/password reset, manual data deletion, or external evidence publication. A first-login password challenge mutates the owner account and must be expected/authorized.
- **VALIDATE**: `npm run acceptance:release -- --stage <stage> --dashboard-url <https-dashboard-origin> --api-url <https-api-origin> --execute --confirm-stage <stage>` with secrets supplied only via environment.
- **SATISFIES**: AC1, AC2, live portions of AC3/AC4, AC5.

### 10. EXECUTE the authorized RUS-08 transfer/pricing-gate and operational proof

- **RUN**: use disposable ready files from the authorized stage and the existing `acceptance:download-metering` harness for full, range, cancelled, repeated, expired/failed, and unused URLs; verify exact retained logs, attribution, bytes, deduplication, quarantine, replay/rebuild, queue/DLQ health, and freshness.
- **RUN**: exercise suspension/rate-limit/backlog/failure behavior only through existing guarded tooling and only with separate mutation/redrive authorization. Verify production policy synthesis locally; do not claim live alert delivery from a non-production stage.
- **DECIDE**: record `pass`/`remain-evidence-only` and supporting safe counts. A pass means only `eligible-for-separate-reviewed-priced-deploy`; it never changes source/config automatically.
- **GOTCHA**: redrive, pricing-mode change, backfill apply, and SNS subscription are separate mutations. Never infer authorization from the release run.
- **VALIDATE**: `npm run acceptance:download-metering -- --stage <stage> --api-url <https-api-origin> --file-id <disposable-file-id> --log-bucket <safe-output> --processor-function <safe-output> --main-queue-url <safe-output> --dlq-url <safe-output> --execute` with project key supplied only through `DOWNLOAD_METERING_PROJECT_KEY`.
- **SATISFIES**: AC3, AC4, AC6.

### 11. CONDUCT the alert-delivery gate and two-user/three-day product experiment

- **RESOLVE FIRST**: owner chooses/authorizes a production deployment path and alert recipient. Current tooling rejects production deploy/dev and current non-production topology intentionally creates no alarms/topic, so alert-delivery verification cannot be executed or truthfully claimed yet.
- **VERIFY**: after authorized production provisioning, attach and confirm the approved SNS destination; generate bounded safe signals for authentication failure, throttling, Lambda error, async backlog, metering quarantine/failure, stale watermark, and unexpected request rate. Record delivery timestamps without sensitive payloads.
- **OBSERVE**: two real invited users connect one real project each within three days using the dashboard's rendered curl guide and disposable files. Time key availability to first successful upload/download with a monotonic timer/curl `time_total`; observe public/private trust, attribution usefulness, repeated work avoided, and need for human help/project-specific infrastructure.
- **RECORD**: after explicit GitHub-write authorization and verified `noamtz` identity, update the canonical Product Requirements Wiki hypothesis/success-metric/open-question outcomes and add a concise evidence/status summary to issue #11. Link the pricing-gate decision and validation result; do not include credentials, signed URLs, internal identifiers, or raw logs.
- **GOTCHA**: test automation cannot substitute for the two humans or falsify the hypothesis on their behalf. If either user misses the target or distrusts access/attribution, record that as a product result rather than changing the metric after the fact.
- **VALIDATE**: owner review of the Wiki diff and issue summary before publication; verify GitHub identity is exactly `noamtz` immediately before each write.
- **SATISFIES**: AC7, AC8 and the inherited RUS-10 alert-delivery hand-off.

---

## TESTING STRATEGY

### Unit and Component Tests

- Release-config and launcher parsing, no-network dry-run, fixed identity, environment sanitization, no-shell local Playwright spawn, timeout/failure classification, and redacted summary.
- Dashboard invited-auth, project/key/usage composition, one-time-secret clearing, stale request isolation, 401 sign-out, freshness states, and curl-guide safety.
- No new production helper is added without direct unit coverage at its owning boundary.

### Integration Tests

- Preserve the current in-memory taxonomy and extend only missing cross-boundary assertions in owner/project, credential/auth, direct upload/download, lifecycle, protection, usage, and metering suites.
- Treat these tests as deterministic proof for quota races, 60-request windows, injected purge failures, duplicate asynchronous delivery, quarantine/replay, and stale/incomplete projection—cases that should not be induced casually in a live shared environment.
- Maintain two-owner/two-project fixtures and table-driven public error/leak assertions across all relevant handlers.

### Deployed End-to-End Test

- Standalone Playwright, not Vitest Browser Mode: one explicit deployed environment, Chromium, serial/one worker, zero retry, bounded timeouts, no persisted auth or artifact capture.
- Dashboard/Cognito/control operations occur through the real browser/CloudFront path. File operations occur through an isolated server-side request context and opaque direct S3 URLs.
- One run covers both owners so cross-boundary attempts share one controlled evidence window and no parallel state race is introduced by the runner.

### Human Experiment

- Two distinct people, two real projects, three-day window, disposable files, rendered curl guide, measured five-minute target, and qualitative observation against every PRD success metric.
- Record failures and ambiguity exactly; do not reinterpret local or automated success as user success.

### Edge Cases

- First invited login requiring a new password versus an already-confirmed owner.
- Owner credentials accidentally identical; wrong owner sees indistinguishable 404/401 rather than existence leakage.
- Stale project/key/usage requests completing after project switch; one-time secret after dismiss/switch/reload.
- Declared size `0`, `100 MB`, and `100 MB + 1`; concurrent final quota slot; trash still counting; physical removal releasing quota.
- 60th versus 61st request, multiple keys sharing one project window, next-window rollover, concurrent admissions, other project unaffected.
- Pending/failed/trashed/purged/private/wrong-pair public access; no redirect/signing on denial.
- Existing presigned URL after key revoke/suspension and after bounded expiry; fresh authorization denied correctly.
- Duplicate/out-of-order S3 and CloudTrail delivery; failure between object removal, usage close, and metadata finalize; repeated purge/replay.
- Missing/malformed/failed/ambiguous CloudTrail evidence; quarantine plus incomplete watermark; later valid evidence does not hide incompleteness.
- Usage not-yet/fresh/stale/incomplete and delayed eventual consistency without implying invoice accuracy or priced downloads.
- Browser/test runner failure after project/key/file mutation; no automatic retry; safe residue report.
- Playwright assertion failure containing a raw response, signed URL, token, key, password, or artifact—must be prevented by construction and regression tested.

---

## VALIDATION COMMANDS

Execute Levels 1-5 during local implementation. Levels 6-8 require the explicit external prerequisites described above.

### Level 1: Syntax and Style

```powershell
npm run format:check
npm run lint
npm run typecheck
git diff --check
```

### Level 2: Focused Unit, Component, and Integration Tests

```powershell
npm test -- --project node tooling/acceptance/release-readiness.test.ts tooling/acceptance/download-metering.test.ts
npm test -- --project node tests/integration/owner-project-control.test.ts tests/integration/project-credential-authentication.test.ts tests/integration/direct-upload-file-lifecycle.test.ts tests/integration/file-trash-lifecycle.test.ts tests/integration/service-protection.test.ts tests/integration/owner-usage-view.test.ts tests/integration/usage-pricing-ledger.test.ts tests/integration/download-metering.test.ts
npm test -- --project dashboard apps/dashboard/src/App.test.tsx apps/dashboard/src/projects/ProjectExperience.test.tsx apps/dashboard/src/credentials/ApiKeyPanel.test.tsx apps/dashboard/src/usage/UsagePanel.test.tsx apps/dashboard/src/integration/IntegrationGuide.test.tsx
npm run test:e2e:list
npm run acceptance:release -- --stage dev-rus11-e2e --dashboard-url https://dashboard.example.invalid --api-url https://api.example.invalid
```

The list and dry-run commands must not require secrets, launch a browser, invoke AWS, or contact either example origin.

### Level 3: Full Regression, Coverage, and Build

```powershell
npm test
npm run test:coverage
npm run build
npm run check
```

### Level 4: Static Security and Evidence Review

```powershell
rg -n -i "authorization|bearer|api.?key|password|token|secret|x-amz-|presigned|storageState|trace|screenshot|video" tests/e2e tooling/acceptance playwright.config.ts README.md
rg -n -i "bucket|objectKey|projects/|stack|internalProjectId|arn:aws|162067902192" tests/e2e tooling/acceptance README.md
git status --short
git diff -- package.json package-lock.json .gitignore tsconfig.json playwright.config.ts tests/e2e tooling/acceptance README.md
```

Review every match in context. Allowed test placeholders and fixed identity-policy constants must never appear in runtime evidence; no real secret or signed query may exist in the worktree or generated artifacts.

### Level 5: AI-Layer and Test-Discovery Validation

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
npm test -- --list
npm run test:e2e:list
```

### Level 6: Read-Only Infrastructure Preview (Explicit Network Authorization)

After setting the mandated `ntz-cli` profile/region/CA environment and verifying the exact account/full ARN through the wrapper:

```powershell
npm run infra:install -- --stage <approved-stage>
npm run infra:diff -- --stage <approved-stage>
```

Inspect no unexpected replacement, deletion, public access, IAM broadening, retention change, CORS change, production alarm creation in non-production, or pricing-mode change. Stop if SST requests bootstrap or another write.

### Level 7: Authorized Deployment and Automated Release Proof

Only after explicit same-stage deploy and data-mutation authorization:

```powershell
npm run infra:deploy -- --stage <approved-stage>
npm run acceptance:release -- --stage <approved-stage> --dashboard-url <https-dashboard-origin> --api-url <https-api-origin> --execute --confirm-stage <approved-stage>
```

Owner credential variables are loaded from a local secret source and are never included in the command, shell history, plan, report, or chat. Run once; inspect a failure before requesting authorization to repeat.

### Level 8: Authorized CloudTrail, Alert, and Human Evidence

- Run the existing documented `acceptance:download-metering` command with disposable file inputs and its secret env variable.
- Run any suspension/backfill/redrive apply only under its own guarded command and explicit mutation authorization.
- Verify a real alert destination only after an approved production deployment path/recipient exists.
- Conduct and time the two-user/three-day experiment, then review the proposed Wiki/Issue changes before publishing as `noamtz`.

---

## ACCEPTANCE CRITERIA

- **AC1**: [ ] A guarded automated end-to-end journey covers invited sign-in, project creation, key issuance, direct upload, completion, list/inspect, private download, stable public access, trash, restore, force delete, and usage visibility against one explicitly authorized non-production stage.
- **AC2**: [ ] Two independent owners/projects prove cross-owner, cross-project, guessed-ID, and private-through-public denial at every applicable boundary without existence or redirect leakage.
- **AC3**: [ ] Combined local and authorized live evidence proves key replace/revoke, real URL expiry, file/storage quotas, project rate limit, duplicate async delivery, purge retry/idempotency, quarantine, replay/rebuild, and stale/incomplete usage presentation.
- **AC4**: [ ] Every externally visible expected/unexpected error uses the shared envelope and evidence/log/artifact review finds no AWS internals, bucket/object keys, secrets, stack traces, internal identifiers, or full presigned URLs/query strings.
- **AC5**: [ ] The rendered curl walkthrough remains clean/copyable/server-side-only, and observed activation from key availability through first successful upload/download is less than five minutes.
- **AC6**: [ ] After separate authorization, the exact RUS-08 CloudTrail transfer matrix runs with disposable files; retained evidence, attribution, bytes, deduplication, quarantine, replay, queue/DLQ, and the `pass` or `remain-evidence-only` pricing decision are recorded safely.
- **AC7**: [ ] Format, lint, typecheck, focused/full tests, >=80% global coverage, build, check, Playwright list/dry-run, synthesis/policy checks, security review, and authorized diff/deployed validations are recorded with clear local-versus-external status.
- **AC8**: [ ] Two actual invited users complete one real project each within three days; timing, trust failures, attribution usefulness, repeated work avoided, and follow-up product decisions are recorded on the canonical epic after explicit GitHub-write authorization.
- [ ] No deferred product feature or production architecture change is added to make release proof easier.
- [ ] No external action is performed without the exact owner authorization required at that phase.

---

## COMPLETION CHECKLIST

- [ ] Native blockers/default branch/canonical Wiki decisions revalidated before implementation.
- [ ] Playwright is exact-pinned, isolated from Vitest, and listable without network or secrets.
- [ ] Release harness is dry-run by default, exact-identity/stage guarded, no-shell, zero-retry, and secret-safe.
- [ ] Local release-matrix gaps have explicit owning-boundary tests.
- [ ] Two-owner deployed spec covers the complete supported journey and denial matrix.
- [ ] One-time secrets and signed URLs never enter browser code, argv, logs, errors, reports, traces, screenshots, video, storage state, or repository files.
- [ ] Curl guide and five-minute timing semantics are verified.
- [ ] All local validation commands pass; full coverage remains >=80% in every category.
- [ ] Fresh diff is reviewed before any authorized deployment.
- [ ] Authorized Playwright run is executed once and leaves only documented residue.
- [ ] Authorized RUS-08 matrix produces a safe pricing-gate decision; no automatic gate flip occurs.
- [ ] Alert destination/path is resolved and verified before production release, or release remains explicitly blocked.
- [ ] Human two-user/three-day experiment is completed and canonical Wiki/Issue evidence is owner-reviewed and published as `noamtz`.
- [ ] Any production defect discovered by proof is fixed with focused regression coverage and an appended plan amendment.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Critical external decision — stage**: This plan recommends a new isolated `dev-rus11-e2e` stage because the suite is destructive, creates two projects, may exercise expiry/rate limits, and cannot delete projects. Reusing `dev-rus02` is acceptable only after the owner explicitly chooses it, confirms no concurrent deployment/run, inspects retained state, and accepts additional residue/cost.
- **Critical external dependency — owners**: Two distinct invited Cognito owners and their credentials must be supplied from a local secret source. The suite will not create users. Optional permanent-password variables support a first `NEW_PASSWORD_REQUIRED` run, which itself mutates account state and needs authorization.
- **Critical release blocker — alerts**: RUS-10 intentionally creates alarms/topic only for the `production` stage and leaves SNS unsubscribed, while `tooling/run-sst.mjs` rejects production deploy/dev. RUS-11 can prove production synthesis locally but cannot verify real alert delivery until the owner approves a production deployment path and recipient. Do not weaken production-only policy to avoid this decision.
- **Product experiment**: Automation cannot satisfy AC8. The owner and one developer friend must use real applications and disposable files; if either misses the target, that is valid falsifying evidence.
- **Evidence storage**: Stable product findings go to the canonical Product Requirements Wiki; execution status can be summarized on issue #11. No new local product-evidence source is assumed. GitHub writes require explicit authorization and identity verification as `noamtz`.
- **Project cleanup**: There is no project-delete API. The live run force-deletes disposable files and revokes keys, but project records remain. A separate cleanup feature is out of scope.
- **Usage timing**: Upload/storage projection and CloudTrail download evidence are eventually consistent. The live journey uses bounded polling and accepts truthful evidence-only/not-yet freshness; it does not require non-zero download cost.
- **Playwright pin**: Revalidate official support and the current stable exact version during implementation. If it has moved from `1.62.1`, update this plan or record the selected exact pin before changing the lockfile; do not use a floating range.
- **No architecture deviation assumed**: Any need for API CORS, dashboard project-key use, new cleanup endpoints, production deploy bypasses, or pricing-mode automation is a scope/architecture change requiring owner direction and a plan amendment.

## NOTES (open canvas)

### Why standalone Playwright instead of Vitest Browser Mode

Vitest Browser Mode is well suited to browser-native component tests hosted through its Vite runner, but this ticket must navigate a real deployed CloudFront/Cognito application and coordinate two owners plus server-side API/direct-S3 requests. Standalone Playwright Test already models deployed projects/base URLs, multiple browser contexts, API request contexts, timeouts, and explicit retry/artifact policy. Existing Vitest/jsdom remains the correct fast layer for components and deterministic domain behavior.

### Evidence layering

```text
Vitest component/integration/policy tests
        │ deterministic races, failures, idempotency, envelopes
        ▼
Guarded Playwright deployed journey
        │ real Cognito + CloudFront + API + S3 composition, two owners, timing
        ▼
Existing RUS-08 acceptance harness
        │ real CloudTrail bytes, replay, queue/DLQ, pricing decision
        ▼
Production alert verification + two-human experiment
        │ delivery confidence + falsifiable product outcome
        ▼
Canonical Wiki / issue evidence (authorized writes only)
```

No lower layer is relabeled as proof of a higher one. In particular, local mocks do not prove CloudTrail or Cognito, Playwright does not prove the two-human hypothesis, and a passing transfer matrix does not authorize priced mode.

### Confidence Score

**8/10 for one-pass local implementation.** The repository has strong dependency-injected integration patterns, a mature guarded acceptance harness to mirror, and complete public contracts. The main implementation risks are preventing secret capture by Playwright diagnostics, keeping a stateful two-owner run non-retriable and deterministic, and avoiding duplication across already-large integration fixtures.

**5/10 for full ticket closure without further owner coordination.** Live completion depends on an isolated stage choice, two owner accounts, explicit AWS mutations, a production alert deployment/recipient decision, the CloudTrail acceptance window, and two humans completing the three-day experiment.

## AMENDMENTS

<!-- Append-only after approval/execution. Newest entry at the bottom. -->

- **2026-08-26 â€” stale project-inspection response discovered during release-matrix work.** The existing dashboard protected list and usage requests from stale responses but not project inspection. A slower response for an earlier selection could overwrite the ownerâ€™s latest selection and display the wrong project experience. The implementation now applies the same request-generation rule to project inspection (and invalidates pending inspections after project creation), with focused component regression coverage. This is a bounded production correctness fix required for trustworthy two-project release proof; it does not change public contracts or architecture.

- **2026-08-26 â€” Vitest discovery command corrected during validation.** With the repository's installed Vitest 4 CLI, `vitest run --list` is not a supported option. Level 5 therefore uses the read-only equivalent `npm exec -- vitest list`; Playwright discovery remains `npm run test:e2e:list`. The rejected command and successful replacement are both retained in the implementation report.
