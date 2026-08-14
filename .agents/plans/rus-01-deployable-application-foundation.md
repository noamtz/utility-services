# Feature: RUS-01 Deployable Application Foundation

The following plan is complete, but implementation must revalidate package compatibility, official documentation, repository state, and task sanity before changing files. Pay special attention to exact workspace package names, TypeScript project references, SST component APIs, and runtime imports.

## Feature Description

Establish the first deployable skeleton for Reusable Utility Services: one modular TypeScript/SST application containing a React/Vite dashboard shell, an API Gateway HTTP API with a public `/v1/health` Lambda route, shared runtime validation and HTTP/observability foundations, deterministic stage policy, production retention defaults, and a reproducible quality toolchain.

This is deliberately the RUS-01 foundation ticket, not an all-MVP plan. The canonical [MVP Ticket Breakdown](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown) marks only RUS-01 ready and requires later tickets to be planned just in time after their dependencies exist. This plan inherits the approved epic and architecture without implementing identity, credentials, file behavior, metering, or production deployment.

## User Story

As a developer of Reusable Utility Services,
I want a reproducible modular application foundation that can be installed, checked, tested, built, and previewed for isolated SST stages,
so that each later MVP ticket can add one bounded feature without redefining the stack or repository layout.

## Problem Statement

The current directory contains only the Codex/AI layer and is not a Git checkout. The public GitHub repository is empty and has no default branch. There is no application manifest, source tree, lockfile, test framework, build command, or SST configuration. Later tickets cannot safely implement owner identity, project authentication, file management, or usage metering until the physical layout and shared runtime contracts are established and verified.

## Solution Statement

Create an npm-workspaces modular monolith on Node.js 24 with exact direct dependency versions locked by `package-lock.json`. Use:

- `apps/dashboard` for the React/Vite SPA;
- `packages/contracts` for Zod runtime schemas and cross-runtime public contracts;
- `packages/backend` for Lambda runtime foundations and later vertical slices;
- `infra` for one SST application composition;
- colocated unit tests and root integration/E2E directories for future cross-slice tests.

Choose Zod 4 as the concrete schema library because it validates untrusted runtime data while inferring TypeScript types and runs in both Node and modern browsers. Use AWS Lambda Powertools for structured logging, tracing, and metrics, wrapped by project-owned redaction and request-context seams. Configure `sst.aws.ApiGatewayV2`, `sst.aws.StaticSite`, `il-central-1`, explicit stage validation, and production `removal: "retain"` plus `protect: true`. All implementation and validation stays local/read-only; no AWS deployment, credentials, remote branch, commit, or push is authorized by this plan.

## Out of Scope / Non-Goals

- Not included: Cognito, owner/project persistence, and authenticated control routes (RUS-02).
- Not included: project API-key generation, hashing, verification, rotation, or revocation (RUS-03).
- Not included: DynamoDB tables, pricing snapshots, usage events, aggregates, or metering (RUS-04 and RUS-08).
- Not included: file buckets, presigned transfer URLs, file metadata, uploads/downloads, public redirects, lifecycle, quotas, or purge (RUS-05 through RUS-08).
- Not included: completed dashboard workflows, canonical `curl` activation flow, production alarms, or end-to-end activation proof (RUS-09 through RUS-11).
- Not included: custom domains, SDKs, browser/mobile project credentials, multipart uploads, CloudFront file delivery, billing, or any other deferred architecture item.
- Not changing: the GitHub wiki remains canonical; do not copy the PRD or architecture into local product docs.
- Not authorized: `sst deploy`, `sst dev`, AWS state bootstrap/resource creation, Cognito invitations, credential creation, remote commits/branches, or pushes.

## Feature Metadata

**Feature Type**: New Capability / Greenfield Foundation

**Estimated Complexity**: High

**Primary Systems Affected**: repository/toolchain, TypeScript workspaces, shared contracts, Lambda runtime foundation, SST infrastructure, React/Vite dashboard, automated tests, developer documentation

**Dependencies**: Node.js 24, npm 11, SST 4, React 19, Vite 8, Zod 4, AWS Lambda Powertools 2, Vitest 4, ESLint 10, TypeScript 6, Prettier 3

## Related Work

**Implements**: [RUS-01 / GitHub issue #1](https://github.com/noamtz/utility-services/issues/1) · **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) · **Architecture**: [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture)

**Back-references**:

- [MVP Ticket Breakdown](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown) - Defines RUS-01 scope, readiness, acceptance criteria, and the dependency graph.
- None in `.agents/plans/`; this is the first implementation plan.

**Forward-references**:

- RUS-02 through RUS-11 must inherit the physical layout and contracts created here and be planned only when their `ready` label/dependencies permit it.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` (lines 3-16) - Product scope, canonical wiki policy, greenfield status, and required logical boundaries.
- `AGENTS.md` (lines 18-27) - Mandatory modular SST/TypeScript/React/Vite/API Gateway shape, region, stages, and direct-transfer boundary.
- `AGENTS.md` (lines 29-38) - Security and redaction invariants the runtime foundation must make possible.
- `AGENTS.md` (lines 50-56) - `/v1` routing and consistent validated response/error envelope requirements.
- `AGENTS.md` (lines 58-77) - Proportionate test rules, external-action prohibition, and the only currently verified commands.
- `README.md` (lines 1-23) - Current AI-layer-only quick start that must be expanded, not discarded.
- `.gitignore` (lines 1-6) - Existing secret and Codex-log exclusions to preserve while adding Node/SST/Vite artifacts.
- `.agents/references/architecture-patterns.md` (lines 55-99, 298-373, 455-489, 571-595) - Feature cohesion, small files, documentation, explicit dependencies, and colocated tests.
- `.agents/references/vertical-slice-architecture.md` (lines 18-65, 141-170, 231-264, 266-420, 1009-1049) - Foundation-before-features, universal core versus slice logic, structured request correlation, and test placement. Translate the Python examples to TypeScript; do not copy FastAPI-specific structure.
- `.agents/references/backend-api-best-practices.md` (lines 7-26, 42-69) - Thin handlers, boundary schemas, centralized errors, auth separation, and route-level tests. Root policy wins over its generic `/api/v1` example: use `/v1`.
- `.agents/references/frontend-component-best-practices.md` (lines 7-42) - Component naming, accessibility, and behavior-led colocated tests.
- `.codex/config.toml` (lines 1-14) - Existing codebase-search setup; preserve it.
- `tooling/validate_codex_layer.py` (lines 13-16, 57-124, 136-197) - Existing AI-layer validation that must still pass after docs/instruction changes.

Repository facts to verify again before implementation:

- No `.git` directory or application scaffold exists locally.
- `noamtz/utility-services` is currently an empty GitHub repository with no default branch.
- The current GitHub credential has read-only repository permission; no push should be attempted.

### Existing Files to Update

- `.gitignore` - Add Node, Vite, SST, coverage, generated types, build outputs, and local environment artifacts without weakening existing secret exclusions.
- `README.md` - Replace the AI-layer-only framing with the product overview, safe local quick start, physical layout, verified commands, stage rules, and links to canonical wiki pages; retain the useful Codex setup section.
- `AGENTS.md` - Only after commands are actually run successfully, replace the “no commands exist” statement with the verified install/dev/test/typecheck/lint/build/infrastructure-preview commands and their external-action caveats.

### New Files to Create

- `package.json`, `package-lock.json`, `.npmrc`, `.node-version` - Private npm workspace, exact direct dependency/tool versions, Node/npm enforcement, and root scripts.
- `tsconfig.json`, `tsconfig.base.json` - Strict TypeScript project references and shared compiler policy.
- `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore` - Flat lint/format policy for TypeScript, React, tests, and generated outputs.
- `vitest.config.ts` - Backend/contracts/infra Node projects and dashboard jsdom project with V8 coverage thresholds.
- `sst.config.ts` - Thin SST entry point delegating policy and component construction to `infra`.
- `infra/tsconfig.json` - Infrastructure TypeScript project included by the root project-reference graph.
- `infra/config/stage.ts`, `infra/config/stage.test.ts` - Allowed stage grammar and production/developer/PR classification.
- `infra/config/app.ts`, `infra/config/app.test.ts` - Pure region, removal, protection, and app-name policy consumed by `sst.config.ts`.
- `infra/api.ts` - `sst.aws.ApiGatewayV2` and `GET /v1/health` route composition.
- `infra/dashboard.ts` - `sst.aws.StaticSite` composition for `apps/dashboard` using AWS-generated URLs.
- `apps/dashboard/package.json`, `apps/dashboard/tsconfig.json`, `apps/dashboard/vite.config.ts`, `apps/dashboard/index.html` - SPA package/build configuration.
- `apps/dashboard/src/main.tsx`, `apps/dashboard/src/App.tsx`, `apps/dashboard/src/App.test.tsx`, `apps/dashboard/src/styles.css`, `apps/dashboard/src/test/setup.ts`, `apps/dashboard/src/vite-env.d.ts` - Accessible foundation shell and test.
- `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts` - Runtime-contract package boundary.
- `packages/contracts/src/http/envelope.ts`, `packages/contracts/src/http/envelope.test.ts` - Zod success/error envelope schemas and inferred types.
- `packages/contracts/src/health/contract.ts`, `packages/contracts/src/health/contract.test.ts` - Health response contract.
- `packages/backend/package.json`, `packages/backend/tsconfig.json`, `packages/backend/README.md` - Lambda package and the future module ownership map.
- `packages/backend/src/core/http/handler.ts`, `packages/backend/src/core/http/handler.test.ts` - Validated API Gateway v2 handler adapter and centralized safe error mapping.
- `packages/backend/src/core/observability/powertools.ts` - Process-level Logger/Tracer/Metrics instances.
- `packages/backend/src/core/observability/request-context.ts` - API Gateway request ID propagation.
- `packages/backend/src/core/observability/redact.ts`, `packages/backend/src/core/observability/redact.test.ts` - Recursive sensitive-key and URL-query redaction.
- `packages/backend/src/functions/health.ts`, `packages/backend/src/functions/health.test.ts` - Thin health handler using shared contracts and core adapter.
- `tests/integration/.gitkeep`, `tests/e2e/.gitkeep` - Explicit future cross-slice test locations; no fabricated product tests in RUS-01.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [SST configuration: app, providers, removal, protect](https://sst.dev/docs/reference/config)
  - Why: Defines `il-central-1`, `home`, production retention, and the distinction between `protect` and `removal`.
- [SST CLI: `diff`](https://sst.dev/docs/reference/cli/#diff)
  - Why: `sst diff --json` is the non-deploying infrastructure preview command; stop if a first run requests external state bootstrap not separately authorized.
- [SST `StaticSite`](https://sst.dev/docs/component/aws/static-site/)
  - Why: Vite `path`, build command/output, local dev behavior, and browser-visible environment rules.
- [SST `ApiGatewayV2`](https://sst.dev/docs/component/aws/apigatewayv2)
  - Why: HTTP API route syntax and Lambda integration behavior.
- [SST `Function`](https://sst.dev/docs/component/aws/function/)
  - Why: Confirm the current Node.js 24 runtime and tracing/function defaults against the pinned SST version.
- [Zod introduction](https://zod.dev/) and [basic parsing/type inference](https://zod.dev/basics)
  - Why: Selected runtime schema library and safe-parse/type-inference patterns.
- [AWS Lambda Powertools for TypeScript](https://docs.aws.amazon.com/powertools/typescript/latest/)
  - Why: Structured Logger, Metrics, and Tracer foundations.
- [AWS Lambda TypeScript logging](https://docs.aws.amazon.com/lambda/latest/dg/typescript-logging.html)
  - Why: JSON logging behavior and current Node.js 24 examples.
- [Vite getting started](https://vite.dev/guide/)
  - Why: Current React/TypeScript build contract and browser support.
- [Vitest projects](https://vitest.dev/guide/projects) and [coverage](https://vitest.dev/guide/coverage)
  - Why: Separate Node/jsdom test environments and enforceable coverage.
- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
  - Why: Workspace dependency ordering and strict no-emit checks.

### Toolchain Selection

Use exact direct versions in manifests and preserve the generated lockfile. Re-check `npm view` immediately before implementation and change only for demonstrated compatibility:

- Node `24.x`; npm `11.x` (local evidence: Node 24.13.0/npm 11.6.2).
- `sst@4.17.1` (current registry stable at plan creation; the approved architecture did not pin SST v3).
- `typescript@6.0.3`, not TypeScript 7: current `typescript-eslint@8.67.0` declares TypeScript `<6.1.0`.
- `typescript-eslint@8.67.0`, `eslint@10.8.1`, `prettier@3.9.6`.
- `react@19.2.8`, `react-dom@19.2.8`, `vite@8.2.1`, `@vitejs/plugin-react@6.0.5`.
- `zod@4.4.3`.
- `vitest@4.1.10`, `@vitest/coverage-v8@4.1.10`, Testing Library, and jsdom.
- `@aws-lambda-powertools/logger`, `metrics`, and `tracer` at `2.34.0`; `@types/aws-lambda` as a development dependency.

### Patterns to Follow

**Physical ownership:**

```text
apps/dashboard                 React/Vite composition and UI behavior
packages/contracts             public/runtime schemas only; no AWS clients or persistence
packages/backend/src/core      universal Lambda HTTP and observability infrastructure
packages/backend/src/modules   future vertical slices by approved bounded context
infra                          one SST app and stage/resource composition
tests/integration              behavior crossing two or more packages/slices
tests/e2e                      assembled user journeys
```

Do not create horizontal global `controllers/`, `services/`, or `repositories/` trees. Later feature logic belongs together under its owning module; only proven universal runtime infrastructure belongs in `core`.

**Naming conventions:**

- npm packages: `@utility-services/dashboard`, `@utility-services/contracts`, `@utility-services/backend`.
- Files/directories: kebab-case; React component files and exports: PascalCase.
- TypeScript symbols: PascalCase types/schemas, camelCase functions/variables, SCREAMING_SNAKE_CASE true constants.
- Structured events: `<domain>.<action>.<status>`, for example `http.request.completed`.
- SST logical component names: stable PascalCase, for example `ServiceApi`, `Dashboard`, `HealthRoute`.

**Runtime contract:**

```ts
type SuccessEnvelope<T> = { data: T; requestId: string };
type ErrorEnvelope = {
  error: { code: string; message: string; details?: Array<{ path: string; message: string }> };
  requestId: string;
};
```

Zod schemas are the source of truth; infer TypeScript types from them. Clients never receive stack traces, handler names, AWS request payloads, bucket/object details, or authorization internals.

**Handler flow:** API Gateway event → authoritative `requestContext.requestId` → boundary `safeParse` → thin domain callback → validated success envelope. Known validation/application errors map centrally to safe status/code/message; unknown errors are logged through a redacted structured context and return `INTERNAL_ERROR` with HTTP 500.

**Logging/redaction:** Never log raw API Gateway events. Use an allowlisted structured context. Redact keys case-insensitively (`authorization`, `cookie`, `x-api-key`, `apiKey`, `token`, `secret`, `password`, and future presigned URL fields) at any nesting depth; strip query/fragment data from URL-like strings. Tests must prove the original object is not mutated.

**Stage policy:** Accept exactly `production`, `pr-<positive-integer>`, or `dev-<lowercase-slug>`. Production uses `removal: "retain"` and `protect: true`; ephemeral stages use `removal: "remove"` and `protect: false`. Every SST command must receive `--stage`; never allow an implicit username/production stage.

**Testing:** Co-locate unit tests with implementation. Use Node environment for contracts/backend/infra and jsdom for dashboard. Keep files focused (target under 300 lines). Test behavior and public shapes, not implementation details.

**Root command contract:**

```json
{
  "scripts": {
    "dev": "npm run dev --workspace @utility-services/dashboard",
    "dev:sst": "sst dev",
    "format:check": "prettier . --check",
    "lint": "eslint . --max-warnings=0",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "build": "npm run typecheck && npm run build --workspace @utility-services/dashboard",
    "infra:diff": "sst diff --json",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm run test:coverage && npm run build"
  }
}
```

Keep `npm run dev` fully local. `npm run dev:sst -- --stage dev-<slug>` is intentionally separate because SST Live can create/update a personal AWS stage and is not authorized by this ticket.

---

## IMPLEMENTATION PLAN

### Phase 1: Repository and Toolchain Foundation

Initialize local Git metadata/remotes without external writes; establish the npm workspace, strict TypeScript graph, exact dependency lock, linting, formatting, and test runners.

**Tasks:**

- Initialize local `main` metadata and add the empty GitHub repository as `origin`; do not commit, create a remote branch, or push.
- Create root/workspace manifests and package boundaries.
- Pin compatible Node/npm/SST/TypeScript/tool versions and generate `package-lock.json`.
- Add strict TypeScript, ESLint flat config, Prettier, and multi-environment Vitest configuration.

### Phase 2: Shared Runtime Contracts and Observability

**Depends on:** Phase 1 (workspace resolution and test runner)

Implement Zod envelopes, the validated handler adapter, request correlation, Powertools instances, and deterministic redaction before adding a handler.

**Tasks:**

- Define success/error/health Zod schemas and inferred types.
- Create the thin API Gateway v2 handler adapter and safe centralized error mapping.
- Create Logger/Tracer/Metrics instances outside handlers.
- Add request-ID propagation and non-mutating recursive redaction.
- Unit-test envelope validation, invalid input, unknown errors, correlation, and leakage prevention.

### Phase 3: SST and Dashboard Composition

**Depends on:** Phase 2 (health contract and handler foundation)

Compose one SST app with pure, tested stage policy; add the `/v1/health` Lambda route and a minimal accessible React/Vite shell.

**Tasks:**

- Implement stage grammar, `il-central-1`, production retention/protection, and stable app/component names.
- Add `ApiGatewayV2` and `StaticSite` components using AWS-generated domains.
- Add the thin health Lambda; keep its body in Lambda/API Gateway because it is JSON control data, never file bytes.
- Add the dashboard shell without product flows or secrets.
- Return only non-secret `apiUrl` and `dashboardUrl` SST outputs.

### Phase 4: Validation, Documentation, and Handoff

**Depends on:** Phases 1-3

Make every promised command reproducible, validate the complete local foundation, and update instructions only with commands that actually passed.

**Tasks:**

- Add/verify safe local development, test, coverage, type-check, lint, format, build, and SST preview scripts.
- Expand README with architecture map, stage names, external-action boundary, and canonical wiki links.
- Update AGENTS.md command section with observed results, not aspirational commands.
- Run application and existing Codex-layer validation; record any AWS-backed preview as not run unless it completes without deployment or unauthorized bootstrap.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order. RUS-01 runs alone because it establishes paths/contracts every later ticket inherits.

### 1. INITIALIZE local Git metadata and origin

- **IMPLEMENT**: Confirm again that `.git` is absent and GitHub is empty; run `git init -b main`, then add `origin` as `https://github.com/noamtz/utility-services.git`.
- **GOTCHA**: Preserve every existing AI-layer file. Do not fetch over the directory, commit, create/push a remote branch, or change GitHub settings; current viewer permission is read-only.
- **VALIDATE**: `git rev-parse --show-toplevel`
- **VALIDATE**: `git remote get-url origin`
- **SATISFIES**: AC2, AC9.

### 2. CREATE root workspace and exact dependency lock

- **IMPLEMENT**: Add private root `package.json` with npm workspaces `apps/*` and `packages/*`, `engines` for Node 24/npm 11, `packageManager`, exact direct dependency versions, and the root scripts defined under Validation Commands.
- **IMPLEMENT**: Add `package.json` files for dashboard, contracts, and backend with explicit dependency directions: dashboard/backend may depend on contracts; contracts depends on no workspace package; infra composes packages but domain packages never import infra.
- **GOTCHA**: Use TypeScript 6.0.3 until `typescript-eslint` supports 7; do not accept incompatible peer resolution with `--force` or `--legacy-peer-deps`.
- **VALIDATE**: `npm install`
- **VALIDATE**: `npm ls --all`
- **SATISFIES**: AC1, AC6.

### 3. CREATE strict TypeScript and quality configuration

- **IMPLEMENT**: Add root/base tsconfigs with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, modern ESM/Node settings, DOM only for dashboard, and project references for contracts/backend/dashboard/infra.
- **IMPLEMENT**: Add ESLint flat config, Prettier config/ignore, and Vitest projects for Node and jsdom; exclude `dist`, `.sst`, coverage, and generated SST types.
- **PATTERN**: `.agents/references/architecture-patterns.md:298-329` and `:571-595` (focused files, explicit dependencies, colocated tests).
- **VALIDATE**: `npm run typecheck`
- **VALIDATE**: `npm run format:check`
- **SATISFIES**: AC1, AC6, AC8.

### 4. CREATE Zod HTTP and health contracts

- **IMPLEMENT**: Add strict Zod schemas for success/error envelopes, field-level validation details, request IDs, and the health payload; export inferred types from `@utility-services/contracts`.
- **IMPLEMENT**: Reject/strip unexpected external fields deliberately and test the chosen behavior; keep transport schemas free of AWS types.
- **PATTERN**: `AGENTS.md:21` and `:52-53`; official Zod `safeParse` and inferred-type pattern.
- **GOTCHA**: Do not duplicate handwritten interfaces that can drift from schemas.
- **VALIDATE**: `npm test -- packages/contracts`
- **SATISFIES**: AC5, AC8.

### 5. CREATE request context, Powertools, and redaction seams

- **IMPLEMENT**: Instantiate Powertools Logger/Tracer/Metrics once per execution environment with a stable service name; derive correlation from API Gateway v2 `requestContext.requestId` and return `x-request-id`.
- **IMPLEMENT**: Add pure recursive redaction for sensitive keys and URL query strings. It must handle arrays/nested records, avoid mutation, and use bounded traversal to prevent pathological input from exhausting a Lambda.
- **GOTCHA**: Disable event payload logging and Powertools response capture where it could record future presigned URLs; CloudWatch masking is defense in depth, not the primary safeguard.
- **PATTERN**: `AGENTS.md:35-37`; `.agents/references/vertical-slice-architecture.md:268-420`.
- **VALIDATE**: `npm test -- packages/backend/src/core/observability`
- **SATISFIES**: AC5, AC8.

### 6. CREATE the validated Lambda handler adapter

- **IMPLEMENT**: Accept `unknown` boundary input, parse only declared path/query/header/body fields through supplied Zod schemas, invoke a thin callback, validate the response envelope, and centralize status/error mapping.
- **IMPLEMENT**: Map malformed external input to a stable safe 400 response with field details; map unknown failures to 500 `INTERNAL_ERROR`; never expose stack traces or raw exception messages.
- **GOTCHA**: Do not build feature auth, project context, or a generic service locator in this foundation.
- **PATTERN**: `.agents/references/backend-api-best-practices.md:14-26` and `:63-69`.
- **VALIDATE**: `npm test -- packages/backend/src/core/http`
- **SATISFIES**: AC5, AC8.

### 7. CREATE the thin `/v1/health` Lambda

- **IMPLEMENT**: Return the shared health success envelope using the handler adapter and authoritative request ID; log only safe start/completion fields.
- **IMPLEMENT**: Keep the health response free of versions, environment variables, AWS resource names, or internal dependency status that could aid reconnaissance.
- **GOTCHA**: The route is a control-plane JSON operation, not a file transfer path.
- **VALIDATE**: `npm test -- packages/backend/src/functions/health.test.ts`
- **SATISFIES**: AC4, AC5, AC8.

### 8. CREATE pure SST stage/application policy

- **IMPLEMENT**: Add and test stage classification for `production`, `pr-N`, and `dev-slug`; reject missing/unknown stages with an actionable error.
- **IMPLEMENT**: Return app name, AWS home/provider region `il-central-1`, production `removal: "retain"` and `protect: true`, and ephemeral `removal: "remove"`/unprotected values from a pure function consumed by `sst.config.ts`.
- **GOTCHA**: `protect` only blocks `sst remove`; `removal: "retain"` is the required future-data safety default when resource definitions change.
- **VALIDATE**: `npm test -- infra/config`
- **SATISFIES**: AC3, AC7, AC8.

### 9. CREATE the SST API and StaticSite composition

- **IMPLEMENT**: Add one `sst.aws.ApiGatewayV2`, route `GET /v1/health` to `packages/backend/src/functions/health.handler`, enable tracing, and add one `sst.aws.StaticSite` at `apps/dashboard` with `npm run build`/`dist`.
- **IMPLEMENT**: Use Node.js 24 explicitly if the pinned SST version does not default to it; return only complete AWS-generated API/dashboard URLs as outputs.
- **IMPLEMENT**: Do not add file buckets, tables, Cognito, custom domains, secrets, or placeholder independently deployed services.
- **GOTCHA**: Do not set secret values in StaticSite environment; any `VITE_*` value is browser-visible. If the shell receives `VITE_API_URL`, it may contain only the public API URL.
- **VALIDATE**: `npm run typecheck`
- **VALIDATE**: `npm test -- infra`
- **SATISFIES**: AC3, AC4, AC7, AC9.

### 10. CREATE the accessible React/Vite dashboard shell

- **IMPLEMENT**: Add a minimal semantic `main` with product name, foundation status, and a link to integration documentation/canonical wiki; use plain CSS local to the app and no design-system dependency.
- **IMPLEMENT**: Test rendering and accessible roles/text with Testing Library; add no login/project/file/usage behavior.
- **PATTERN**: `.agents/references/frontend-component-best-practices.md:7-42`.
- **GOTCHA**: No API key examples, real credentials, or sensitive environment placeholders in browser code.
- **VALIDATE**: `npm test -- apps/dashboard/src/App.test.tsx`
- **VALIDATE**: `npm run build --workspace @utility-services/dashboard`
- **SATISFIES**: AC1, AC4, AC8.

### 11. UPDATE ignores and developer documentation

- **IMPLEMENT**: Extend `.gitignore` for `node_modules/`, `dist/`, `coverage/`, `.sst/`, generated SST types/outputs, Vite caches, local environment files, and editor/OS noise while preserving `!.env.example` and Codex-log rules.
- **IMPLEMENT**: Expand README with product summary, canonical wiki links, physical layout/ownership, prerequisites, `npm ci`, safe local `npm run dev`, all quality commands, explicit `--stage` examples, and a boxed warning that `sst dev`/deploy and AWS/remote changes require authorization.
- **IMPLEMENT**: Explain that `npm run infra:diff -- --stage dev-<slug>` is preview-only and must stop if SST requests an unapproved bootstrap/write.
- **VALIDATE**: `npm run format:check`
- **SATISFIES**: AC1, AC6, AC9.

### 12. VERIFY and then UPDATE AGENTS.md commands

- **IMPLEMENT**: Run the full local validation matrix. Only after commands pass, replace `AGENTS.md:70` with the exact verified install/dev/test/typecheck/lint/format/build commands and retain the existing Codex-layer commands.
- **IMPLEMENT**: Record `infra:diff` as “requires AWS credentials; preview only; no deploy” and do not claim it was verified if it was skipped or attempted to bootstrap state.
- **GOTCHA**: Changing AGENTS.md requires a Codex restart after implementation; report that handoff explicitly.
- **VALIDATE**: `python tooling/validate_codex_layer.py`
- **VALIDATE**: `uv run --script tooling/mcp/codebase_search.py --self-test`
- **SATISFIES**: AC6, AC8, AC9.

### 13. RUN the final local quality gate

- **IMPLEMENT**: Execute every Level 1-3 command below from a clean `npm ci`; confirm no application artifact, secret, `.sst` state, or coverage/build output is accidentally staged.
- **IMPLEMENT**: Attempt `sst diff` only as an explicitly read-only preview with valid credentials and a non-production stage; if SST proposes state bootstrap or any write, stop and report it instead of proceeding.
- **VALIDATE**: `npm run check`
- **VALIDATE**: `git status --short`
- **SATISFIES**: AC1-AC9.

---

## TESTING STRATEGY

### Unit Tests

- Contracts: valid/invalid success and error envelopes, unknown fields, field-detail paths, health schema, inferred-type compile checks.
- HTTP adapter: valid parse/callback/response, malformed JSON/input, known versus unknown errors, status headers, authoritative request ID, no stack/internal leakage.
- Observability: recursive redaction across case variants, nested arrays/objects, authorization strings, complete URLs, query-only values, immutability, circular/depth protection, and no raw event logging.
- Stage/app config: every accepted stage shape, invalid/missing stages, `il-central-1`, production retain/protect, and ephemeral remove/unprotected policy.
- Dashboard: semantic render, accessible heading/main/link, and no credential or fabricated product flow.
- Health: exact validated response shape and request correlation.

Enforce 80% minimum statements/branches/functions/lines for RUS-01-owned source, with exclusions only for generated files and the declarative SST entry point. Prefer higher targeted coverage on redaction and envelopes because they become security/public-contract seams.

### Integration Tests

RUS-01 has no database or deployed AWS integration. Its local integration boundary is workspace resolution: backend imports contracts successfully, SST references the real handler path, StaticSite runs the dashboard build command, and root scripts exercise every package. `sst diff` is the infrastructure composition preview, not a deployment.

Do not fabricate mocked Cognito/S3/DynamoDB tests before their owning tickets. Reserve `tests/integration` for cross-package behavior added later.

### Edge Cases

- Missing, uppercase, empty, overlong, or punctuation-heavy stage names; `pr-0`; accidental `prod`/`main` aliases.
- Production removal/protection cannot be overridden by environment input.
- Request IDs missing from malformed test fixtures: generate a local safe fallback without trusting a request header.
- Validation details with nested paths and non-string values.
- Unknown thrown values (`string`, object, `Error`) all map to the same safe external 500 contract.
- Redaction key case variants, query/fragment URL leakage, arrays, `null`, non-plain objects, circular values, and bounded depth.
- Powertools tests outside Lambda/X-Ray must not require live AWS services.
- Dashboard build has no `VITE_*` secret and produces only static assets.
- Windows is SST beta: local npm/test/build must work in PowerShell; any SST CLI platform failure is reported, not worked around with deployment or WSL assumptions.

---

## VALIDATION COMMANDS

Execute from repository root. Do not run deployment commands.

### Level 0: Reproducible Install

```powershell
node --version
npm --version
npm ci
npm ls --all
```

Expected: Node 24/npm 11, clean peer dependency graph, exact lockfile reproduction.

### Level 1: Syntax & Style

```powershell
npm run format:check
npm run lint
npm run typecheck
```

### Level 2: Unit Tests and Coverage

```powershell
npm test
npm run test:coverage
```

### Level 3: Build and Local Infrastructure Validation

```powershell
npm run build
npm exec sst -- version
npm test -- infra/config
```

Optional read-only infrastructure preview with a non-production stage and configured AWS credentials:

```powershell
npm run infra:diff -- --stage dev-plan
```

Do not continue if SST asks to create/bootstrap remote state or otherwise write externally. Never substitute `sst deploy` or `sst dev` during this ticket without separate owner authorization.

### Level 4: Manual Local Validation

```powershell
npm run dev
```

- Open the printed Vite localhost URL.
- Confirm the accessible shell renders and contains no login/project/file/usage claims.
- Inspect browser assets/environment and confirm no credential or secret material exists.
- Invoke the health handler through its unit fixture/local function harness and confirm `/v1/health`’s exact envelope, `content-type`, and `x-request-id`; do not claim an AWS URL was exercised without an authorized deployment.

### Level 5: Existing Repository/AI Layer

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
git status --short
```

---

## ACCEPTANCE CRITERIA

- **AC1** [ ] One installable TypeScript npm workspace covers SST infrastructure, Lambda code, shared contracts, tests, and React/Vite dashboard with explicit package dependency directions.
- **AC2** [ ] The local directory is a Git checkout whose `origin` is `https://github.com/noamtz/utility-services.git`; all existing AI-layer files are preserved and no unauthorized remote branch/push occurred.
- **AC3** [ ] SST uses `il-central-1` and rejects stages outside deterministic `dev-*`, `pr-N`, and `production` naming.
- **AC4** [ ] One modular SST app defines an `sst.aws.StaticSite` dashboard and API Gateway HTTP API `GET /v1/health` Node.js Lambda; no file body/proxy path exists.
- **AC5** [ ] Zod is the documented schema library; external runtime input, success/error envelopes, request correlation, Powertools observability, and sensitive-value redaction seams have automated tests.
- **AC6** [ ] `npm ci`, local development, tests/coverage, type-check, lint, format, build, and infrastructure-preview commands are documented and only commands actually verified are recorded as verified in AGENTS.md/README.
- **AC7** [ ] Production app policy uses retained stateful-resource removal defaults and stage protection; tests prove ephemeral stages remain removable.
- **AC8** [ ] Automated tests explicitly cover stage/region policy, envelopes, validation failures, request IDs, health output, dashboard shell, and redaction, and the full local quality gate passes.
- **AC9** [ ] No AWS resource deployment/modification, credential creation, secret exposure, remote commit/branch, or push occurs without separate owner authorization.

---

## COMPLETION CHECKLIST

- [ ] Every step completed in order and its immediate validation passed.
- [ ] Direct dependency compatibility rechecked; no forced/legacy peer resolution.
- [ ] `package-lock.json` is reproducible with `npm ci`.
- [ ] Full format, lint, type-check, unit, coverage, and build suite passes.
- [ ] Infrastructure policy tests and, if safely available, read-only `sst diff` pass for a non-production stage.
- [ ] No deploy command was run and no AWS resource/state bootstrap was created without authorization.
- [ ] README and AGENTS.md contain truthful commands and canonical wiki links.
- [ ] Existing Codex-layer validation and codebase-search self-test still pass.
- [ ] No secrets, generated build/coverage/SST outputs, or unrelated files are staged.
- [ ] Owner is told to restart Codex because AGENTS.md changed.
- [ ] All AC1-AC9 are checked with evidence.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Scope assumption (resolved by canonical workflow):** The two input URLs describe the epic, but the linked delivery page says only RUS-01 is ready and later tickets are planned just in time. This plan therefore implements RUS-01 only. Planning all eleven tickets now would violate the wiki’s dependency policy and speculate about paths RUS-01 must first establish.
- **SST version assumption:** The architecture specifies SST components but no major version. The plan pins the registry’s current stable `sst@4.17.1` as of 2026-08-14 and requires an immediate compatibility recheck. Do not downgrade to v3 based solely on older migration terminology or adopt a newer major silently.
- **Toolchain assumption:** Node 24/npm 11 and TypeScript 6.0.3 are selected from the current environment/registry. TypeScript 7.0.2 is intentionally deferred because the selected `typescript-eslint` peer range is `<6.1.0`.
- **Schema decision:** Zod 4 is selected and is not an open implementation choice unless an incompatibility is demonstrated before coding. Changing it would alter a cross-cutting contract and should amend this plan.
- **Git fact:** The local directory has no `.git`; GitHub is empty with read-only viewer permission. Local initialization and remote configuration are in scope, but a remote default branch/commit/push needs explicit owner authorization and suitable credentials.
- **SST preview caveat:** Official `sst diff` is non-deploying, but a first run can still require credentials/state setup. Treat any requested external bootstrap/write as a stop condition; local tests remain the required validation in its absence.
- **Styling assumption:** Use small plain CSS for the shell because no existing styling strategy/design system exists. Selecting a UI framework is outside RUS-01.
- **No blocking product/architecture questions:** The approved architecture explicitly says none remain for MVP planning. The hard presigned-PUT size-enforcement and CloudTrail byte-metering caveats discovered during research belong to RUS-05/RUS-08 plans and must not expand RUS-01.

## NOTES (open canvas)

The repository’s generic VSA references are useful for physical organization but are Python/FastAPI examples, not project source. The TypeScript translation deliberately uses a small workspace modular monolith: contracts are cross-runtime, backend `core` is universal infrastructure, and later business capabilities become cohesive module slices. This preserves the architecture’s logical seams without creating independently deployed microservices or a premature package per bounded context.

The request-ID source is API Gateway’s generated `requestContext.requestId`, not a caller-provided header. That makes log correlation deterministic and prevents unbounded/malicious correlation values. A client correlation header can be added later only with strict validation and separate storage.

The health endpoint should prove the shared transport foundation, not become an operational dependency aggregator. Deep health checks would leak internals, add downstream cost, and turn availability of unrelated services into API health failures.

The production retention policy is intentionally established before stateful resources exist. SST documents that `protect` blocks `sst remove`, while `removal: "retain"` governs retained resources when configuration changes. Later tickets must also use component-level deletion protection where available and test it at their owning boundary.

## AMENDMENTS

(None at creation.)
