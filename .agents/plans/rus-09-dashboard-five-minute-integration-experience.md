# Feature: RUS-09 Dashboard and Five-Minute Integration Experience

The following plan is complete, but implementation must revalidate the issue state, current default branch, cited code patterns, and official documentation before changing files.

Pay special attention to the separation between the Cognito-authenticated owner dashboard and the project-API-key-authenticated File Management API. A project API key is a server-side bearer secret and project boundary; it must never be stored in browser storage, interpolated into dashboard file requests, included in examples, or sent to an end client. The consuming application's server uses it to request opaque presigned URLs, and its clients receive only those temporary URLs.

## Feature Description

Complete the invite-only owner dashboard around the already-implemented project, credential, File Management, lifecycle, and usage contracts. An owner can create/select a project, review its immutable File Management utility and bounded transfer settings, issue/list/revoke/replace project API keys, see a newly issued key exactly once, inspect current-calendar-month AWS-equivalent usage, and copy a concise server-side `curl` integration walkthrough.

The walkthrough covers upload authorization and direct PUT, list/inspect, private download authorization and direct GET, stable public access, trash, restore, and explicit force deletion. These are integration instructions for the consuming application's server; the dashboard does not call project-key-authenticated File Management routes or transfer bytes. A small owner-JWT usage-view route is added because the projection exists internally but is not yet exposed to the dashboard.

## User Story

As an invited application owner,
I want to create a project, issue a server-side API key, understand the complete File Management REST flow, and see that project's current usage in one dashboard,
So that my application server can integrate in under five minutes while its clients upload and download through temporary presigned URLs.

## Problem Statement

RUS-02 left a minimal authenticated project shell. RUS-03 through RUS-08 implemented project credentials, trusted project authentication, direct file transfers, file lifecycle, usage pricing, and download metering, but the owner dashboard exposes none of those later capabilities. The existing UI cannot manage credentials, explain the complete server-side integration, or query a monthly projection. The usage service has no owner-facing HTTP boundary, and integration guidance must make the API-key/presigned-URL trust boundary unmistakable.

Without this ticket, an invited owner still needs repository knowledge to activate a project, risks placing a project key in client code, cannot see metering freshness, and cannot complete the intended five-minute onboarding path from the product UI.

## Solution Statement

Add one narrow Cognito-owner usage route under `/v1/control/projects/{projectId}/usage/current-month`. It resolves the public project ID through the owner/control repository, verifies ownership before reading the usage table, computes the current UTC month server-side, and returns the existing strict `MonthlyUsageProjection` contract. It does not accept an internal project ID, caller-selected month, project API key, or ledger details.

Refactor the dashboard's authenticated request plumbing into a reusable control client, then add credential and usage adapters. Compose focused project subpanels for settings, API keys, usage, and integration instructions. Plaintext keys live only in ephemeral React state after issue/replace, are cleared on dismissal/project change, and are never persisted or inserted into examples. The integration guide uses a public build-time API base URL plus placeholders such as `$RUS_API_KEY`; it explains that the application server calls `/v1/files`, receives complete opaque transfer URLs, and passes only those temporary URLs to clients.

## Out of Scope / Non-Goals

- Not included: dashboard calls to `/v1/files`, dashboard file inventory/actions, or owner-JWT file-management facade routes. Per the owner's 2026-08-24 clarification, File Management operations are exercised by the consuming application's server using the project API key; RUS-09 presents the canonical integration flow.
- Not included: placing a project API key in browser code, local/session storage, URLs, logs, analytics, repository content, examples, or end-client code.
- Not included: proxying file bytes through the dashboard, API Gateway, or Lambda. File bytes continue to move directly through opaque presigned S3 URLs.
- Not included: browser-origin S3 CORS policy changes. The canonical MVP activation path is `curl`/server-side. A web client using cross-origin `fetch` with a presigned URL requires a separately approved origin/CORS design; presigning and CORS are independent concerns.
- Not included: editing project settings after creation. The approved project contract already configures independent 1–60 minute upload/download lifetimes at creation with 15/5 defaults. A settings-update API would be a separate control-contract/data-mutation change.
- Not included: per-key usage accounting or quotas. The project—not an individual active key—is the authorization, quota, rate-limit, and usage boundary; multiple project keys attribute to the same project.
- Not included: usage-event writes, repricing, pricing management, invoice allocation, metering repair/replay controls, gate changes, or RUS-10 alarms/rate limiting.
- Not included: a routing library, state-management/query framework, design system, dedicated SDK, or language-specific integration examples.
- Not included: deployed two-user activation proof or the full live end-to-end security matrix; RUS-11 owns assembled release proof.
- Not changing: existing project-key File Management routes, credential cryptography/storage, file lifecycle semantics, private bucket, stable public route, evidence-only download-pricing gate, or AWS resources without separate authorization.

## Feature Metadata

**Feature Type**: Enhancement / integration capability

**Estimated Complexity**: High

**Primary Systems Affected**: React/Vite dashboard, owner control API, identity/control usage view, usage/pricing query runtime, shared contracts, SST route/link composition, dashboard tests and documentation

**Dependencies**: React 19.2.8, Vite 8.2.1, Zod 4.4.3, Vitest 4.1.10, Testing Library, Cognito owner JWT authorizer, DynamoDB control and usage tables, existing RUS-03–RUS-08 contracts/services

## Related Work

**Implements**: [RUS-09 / GitHub issue #9](https://github.com/noamtz/utility-services/issues/9) · **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) · **Architecture**: [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture) · **Stable scope**: [MVP Ticket Breakdown — RUS-09](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown#rus-09--complete-the-dashboard-and-five-minute-integration-experience)

Native readiness verified on 2026-08-24: RUS-03, RUS-04, RUS-05, RUS-06, RUS-07, and RUS-08 are all closed native blockers. RUS-09 blocks the open RUS-11 release-proof ticket.

**Back-references**:

- `.agents/plans/rus-02-invite-only-owner-project-control.md` - Inherit Cognito session handling, owner-only project contracts, same-origin control routing, settings defaults/bounds, API-client pattern, and dashboard component conventions.
- `.agents/plans/rus-03-project-credential-lifecycle-authentication.md` - Consume issue/list/revoke/replace control contracts; preserve one-time plaintext and server-side-secret rules.
- `.agents/plans/rus-04-versioned-pricing-usage-ledger.md` - Expose, but do not duplicate, the strict monthly projection and freshness calculation.
- `.agents/plans/rus-05-direct-upload-file-metadata-lifecycle.md` - Document exact upload/list/inspect contracts, required PUT headers, pending/ready eventual consistency, and direct transfer boundary.
- `.agents/plans/rus-06-private-download-stable-public-access.md` - Document private opaque download authorization and stable public URL behavior.
- `.agents/plans/rus-07-trash-restore-scheduled-purge-force-deletion.md` - Document trash/restore/force-delete semantics and destructive warnings.
- `.agents/plans/rus-08-download-metering-reconciliation-pricing-gate.md` - Consume download metric/freshness state; preserve evidence-only gate truthfulness.

**Forward-references**:

- RUS-10 may add project/key suspension, throttling, and operational freshness alarms without changing this dashboard's public API shapes.
- RUS-11 will automate the assembled two-owner journey, time five-minute activation, and exercise authorized deployed transfer behavior.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` - Canonical security, AWS, File Management, usage-label, validation, and no-external-mutation rules.
- `package.json` (scripts and pinned workspaces) and `vitest.config.ts` (lines 5-49) - Exact local validation commands, dashboard/node projects, and 80% coverage thresholds.
- `apps/dashboard/src/main.tsx` (lines 1-20) - Dashboard bootstrap and public configuration loading.
- `apps/dashboard/src/App.tsx` (lines 1-56) and `App.test.tsx` - Auth-gated shell, API injection, sign-out-on-401 behavior, and top-level security assertions.
- `apps/dashboard/src/auth/AuthProvider.tsx` (lines 1-83) - Existing session state machine and just-in-time access-token getter; do not persist access/project tokens elsewhere.
- `apps/dashboard/src/config.ts` (lines 1-28), `config.test.ts`, and `vite-env.d.ts` - Strict public Vite configuration boundary to extend with an HTTPS API base URL.
- `apps/dashboard/src/projects/api.ts` (lines 1-113) and `api.test.ts` - Dependency-injected authenticated request, same-origin control paths, strict envelope parsing, safe errors, and no-secret regression pattern to extract/reuse.
- `apps/dashboard/src/projects/ProjectView.tsx` (lines 1-124) and `ProjectView.test.tsx` - Project list/selection/create state, stale-request generation guard, 401 handling, and integration-test composition point.
- `apps/dashboard/src/projects/CreateProjectForm.tsx` (lines 1-82) and tests - Existing creation-time settings with 15/5 defaults and shared 1–60 validation.
- `apps/dashboard/src/projects/ProjectDetails.tsx` (lines 1-31) and tests - Public-only settings display and internal/owner identifier leak guard.
- `apps/dashboard/src/styles.css` - Existing single global CSS, responsive panels, semantic focus/alert/status conventions.
- `.agents/references/frontend-component-best-practices.md` - Mandatory project UI component, accessibility, state, styling, and test guidance.
- `packages/contracts/src/credentials/contract.ts` (lines 1-90) - One-time `IssuedApiKey`, metadata-only list, status, cursor, and response schemas.
- `packages/contracts/src/files/contract.ts` (lines 1-230) - Exact upload, file state, transfer, list, lifecycle, and required-header shapes used in instructions; do not recreate a frontend file model.
- `packages/contracts/src/usage-pricing/contract.ts` (lines 1-133) - Exact AWS-equivalent label, decimal strings, five metrics, exclusions, price versions, and freshness states.
- `packages/contracts/src/http/envelope.ts` and `src/index.ts` - Shared strict success/error envelope and export conventions.
- `packages/backend/src/modules/identity-control/auth/owner-context.ts` (lines 1-39) - JWT access-token `sub` extraction and safe 401 behavior.
- `packages/backend/src/modules/identity-control/projects/repository.ts` (lines 25-35, 159-197) - Strongly consistent public-project lookup returning the internal owner/project boundary needed by the usage view.
- `packages/backend/src/modules/identity-control/projects/service.ts` (lines 31-49, 126-132) - Public projection and generic same-404 wrong-owner behavior to mirror.
- `packages/backend/src/modules/identity-control/projects/handlers.ts` (lines 13-38) - `createHttpHandler` + `extractOwnerContext` owner-control boundary pattern.
- `packages/backend/src/modules/identity-control/credentials/handlers.ts` (lines 15-68) and runtime - Four existing control operations the dashboard consumes unchanged.
- `packages/backend/src/core/http/handler.ts` (lines 120-285) - Validated request/response envelopes, safe errors, request IDs, and redacted logging.
- `packages/backend/src/modules/usage-pricing/service.ts` (lines 610-685) - Existing freshness evaluation and `getMonthlyProjection`; call it rather than reading aggregates in the control slice.
- `packages/backend/src/modules/usage-pricing/runtime.ts` (lines 1-23) - Usage table/runtime composition to reuse.
- `packages/backend/src/modules/usage-pricing/model.ts` (source-kind constants) and RUS-08 report - `cloudtrail-download` source identity and evidence-only watermark behavior.
- `infra/config/control.ts` (lines 33-93) and tests - Seven JWT control routes plus narrow no-cache CloudFront forwarding.
- `infra/config/usage-pricing.ts` (lines 1-19) - Query-only usage-table link and independent bounded-context configuration.
- `infra/api.ts` (lines 35-115) - JWT authorizer reuse, route registration, resource linking, and explicit IAM patterns.
- `infra/dashboard.ts` (lines 17-86) and `infra/composition.test.ts` - StaticSite environment and same-origin API behavior; expose public API URL without broadening cache behavior.
- `infra/dynamo-link.ts` - Query-only linked-table baseline; the owner usage view requires no Dynamo writes.
- `tests/integration/owner-project-control.test.ts` and `usage-pricing-ledger.test.ts` (projection/isolation cases) - In-memory owner boundary and public projection integration patterns.
- `README.md` - Current status, public local env example, route counts, secret rules, evidence-only state, and future dashboard wording to update.

### New Files to Create

- `packages/backend/src/modules/identity-control/usage/policy.ts` and `policy.test.ts` - Current-month route/freshness policy constants and UTC period helper.
- `packages/backend/src/modules/identity-control/usage/service.ts` and `service.test.ts` - Owner/project resolution and delegation to the existing usage projection service.
- `packages/backend/src/modules/identity-control/usage/handlers.ts` and `handlers.test.ts` - Cognito-owner HTTP boundary for the current month.
- `packages/backend/src/modules/identity-control/usage/runtime.ts` - Control/usage repository composition and safe logger wiring.
- `packages/backend/src/functions/control/get-current-month-usage.ts` - Thin Lambda entry point.
- `tests/integration/owner-usage-view.test.ts` - Cross-owner/current-month/public-response integration proof.
- `apps/dashboard/src/api/control-client.ts` and `control-client.test.ts` - Reusable authenticated control request/envelope/error adapter.
- `apps/dashboard/src/credentials/api.ts` and `api.test.ts` - Typed API-key lifecycle client.
- `apps/dashboard/src/credentials/ApiKeyPanel.tsx` and `ApiKeyPanel.test.tsx` - Metadata, issue, one-time reveal/copy, revoke, and replace UI.
- `apps/dashboard/src/shared/CopyButton.tsx` and `CopyButton.test.tsx` - Secure-context clipboard interaction with visible manual-copy failure state.
- `apps/dashboard/src/usage/api.ts` and `api.test.ts` - Current-month owner usage client.
- `apps/dashboard/src/usage/UsagePanel.tsx` and `UsagePanel.test.tsx` - Total, metric, price-version, exclusions, and freshness UI.
- `apps/dashboard/src/integration/IntegrationGuide.tsx` and `IntegrationGuide.test.tsx` - Safe canonical server-side `/v1` curl walkthrough.
- `apps/dashboard/src/projects/ProjectExperience.test.tsx` - Critical dashboard owner journey across project, key, usage, and guide panels.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Canonical Architecture — authentication, File Management, usage, and integration](https://github.com/noamtz/utility-services/wiki/Architecture#authentication-and-authorization)
  - Specific sections: Consuming applications; File contracts and project isolation; Presigned transfers; Usage pricing and metering; API evolution and integration instructions.
  - Why: Fixes the owner-JWT/project-key boundary, direct-transfer model, AWS-equivalent wording, and canonical curl format.
- [React `useActionState`](https://react.dev/reference/react/useActionState) and [`useTransition`](https://react.dev/reference/react/useTransition)
  - Why: Understand React 19 async action semantics, but retain explicit local `useState`/try-catch where it matches the current dashboard and gives independent panel loading/errors.
- [Testing Library user-event setup](https://testing-library.com/docs/user-event/setup/) and [introduction](https://testing-library.com/docs/user-event/intro/)
  - Why: Use `userEvent.setup()` and awaited user-visible interactions rather than adding more direct `fireEvent` paths.
- [Vite environment variables](https://vite.dev/guide/env-and-mode) and [public base path](https://vite.dev/guide/build#public-base-path)
  - Why: `VITE_*` values are browser-visible build constants; expose only a public API base URL and never a secret.
- [SST `StaticSite`](https://sst.dev/docs/component/aws/static-site/) and [`ApiGatewayV2`](https://sst.dev/docs/component/aws/apigatewayv2/)
  - Why: Pass the public API URL to the Vite build and register one JWT route using the current component patterns.
- [AWS S3 presigned uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html) and [SigV4 query authentication](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html)
  - Why: The guide must tell consumers to use the complete URL and exact signed/required headers without constructing S3 details.
- [AWS S3 CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)
  - Why: Document that browser cross-origin transfers require a separate bucket-origin policy; do not imply presigning disables browser CORS enforcement.
- [Clipboard `writeText`](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)
  - Why: It requires a secure context/user gesture and may reject; copy UI must show a safe fallback.

### Patterns to Follow

**Naming and file layout:**

- One focused PascalCase component per file with a co-located test. Keep components near 150 lines by extracting API-key reveal, usage metric table, or code-block copy behavior if needed.
- Keep runtime/domain files under the existing bounded context. The owner usage view belongs under `identity-control/usage`; it delegates calculation to `usage-pricing` and does not move pricing logic.
- Use public names `projectId`, `keyId`, `fileId`; internal project ID, Dynamo keys, source IDs, object keys, bucket names, and digests never cross the HTTP/dashboard boundary.

**Authenticated control client:**

```ts
const response = await request(path, ResponseSchema, init);
return response.data;
```

- Acquire a fresh Cognito access token per request.
- Use relative `/v1/control/...` paths for dashboard calls.
- Parse success and error envelopes strictly; malformed/provider failures become a generic safe message.
- A 401 triggers the existing local sign-out path and is not rendered as raw authorization detail.

**Owner usage authorization:**

```ts
const project = await projects.inspect(publicProjectId);
if (!project || project.ownerId !== owner.ownerId) throw projectNotFound();
return usage.getMonthlyProjection(project.internalProjectId, period, evaluatedAt, policy);
```

- The caller supplies only the public path ID.
- Resolve current month and evaluation time on the server in UTC.
- Wrong owner and missing project return the same safe 404 before the usage table is queried.

**One-time secret state:**

- Issue/replace returns plaintext once; list refresh returns metadata only.
- Render the secret in a deliberately labeled one-time reveal region, allow an explicit user-gesture copy, and clear it on dismiss, project change, sign-out/unmount, or replacement by another reveal.
- Never interpolate the revealed value into the integration guide. Examples use `$RUS_API_KEY` and instruct server-side environment storage.

**Usage presentation:**

- Display the exact label `AWS-equivalent usage cost`, currency `USD`, UTC period, total, all five metric rows, sorted price-version IDs, explicit exclusions, freshness state, `last metered at`, and evaluated time.
- Preserve decimal strings until presentation. Use a deterministic display formatter; do not relabel the result as invoice, bill, actual AWS charge, or account allocation.
- `not-yet-metered`, `stale`, and `incomplete` are visible states, not generic failures. A zero total must not be presented as fresh when the contract says otherwise.

**Integration examples:**

- Use the public API base URL and versioned `/v1` routes.
- Show `Authorization: Bearer $RUS_API_KEY` only in server-side curl examples; never contain a usable key.
- Treat `upload.url` and `download.url` from responses as complete opaque values. Do not construct bucket names/keys/endpoints or print sensitive query strings in application logs.
- Explain pending-to-ready eventual consistency, requesting a fresh transfer URL after expiry, immutable public/private visibility, stable public-service URLs, and explicit `force=true` destruction.

---

## IMPLEMENTATION PLAN

### Phase 1: Owner Usage HTTP Boundary

Expose the existing monthly projection through one query-only Cognito-owner route. Establish strict response/export, current UTC month/freshness policy, same-not-found owner isolation, handler/runtime composition, and least-privilege SST wiring.

### Phase 2: Shared Dashboard Control Client and Public Configuration

Extract the current project API request logic into a reusable authenticated control client without changing project behavior. Add a validated public API base URL strictly for absolute integration examples and public service links.

### Phase 3: Credential and Usage Experiences

Build typed credential/usage adapters and focused accessible panels. Make credential plaintext ephemeral, destructive lifecycle actions explicit, and usage labels/freshness exact.

**Independent of:** Phase 4 after the API base URL/config contract exists.

### Phase 4: Five-Minute Server Integration Guide

Build a safe copyable curl journey over the already-implemented project-key File Management API. Cover every file/lifecycle action without executing file calls in the dashboard, revealing a real key, or proxying bytes.

### Phase 5: Project Composition, Critical Journey, and Documentation

Compose the panels around project selection/settings, isolate panel loading/errors, prove the owner journey and security messages, update truthful repository status, and run the full local/infrastructure-preview gates.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. UPDATE usage response contracts

- **UPDATE**: `packages/contracts/src/usage-pricing/contract.ts`, its test, and `packages/contracts/src/index.ts` with a strict `CurrentMonthlyUsageResponseSchema = createSuccessEnvelopeSchema(MonthlyUsageProjectionSchema)` and exported type.
- **TEST**: accept the exact public projection/envelope; reject malformed decimals, wrong labels/currency, unknown/internal fields, and missing freshness.
- **PATTERN**: project and credential response schemas in their contract files.
- **GOTCHA**: do not add internal project IDs, raw aggregates, watermark rows, event sources, invoice language, or a caller-selected month.
- **VALIDATE**: `npm test -- --project node packages/contracts/src/usage-pricing/contract.test.ts`
- **SATISFIES**: AC5 and API safety foundation.

### 2. CREATE the owner usage policy and service

- **CREATE**: `packages/backend/src/modules/identity-control/usage/policy.ts`, `policy.test.ts`, `service.ts`, and `service.test.ts`.
- **IMPLEMENT**: canonical UTC current-period helper; injected `now`; a presentation freshness policy requiring `cloudtrail-download` with a 24-hour age threshold, matching the existing tested policy precedent while remaining distinct from future RUS-10 alarm SLAs.
- **IMPLEMENT**: strongly resolve the public project, verify Cognito owner equality, then delegate to `getMonthlyProjection(internalProjectId, currentUtcPeriod, evaluatedAt, policy)`.
- **TEST**: current UTC month/year boundary, own project, unknown/wrong owner same 404, usage reader not called after denial, exact internal-to-public delegation, fresh/stale/incomplete/not-yet states delegated unchanged.
- **PATTERN**: `identity-control/projects/service.ts:126-132`, `credentials/service.ts:71-75`, and `usage-pricing/service.test.ts` 24-hour policy fixture.
- **GOTCHA**: RUS-08 is intentionally evidence-only, so download priced freshness can honestly remain `not-yet-metered`; do not fake a watermark or claim current pricing.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/usage/policy.test.ts packages/backend/src/modules/identity-control/usage/service.test.ts`
- **SATISFIES**: AC5 and AC7.

### 3. CREATE the owner usage handler, runtime, function, and integration proof

- **CREATE**: `identity-control/usage/handlers.ts`, `handlers.test.ts`, `runtime.ts`, `functions/control/get-current-month-usage.ts`, and `tests/integration/owner-usage-view.test.ts`.
- **IMPLEMENT**: `GET /v1/control/projects/{projectId}/usage/current-month` using `ProjectPathSchema`, `MonthlyUsageProjectionSchema`, `extractOwnerContext`, safe logger, control project repository, and usage runtime.
- **TEST**: access-token-only authorization, server-selected period, cross-owner 404, query-only projection, strict envelope, safe logs/errors, and absence of owner/internal/Dynamo/source/bucket/object/secret fields.
- **PATTERN**: project handler/runtime and `tests/integration/owner-project-control.test.ts`.
- **GOTCHA**: do not accept an API key, period query, owner ID, or internal project ID on this dashboard route.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/usage/handlers.test.ts tests/integration/owner-usage-view.test.ts`
- **SATISFIES**: AC5, AC7, and cross-owner security.

### 4. UPDATE SST route/link composition and dashboard public API configuration

- **UPDATE**: `infra/config/usage-pricing.ts` and tests with one owner usage route descriptor; update `infra/api.ts` to register it with the existing JWT authorizer and links to control/usage tables; update `infra/dashboard.ts`, `infra/composition.test.ts`, `sst.config.ts` call shape only if needed, and dashboard config/types/tests.
- **IMPLEMENT**: pass `api.url` as public `VITE_API_URL`; normalize/validate an HTTPS base URL without exposing values in errors. Keep dashboard control calls relative/same-origin.
- **IAM**: query-only access to both linked tables; no Put/Update/Delete/Scan/wildcard. Do not alter project-key file routes, file bucket CORS, or CloudFront path breadth.
- **TEST**: exact JWT route/path/handler, both resource links, no write/wildcard actions, unchanged seven credential/project routes and seven File Management routes, zero-cache `v1/control/*`, public API env only, no secrets.
- **GOTCHA**: `api.url` is public; API keys are not Vite environment variables. Do not add `v1/files/*` or `/files/public/*` CloudFront behaviors because the dashboard does not execute those routes.
- **VALIDATE**: `npm test -- --project node infra/config/usage-pricing.test.ts infra/config/control.test.ts infra/composition.test.ts && npm test -- --project dashboard apps/dashboard/src/config.test.ts`
- **SATISFIES**: AC5, AC6, and least privilege.

### 5. CREATE a reusable dashboard control client; REFACTOR project API to use it

- **CREATE**: `apps/dashboard/src/api/control-client.ts` and test.
- **UPDATE**: `projects/api.ts` and its test to delegate token acquisition/fetch/envelope/error behavior without changing public `ProjectApi` semantics or relative paths.
- **IMPLEMENT**: typed schema parsing, conditional JSON content type, fresh access token per request, safe error mapping, abort-friendly request input if useful, and one shared unauthorized error type/code.
- **TEST**: success/error/malformed JSON/schema failure, 401 token failure without fetch, header/body behavior, response secrecy, and unchanged create/list/inspect calls.
- **GOTCHA**: do not make the public API base URL the dashboard control origin; same-origin CloudFront forwarding is the established auth path.
- **VALIDATE**: `npm test -- --project dashboard apps/dashboard/src/api/control-client.test.ts apps/dashboard/src/projects/api.test.ts`
- **SATISFIES**: AC1, AC3, AC5, AC7.

### 6. CREATE credential API adapter and reusable clipboard control

- **CREATE**: `credentials/api.ts`, `api.test.ts`, `shared/CopyButton.tsx`, and `CopyButton.test.tsx`.
- **IMPLEMENT**: issue/list/revoke/replace against existing control routes and strict shared schemas; cursor pagination; clipboard feature detection; awaited user-gesture copy; visible success/failure/manual-copy guidance.
- **TEST**: exact methods/paths, no request body for issue/replace/revoke, metadata-only list, malformed response/error safety, secure-context clipboard success/rejection/unavailable cases.
- **GOTCHA**: do not log the copied value, use `document.execCommand`, persist secrets, or include a real key in fixtures beyond syntactically fake local data.
- **VALIDATE**: `npm test -- --project dashboard apps/dashboard/src/credentials/api.test.ts apps/dashboard/src/shared/CopyButton.test.tsx`
- **SATISFIES**: AC3 and AC7.

### 7. CREATE the API-key lifecycle panel

- **CREATE**: `credentials/ApiKeyPanel.tsx` and test.
- **IMPLEMENT**: load/paginate metadata; issue; one-time reveal/copy/dismiss; revoke with confirmation; replace with old-key invalidation warning, confirmation, and new one-time reveal; status/timestamps/replacement metadata; independent loading/empty/error states.
- **SECURITY**: prominent text that the key is a server-side secret used only by the consuming application's backend; end clients receive presigned URLs, never this key. Clear plaintext on dismissal/project change/unmount and after any newer reveal supersedes it.
- **TEST**: full lifecycle, dismissal/reset, pagination, failures, double-click/busy protection, 401 callback, warning text, no secret in examples/storage/log-facing DOM after dismiss, and old-key replacement semantics.
- **PATTERN**: existing project view local state/error roles; use awaited `userEvent` interactions.
- **GOTCHA**: revocation/replacement prevents new authorizations but already-issued presigned URLs can remain usable until their bounded expiry; state that accurately.
- **VALIDATE**: `npm test -- --project dashboard apps/dashboard/src/credentials/ApiKeyPanel.test.tsx`
- **SATISFIES**: AC3 and AC7.

### 8. CREATE usage API adapter and usage panel

- **CREATE**: `usage/api.ts`, `api.test.ts`, `UsagePanel.tsx`, and `UsagePanel.test.tsx`.
- **IMPLEMENT**: query the new owner route; display exact AWS-equivalent label, USD total, UTC period, all metric quantities/costs with user-facing names, sorted price-version IDs, exclusions, freshness badge/message, nullable last-metered time, evaluated time, refresh, and independent loading/error states.
- **TEST**: fresh, stale, incomplete, not-yet-metered, zero-but-not-fresh, multiple price versions, all five metrics, malformed response, 401 callback, refresh, and forbidden invoice/bill/internal terms.
- **GOTCHA**: quantities/costs arrive as decimal strings. Do not silently round all sub-cent costs to `$0.00` or coerce identifiers/internal precision into unsafe numbers.
- **VALIDATE**: `npm test -- --project dashboard apps/dashboard/src/usage/api.test.ts apps/dashboard/src/usage/UsagePanel.test.tsx`
- **SATISFIES**: AC5 and AC7.

### 9. CREATE the canonical five-minute integration guide

- **CREATE**: `integration/IntegrationGuide.tsx` and test.
- **IMPLEMENT**: copyable server-side curl sequence for API base/key environment setup, upload authorization, opaque PUT with exact response-required headers, list/inspect/poll pending-to-ready, private opaque GET authorization, stable public access, trash, restore, and separately guarded `force=true` deletion.
- **EXPLAIN**: project API key authenticates the consuming application's server and establishes project usage/quota attribution; server passes only presigned URLs to clients; request a fresh URL after expiry; never log URL query strings; visibility is immutable; transfer bytes bypass the service API.
- **TEST**: every canonical route/method, `$RUS_API_KEY` placeholder, public API base, temporary URL/expiry wording, eventual consistency, secret/public/private/destructive warnings, copy success/failure, and absence of usable key/bucket/object/internal identifiers.
- **GOTCHA**: examples may show response-field placeholders, but must never invent or construct an S3 URL. State separately that browser `fetch` requires an approved S3 CORS origin policy; do not imply the current curl/server path configures it.
- **VALIDATE**: `npm test -- --project dashboard apps/dashboard/src/integration/IntegrationGuide.test.tsx`
- **SATISFIES**: AC4, AC6, AC7, and five-minute activation goal.

### 10. UPDATE project dashboard composition, settings UX, styles, and critical journey tests

- **UPDATE**: `App.tsx`, `ProjectView.tsx`, `ProjectDetails.tsx`, their tests, and `styles.css`; create `ProjectExperience.test.tsx`.
- **IMPLEMENT**: preserve create/list/select/detail; make selected-project settings explain 1–60 bounds, 15/5 defaults, expiry, fresh-URL behavior, and File Management-only utility; compose API key, usage, and integration panels keyed/reset by project ID.
- **STATE**: each panel owns independent loading/error/retry state so a failed usage request does not hide key metadata/settings and stale project requests cannot overwrite a newer selection.
- **ACCESSIBILITY**: semantic headings/sections, labels, confirmation dialogs or explicit confirmation controls, keyboard/focus visibility, `role=status/alert`, `aria-live` for copy/reveal updates, responsive layout.
- **TEST**: authenticated owner creates/selects a project, sees settings, issues/dismisses a key, sees usage/freshness, copies safe instructions, switches projects without stale secret/data leakage, receives understandable empty/error/authorization states, and signs out on 401.
- **GOTCHA**: do not add a client router/query library or put the revealed key into the integration guide.
- **VALIDATE**: `npm test -- --project dashboard apps/dashboard/src/App.test.tsx apps/dashboard/src/projects/ProjectView.test.tsx apps/dashboard/src/projects/ProjectDetails.test.tsx apps/dashboard/src/projects/ProjectExperience.test.tsx`
- **SATISFIES**: AC1 through AC8 under the clarified server-integration boundary.

### 11. UPDATE documentation and repository status

- **UPDATE**: `README.md` status/layout/local env/route count/dashboard sections and the minimal current-status path sentence in `AGENTS.md` only if implementation changes make it stale.
- **DOCUMENT**: Cognito dashboard vs project-key server boundary, current usage view, evidence-only freshness truth, public `VITE_API_URL`, five-minute curl guide location, and browser CORS caveat without copying the canonical wiki locally.
- **GOTCHA**: do not claim deployment, priced download metering, live user success, browser upload support, settings editability, or AWS invoice equivalence.
- **VALIDATE**: `python tooling/validate_codex_layer.py`
- **SATISFIES**: repository truthfulness and future-agent safety.

### 12. RUN focused, full, and preview validation

- **RUN**: all commands in Validation Commands in order; fix failures and rerun the exact failed command before continuing.
- **VERIFY**: dashboard coverage remains at least 80% for branches/functions/lines/statements; no secret/presigned-query/internal identifier appears in built assets, fixtures, docs, or logs.
- **PREVIEW**: after local gates and exact AWS identity preflight, run wrapper-controlled install/diff for `dev-rus02` only if no parallel branch is using it. Inspect one new JWT query route/function/IAM linkage and dashboard asset/env refresh; no data/resource replacement or unexpected writes.
- **GOTCHA**: preview is not deployment approval. Do not run deploy, create users/keys/data, execute live curl transfers, flip pricing mode, or mutate GitHub/wiki/AWS state.
- **VALIDATE**: `npm run check`
- **SATISFIES**: all ACs and completion gates.

---

## TESTING STRATEGY

### Unit Tests

- Strict response-envelope export and public projection rejection of unknown/internal fields.
- UTC current-period and freshness policy constants.
- Owner usage service same-404 isolation, server-selected period, and delegation without pricing duplication.
- Owner usage handler JWT/path/response/error/log behavior.
- Reusable control client token/header/envelope/error safety.
- Credential API methods/paths/pagination and no-body lifecycle requests.
- Clipboard secure-context success/failure/unavailable behavior.
- API-key panel one-time state, reset, lifecycle confirmations, loading/errors, and server-side-secret messaging.
- Usage panel formatting and all freshness states.
- Integration guide route coverage, placeholders, expiry/eventual-consistency/destructive messaging, and no secret/AWS-internal leakage.

### Integration Tests

- `owner-usage-view.test.ts`: owner A receives only project A's current-month public projection; owner B/unknown cannot distinguish existence; current UTC month is authoritative; usage reader receives internal identity only after authorization.
- `ProjectExperience.test.tsx`: authenticated owner selects a project and independently completes settings review, key issue/reveal/dismiss, usage review, and safe guide copy; project switching clears ephemeral/selections and stale requests.
- Existing credential, direct-upload, public/private download, trash/restore, and metering integration tests remain unchanged and green; RUS-09 consumes rather than reimplements them.

### Edge Cases

- Access token unavailable/expired, malformed response, wrong-owner project, and safe 401 sign-out.
- Empty projects, no keys, paginated keys, revoked/replaced/suspended metadata, concurrent/double lifecycle clicks.
- Clipboard unavailable/rejected, key dismissed before/after copy, project switch while issue/list is pending.
- Usage zero/fresh, zero/not-yet, stale, incomplete, null last-metered time, multiple price versions, very small decimal costs, and evidence-only download state.
- Presigned URL expiry/retry wording, upload pending eventual consistency, required PUT headers, stable public vs private distinction, and explicit force-delete warning.
- No actual project key in examples/build/test snapshots; no key remains after reveal dismissal/project switch.
- No file/dashboard auth confusion: dashboard calls only `/v1/control/*`; examples alone contain `/v1/files` with placeholder authorization.

---

## VALIDATION COMMANDS

Execute every command in this order.

### Level 1: Syntax & Style

```powershell
npm run format:check
npm run lint
npm run typecheck
```

### Level 2: Focused Unit and Integration Tests

```powershell
npm test -- --project node packages/contracts/src/usage-pricing/contract.test.ts packages/backend/src/modules/identity-control/usage/policy.test.ts packages/backend/src/modules/identity-control/usage/service.test.ts packages/backend/src/modules/identity-control/usage/handlers.test.ts tests/integration/owner-usage-view.test.ts infra/config/usage-pricing.test.ts infra/config/control.test.ts infra/composition.test.ts
npm test -- --project dashboard apps/dashboard/src/config.test.ts apps/dashboard/src/api/control-client.test.ts apps/dashboard/src/projects/api.test.ts apps/dashboard/src/credentials/api.test.ts apps/dashboard/src/credentials/ApiKeyPanel.test.tsx apps/dashboard/src/shared/CopyButton.test.tsx apps/dashboard/src/usage/api.test.ts apps/dashboard/src/usage/UsagePanel.test.tsx apps/dashboard/src/integration/IntegrationGuide.test.tsx apps/dashboard/src/projects/ProjectExperience.test.tsx apps/dashboard/src/App.test.tsx apps/dashboard/src/projects/ProjectView.test.tsx apps/dashboard/src/projects/ProjectDetails.test.tsx
```

### Level 3: Full Regression and Build

```powershell
npm test
npm run test:coverage
npm run build
npm run check
```

### Level 4: Local Manual UI Validation

Run `npm run dev` with syntactically valid public Cognito/API placeholders only. Verify the signed-out shell renders without values leaking. With injected test/fake API data (not live credentials), verify responsive/keyboard behavior, one-time secret reset, copy failure fallback, stale/incomplete usage messaging, and integration examples. Local placeholder configuration cannot prove live sign-in or transfer behavior.

### Level 5: Infrastructure Preview (Read-Only; No Deploy)

```powershell
npm run infra:install -- --stage dev-rus02
npm run infra:diff -- --stage dev-rus02
```

Run only through `tooling/run-sst.mjs`, after confirming no parallel use and exact `ntz-cli` identity/account/region. Inspect the full diff for one owner usage function/route, query-only control+usage permissions, public dashboard API URL build value, ordinary dashboard assets, and no replacement/deletion or unrelated mutation. Stop on mismatch or unexpected bootstrap/write.

### Level 6: AI-Layer and Diff Safety

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
git diff --check
```

Live Cognito sign-in, issuing a real key, calling `/v1/files`, S3 transfer, AWS mutation, pricing-gate change, deployment, and GitHub/wiki writes all remain separately authorized external actions.

---

## ACCEPTANCE CRITERIA

- [ ] Authenticated owners retain accessible project create/list/select/detail behavior and see only their projects.
- [ ] File Management remains the sole utility; creation-time upload/download lifetimes enforce 1–60 minutes, default 15/5, and clearly explain temporary expiry/fresh-URL behavior.
- [ ] Owners can issue/list/paginate/revoke/replace API keys, reveal new plaintext once, copy/dismiss it, and see prominent server-side-secret/end-client-presigned-URL guidance.
- [ ] Project switching, dismissal, sign-out, and unmount clear revealed plaintext; no browser persistence or example interpolation exists.
- [ ] One owner-JWT query route returns only the authorized project's current UTC monthly projection using the existing usage service and query-only IAM.
- [ ] The dashboard displays exact AWS-equivalent usage cost, USD total, five-metric breakdown, price versions, exclusions, last-metered/evaluated times, and fresh/stale/incomplete/not-yet states without invoice/bill claims.
- [ ] The dashboard provides copyable server-side `/v1` curl instructions covering upload/PUT, list/inspect, private/GET, stable public access, trash, restore, and explicit force delete.
- [ ] Examples use only a placeholder API key and complete opaque URLs returned by the API; they contain no real secret, bucket, object key, internal project ID, or constructed S3 endpoint.
- [ ] The guide states that the application server authenticates with the project key and that clients receive only temporary presigned URLs; dashboard and client code never receive the key for File Management calls.
- [ ] Loading, empty, validation, authorization, clipboard, eventual-consistency, expired-URL, stale-metering, and destructive-confirmation states are understandable and accessible.
- [ ] Frontend component/integration tests cover the critical owner journey and secret/public/private safety messaging; backend/infrastructure tests prove owner isolation and least privilege.
- [ ] All focused/full validation, 80% coverage gates, build, Codex-layer checks, and diff safety pass.
- [ ] Any infrastructure preview is identity-verified, read-only, secret-free, and shows no unexpected resource/data replacement; no deployment occurs without separate approval.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order and every task-level command passed.
- [ ] Existing project, credential, file, lifecycle, metering, and auth tests remain green.
- [ ] No dashboard call sends a project API key or invokes `/v1/files`.
- [ ] No project key, access token, full presigned URL/query, internal ID, bucket, object key, digest, or raw usage evidence appears in logs/docs/build artifacts.
- [ ] Revealed keys are ephemeral and metadata endpoints cannot recover plaintext.
- [ ] Wrong-owner usage access is indistinguishable from missing project and does not query usage.
- [ ] Usage wording/freshness/evidence-only behavior is truthful.
- [ ] Integration guide is copyable, server-side, versioned, opaque-transfer aware, and explicit about expiry/eventual consistency/destruction.
- [ ] UI is keyboard accessible, responsive, and uses visible status/alert/live regions.
- [ ] Full suite, coverage, typecheck, lint, format, build, AI-layer validation, and diff check pass.
- [ ] Preview/deploy/external-action boundaries were followed and documented.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Owner clarification controls scope:** On 2026-08-24 the owner clarified that a consuming application's server uses the project API key to authenticate against File Management, obtain presigned URLs, and pass those temporary URLs to its clients. Therefore the issue's “file interactions” are planned as the canonical integration experience, not dashboard-executed file management. If dashboard file inventory/actions are later desired, they require a separately approved Cognito-owner API boundary and must not reuse project secrets in browser code.
- **Project-level usage:** All active keys for one project resolve the same trusted project context and therefore share usage/quota/rate-limit attribution. Per-key usage is not inferred from the existing model.
- **Creation-time settings:** This plan treats the existing creation form/detail display as the RUS-09 settings experience. Editing lifetimes later would require a new owner control mutation and atomic persistence design; it is not silently added.
- **Freshness threshold:** The 24-hour `cloudtrail-download` presentation threshold is selected from the existing service-test precedent because architecture defines freshness visibility but no numeric UI threshold. It is not an RUS-10 operational SLA. Evidence-only download metering can remain `not-yet-metered` until a separately reviewed/authorized priced-mode change produces the priced watermark.
- **Browser client transfers:** Canonical RUS-09 examples use curl/server-side transfers. A web browser receiving a presigned URL from the application server still requires S3 CORS for cross-origin `fetch`; current `cors: false` means browser-origin enablement needs a separate origin/wildcard security decision. Presigning authorizes S3 but does not disable browser CORS.
- **No critical implementation ambiguity remains** under these assumptions. If the owner changes dashboard file-management, settings-edit, per-key-usage, browser-CORS, or freshness-threshold scope, amend this plan before `$piv-implement`.

## NOTES (open canvas)

### Trust and data flow

```text
Owner browser -- Cognito access token --> /v1/control/projects, api-keys, usage
                                             |
                                             +--> owner/project administration only

Application server -- project API key --> /v1/files
                                             |
                                             +--> trusted project context
                                             +--> project quota/usage attribution
                                             +--> temporary opaque PUT/GET URL

Application server -- temporary URL only --> end client --> S3 direct transfer
```

Revoking/replacing a project key stops future File Management authorization with that key. It does not revoke an already-issued presigned URL; bounded upload/download lifetimes limit that residual capability, and clients request a fresh URL through the application server after expiry.

### Why one usage route is still backend work

The dashboard cannot calculate usage from public project data, and it must not read DynamoDB or use a project API key. The existing usage service already owns exact pricing, aggregation, exclusions, and freshness. The narrow owner route is therefore a transport/authorization adapter only: Cognito owner → owned internal project → existing public projection. This preserves both bounded contexts and avoids duplicating cost logic in React.

### Why integration instructions never use the revealed value

The one-time reveal helps the owner transfer the key into their server-side secret store. Keeping examples permanently placeholder-based prevents DOM state, clipboard helpers, snapshots, screenshots, or future analytics from coupling the live secret to documentation. It also makes every example reusable after key rotation.

### Confidence Score

**8.5/10** for one-pass local implementation. Existing credential/file/usage contracts and dashboard patterns are strong. Primary risks are coordinated UI state/secret clearing, exact route/resource linking for the owner usage view, honest evidence-only freshness presentation, and keeping the extensive integration guide concise enough for the five-minute target. Confidence drops if editable settings, dashboard file actions, per-key usage, or browser-client CORS are added without amendment.

## AMENDMENTS

(None at creation.)
