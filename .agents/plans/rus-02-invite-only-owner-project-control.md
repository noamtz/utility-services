# Feature: RUS-02 Invite-Only Owner Identity and Project Control

The following plan is complete, but implementation must revalidate official documentation, installed SST/Pulumi types, repository state, and task sanity before changing files. Pay particular attention to the generated SST component signatures, Cognito access-token claims, DynamoDB key construction, CloudFront control-route forwarding, and the strict separation between trusted owner context and caller-controlled project identifiers.

## Feature Description

Deliver the first product behavior on the RUS-01 application foundation: an invited dashboard owner can authenticate through an invite-only Amazon Cognito User Pool, establish and end a browser session, and create, list, and inspect owner-only projects with File Management enabled. Each project receives separate opaque internal and public identifiers and stores independent upload/download URL lifetimes bounded to 1–60 minutes with 15/5 minute defaults.

The work establishes the durable identity/control seam that RUS-03 project credentials and RUS-04 usage/pricing will consume. It does not implement project API keys, file operations, usage metering, deployment, or Cognito user creation.

## User Story

As an invited utility-services owner,
I want to sign in and manage my File Management projects in a dashboard,
so that I can establish an isolated project boundary for a later server-side integration.

## Problem Statement

RUS-01 supplies a modular SST/TypeScript foundation, a public health route, shared validated HTTP envelopes, and a static dashboard shell, but it has no owner identity, authenticated control route, persistent project model, or project UI. Without an authoritative Cognito-owner seam and a stable project contract, later credentials, files, usage, and quota logic cannot safely attribute actions to a project or prevent cross-owner access.

## Solution Statement

Extend the modular SST application with:

- an email-sign-in Cognito User Pool that permits only administrator-created users and a public SPA client with no client secret;
- an API Gateway HTTP API JWT authorizer on `/v1/control/projects` routes while leaving `/v1/health` public;
- a first `identity-control` backend vertical slice whose only owner source is the validated Cognito access-token `sub` claim;
- a linked on-demand core/control DynamoDB table holding project metadata and a separate enabled-utility item under each project partition;
- shared Zod contracts for create, paginated list, and inspect operations;
- an Amplify v6 browser adapter for sign-in, required-new-password challenge, session restoration, access-token retrieval, and sign-out;
- an accessible minimal project dashboard; and
- a proposed same-origin dashboard control path, subject to explicit owner approval before implementation: the existing StaticSite CloudFront distribution forwards only `v1/control/*` to API Gateway with caching disabled and the `Authorization` header preserved. This avoids wildcard CORS and a generated-domain dependency cycle. It is not CloudFront file delivery: future file bytes remain direct S3 transfers, and the standalone API Gateway URL remains available for REST consumers.

## Out of Scope / Non-Goals

- Not included: public sign-up, a sign-up link, teams, roles, sharing, organizations, or owner changes.
- Not included: an invitation-management/admin UI, automated user seeding, or creating/sending a Cognito invitation. Operators use Cognito `AdminCreateUser` only after separate authorization.
- Not included: project API-key issuance, hashing, authentication, replacement, or revocation (RUS-03).
- Not included: file metadata, S3 buckets, upload/download authorization, public-file delivery, trash/purge, quotas, or file bytes through the control path (RUS-05 through RUS-08).
- Not included: usage/pricing data or dashboard cost presentation (RUS-04, RUS-08, and RUS-09).
- Not included: custom domains, hosted Cognito UI/OAuth redirects, social identity providers, MFA, browser/mobile project credentials, or dedicated SDKs.
- Not included: production deployment, non-production deployment, AWS bootstrap, AWS resource mutation, Cognito user creation, or credential creation without separate explicit owner authorization.
- Not changing: `/v1/health` remains public; shared REST envelopes, redaction, Node.js 24, `il-central-1`, one modular SST application, and AWS-generated domains remain intact.

## Feature Metadata

**Feature Type**: New Capability

**Estimated Complexity**: High

**Primary Systems Affected**: Cognito identity infrastructure, API Gateway control authorization, core/control DynamoDB persistence, backend HTTP/auth seam, identity-control vertical slice, shared project contracts, React/Vite authentication and project UI, boundary/integration tests

**Dependencies**: implemented RUS-01 foundation; SST 4.17.1; AWS provider 7.43.0; Node.js 24; TypeScript 6; Zod 4.4.3; React 19; Vite 8; Vitest 4; `aws-amplify` 6.20.0; AWS SDK v3 DynamoDB client/document client 3.1116.0

## Related Work

**Implements**: [RUS-02 / GitHub issue #2](https://github.com/noamtz/utility-services/issues/2) · **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) · **Architecture**: [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture)

**Back-references**:

- `.agents/plans/rus-01-deployable-application-foundation.md` - Establishes the physical workspace, strict TypeScript/Zod patterns, SST composition, shared handler/envelope contract, test toolchain, and external-action guardrails inherited here.
- [RUS-01 PR #13](https://github.com/noamtz/utility-services/pull/13) - Merged implementation baseline. The current HEAD tree matches `origin/main` even though the local branch name still references RUS-01.
- [MVP Ticket Breakdown](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown#rus-02--deliver-invite-only-owner-identity-and-project-control) - Defines RUS-02 scope, dependency, acceptance criteria, and downstream seams.

**Forward-references**:

- RUS-03 must consume the project record/internal project context and enabled-utility contract without authorizing from a public project ID.
- RUS-04 must consume the stable project boundary without coupling pricing/usage entities to the control table.
- RUS-09 will expand the minimal dashboard while reusing the auth/session and project API adapters created here.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` (lines 7-17) - Canonical wiki policy and required logical boundaries. Line 13 is stale after RUS-01 and must be corrected near completion.
- `AGENTS.md` (lines 19-39) - Modular SST, TypeScript, region, state-retention, on-demand DynamoDB, owner identity, project isolation, and lifetime invariants.
- `AGENTS.md` (lines 51-67) - `/v1` route separation, safe envelopes, security release blockers, testing, and external-action limits.
- `AGENTS.md` (lines 69-106) - Verified local/full-quality/infra commands and the prohibition on bypassing the stage wrapper.
- `sst.config.ts` (lines 20-30) - Current API/dashboard composition and output wiring to extend in dependency order.
- `infra/config/app.ts` (lines 3-37) - `il-central-1`, pinned provider, and production `removal: "retain"` plus `protect: true` policy.
- `infra/api.ts` (lines 1-26) - Existing stable route-constant and API composition pattern; preserve public health while adding a JWT authorizer and protected control routes.
- `infra/dashboard.ts` (lines 1-12) - Existing StaticSite configuration to extend with public Cognito build variables and the narrow same-origin control route.
- `infra/composition.test.ts` (lines 1-26) - Pure infrastructure-contract tests that do not instantiate SST components.
- `infra/sst-globals.d.ts` (lines 1-33) - Narrow committed SST declarations that keep local type-checking independent of generated `.sst` artifacts; extend only for used Cognito, Dynamo, authorizer, linking, environment, and CDN transform APIs.
- `packages/contracts/src/http/envelope.ts` (lines 3-35) - Strict Zod schema-first success/error envelope pattern.
- `packages/contracts/src/index.ts` (lines 1-15) - Public contract export boundary to extend.
- `packages/backend/README.md` (lines 1-8) - `src/core` versus `src/modules/<bounded-context>` ownership and thin function-entry rules.
- `packages/backend/src/core/http/handler.ts` (lines 23-55) - Current parsed-request and safe `HttpError` model.
- `packages/backend/src/core/http/handler.ts` (lines 57-105, 174-246) - API Gateway event validation, handler options, centralized response/error flow, and the two narrow extensions needed: derived authorization context and configurable success status.
- `packages/backend/src/core/http/handler.test.ts` (lines 27-138) - Behavior-first tests for request parsing, safe errors, output validation, and request IDs.
- `packages/backend/src/core/observability/redact.ts` (lines 1-90) - Existing sensitive-key/query redaction; authentication tests must confirm bearer tokens and claims never enter logs.
- `packages/backend/src/functions/health.ts` (lines 1-10) - Thin Lambda entry pattern to mirror for each control route.
- `apps/dashboard/src/main.tsx` (lines 1-16) - Existing React root where the session provider may be mounted.
- `apps/dashboard/src/App.tsx` (lines 1-19) - Foundation shell to replace with session-gated product composition.
- `apps/dashboard/src/App.test.tsx` (lines 1-30) - Current accessible behavior/security assertions to preserve and update.
- `apps/dashboard/vite.config.ts` (lines 1-6) - Existing Vite configuration; production calls stay relative, while any local proxy must be explicit and never contain secrets.
- `vitest.config.ts` (lines 4-48) - Node/jsdom projects and 80% statement/branch/function/line thresholds.
- `package.json` (lines 15-28) - Verified scripts every task must reuse rather than inventing new command names.
- `README.md` (lines 27-86) - Safe local workflow and infrastructure-preview/deployment guardrails; update product-status text without duplicating the canonical wiki.
- `.agents/references/backend-api-best-practices.md` (lines 7-69) - Thin resource routes, validated inputs, centralized errors, auth separation, pagination, and route tests. Root policy wins on route prefix: use `/v1/control`, not `/api/v1`.
- `.agents/references/frontend-component-best-practices.md` (lines 7-42) - Focused components, accessible interactions, and behavior-led jsdom tests.
- `.agents/references/vertical-slice-architecture.md` (lines 231-420, 1009-1049) - Request correlation, auth as an explicit boundary, cohesive feature tests, and separation of unit versus cross-slice integration tests. Translate the examples to TypeScript/Lambda.
- `.agents/plans/rus-01-deployable-application-foundation.md` (lines 213-285, 327-402) - Established package ownership, Zod/handler/logging conventions, stage policy, tests, and deferred CORS/auth decisions.

### Existing Files to Update

- `package.json`, `package-lock.json` - Add exact browser/auth and backend DynamoDB runtime dependencies through their owning workspaces; preserve exact-version lock discipline.
- `packages/backend/package.json` - Add `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, and `sst` runtime linking at the versions already pinned/researched.
- `apps/dashboard/package.json` - Add `aws-amplify` only; do not add a second UI, routing, or state framework.
- `packages/contracts/src/index.ts` - Re-export project/control schemas and inferred types.
- `packages/backend/src/core/http/handler.ts`, `packages/backend/src/core/http/handler.test.ts` - Add a generic derived authorization-context hook and fixed successful status code (201 for create, 200 otherwise) while preserving existing behavior.
- `infra/api.ts`, `infra/dashboard.ts`, `infra/composition.test.ts`, `infra/sst-globals.d.ts`, `sst.config.ts` - Compose identity/control resources, table linking, authorizer-protected routes, same-origin control forwarding, outputs, and pure policy tests.
- `vitest.config.ts` - Discover root `tests/**/*.test.ts` in the Node project and both `.test.ts`/`.test.tsx` dashboard tests so every planned security test runs under `npm test` and `npm run check`.
- `apps/dashboard/src/main.tsx`, `apps/dashboard/src/App.tsx`, `apps/dashboard/src/App.test.tsx`, `apps/dashboard/src/styles.css`, `apps/dashboard/src/vite-env.d.ts` - Replace the shell with accessible auth/project composition and public configuration types.
- `README.md` - Describe the implemented RUS-02 local/authenticated flow and explicitly state that live Cognito use requires a separately authorized stage and administrator-created user.
- `AGENTS.md` - Correct the stale “application code has not been scaffolded” statement and keep the repository map/commands truthful; do not change approved architecture.

### New Files to Create

Shared contracts:

- `packages/contracts/src/projects/contract.ts` - Strict public create/list/inspect schemas, File Management settings, project IDs, list cursor/limit, and response payload types.
- `packages/contracts/src/projects/contract.test.ts` - Defaults, bounds, strictness, public-shape, and internal-field exclusion tests.

Backend identity/control slice:

- `packages/backend/src/modules/identity-control/auth/owner-context.ts` - Extract and validate `requestContext.authorizer.jwt.claims`, require `token_use: "access"`, and return only immutable Cognito `sub` as trusted owner context.
- `packages/backend/src/modules/identity-control/auth/owner-context.test.ts` - Missing/malformed/ID-token/access-token and no-caller-override cases.
- `packages/backend/src/modules/identity-control/projects/model.ts` - Internal project, metadata item, enabled-utility item, key, and Dynamo read-validation schemas.
- `packages/backend/src/modules/identity-control/projects/model.test.ts` - Strict item validation, key construction, and corrupt-record tests.
- `packages/backend/src/modules/identity-control/projects/ids.ts` - Injectible internal/public opaque ID generation using Node cryptographic randomness; public IDs use a non-authorizing `prj_` prefix.
- `packages/backend/src/modules/identity-control/projects/ids.test.ts` - Independent ID format, entropy-source injection, and no-caller-ID tests.
- `packages/backend/src/modules/identity-control/projects/cursor.ts` - Strict opaque list cursor encoding/decoding that contains only public project ID and creation time; owner keys are always reconstructed from trusted context.
- `packages/backend/src/modules/identity-control/projects/cursor.test.ts` - Round-trip, malformed/tampered, and cross-owner reconstruction tests.
- `packages/backend/src/modules/identity-control/projects/repository.ts` - Project repository interface and AWS DocumentClient adapter using transaction/conditional create, owner-index query, and strongly consistent project-partition inspection.
- `packages/backend/src/modules/identity-control/projects/repository.test.ts` - Dynamo command/key/condition/pagination/read-validation tests with a stubbed document client.
- `packages/backend/src/modules/identity-control/projects/service.ts` - Create/list/inspect orchestration, ID/time injection, mappings to public contracts, safe collision retry, and same-404 wrong-owner behavior.
- `packages/backend/src/modules/identity-control/projects/service.test.ts` - Owner isolation, defaults/bounds, collision, cursor, ordering, and internal-field exclusion tests using an in-memory repository fake.
- `packages/backend/src/modules/identity-control/projects/handlers.ts` - Three shared handler factories connecting contracts, owner extraction, service operations, safe envelopes, and status codes.
- `packages/backend/src/modules/identity-control/projects/handlers.test.ts` - Assembled handler tests for authenticated happy paths, malformed input, absent/wrong token type, wrong owner, and safe responses/logs.
- `packages/backend/src/modules/identity-control/projects/runtime.ts` - Process-level DynamoDB client/document client, linked table lookup, repository, and service construction; no business logic.
- `packages/backend/src/functions/control/create-project.ts`, `list-projects.ts`, `inspect-project.ts` - Thin deployed entries exporting the runtime-composed handlers.

Infrastructure:

- `infra/config/control.ts`, `infra/config/control.test.ts` - Pure, testable logical names, route/auth config, admin-only Cognito transform policy, Dynamo key/index policy, production deletion-protection policy, and CloudFront control-origin behavior constants.
- `infra/control.ts` - Cognito pool/client and core/control Dynamo component construction; return typed handles for API/dashboard composition.

Dashboard:

- `apps/dashboard/src/config.ts`, `config.test.ts` - Validate only public Cognito pool/client build variables; reject missing or malformed runtime configuration without exposing values.
- `apps/dashboard/src/auth/auth-client.ts`, `auth-client.test.ts` - Configure Amplify for the existing pool and wrap `signIn`, `confirmSignIn`, `fetchAuthSession`, `getCurrentUser`, and `signOut`; return the access token only to the API adapter.
- `apps/dashboard/src/auth/AuthProvider.tsx`, `AuthProvider.test.tsx` - Session restore/sign-in/new-password/sign-out state machine with no self-sign-up path.
- `apps/dashboard/src/auth/SignInForm.tsx`, `SignInForm.test.tsx` - Accessible email/password and required-new-password interactions with generic safe error text.
- `apps/dashboard/src/projects/api.ts`, `api.test.ts` - Same-origin `/v1/control/projects` client, bearer access-token injection, strict response-envelope parsing, pagination, and safe error mapping.
- `apps/dashboard/src/projects/CreateProjectForm.tsx`, `CreateProjectForm.test.tsx` - File Management-only form and independent bounded lifetime inputs defaulted to 15/5.
- `apps/dashboard/src/projects/ProjectList.tsx`, `ProjectList.test.tsx` - Loading/empty/error/list/selection and cursor behavior.
- `apps/dashboard/src/projects/ProjectDetails.tsx`, `ProjectDetails.test.tsx` - Owner-visible public project ID, enabled utility, and URL lifetime presentation; no internal ID or owner subject.
- `apps/dashboard/src/projects/ProjectView.tsx`, `ProjectView.test.tsx` - Authenticated create/list/inspect orchestration and refresh after create.

Cross-boundary validation:

- `tests/integration/owner-project-control.test.ts` - Two-owner handler/service/repository-fake flows proving list and inspect isolation, malformed/unauthenticated denial, token-claim precedence, and public-response secrecy.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [SST CognitoUserPool](https://sst.dev/docs/component/aws/cognito-user-pool/#constructor)
  - Specific sections: email usernames, `addClient`, and `transform.userPool`.
  - Why: create the pool/client using the pinned SST API while applying the underlying admin-create-only Cognito setting.
- [SST CognitoUserPoolClient](https://sst.dev/docs/component/aws/cognito-user-pool-client/)
  - Specific sections: client construction and transform.
  - Why: create a public browser client with SRP/refresh flows and no client secret.
- [SST ApiGatewayV2 authorizers and routes](https://sst.dev/docs/component/aws/apigatewayv2/#addauthorizer)
  - Specific sections: `addAuthorizer`, JWT issuer/audience, route `auth`, and route scopes.
  - Why: preserve a public health route and apply Cognito JWT authorization only to control routes.
- [SST Dynamo](https://sst.dev/docs/component/aws/dynamo/#dynamoargs)
  - Specific sections: `fields`, `primaryIndex`, `globalIndexes`, `deletionProtection`, and resource linking.
  - Why: define the on-demand core/control table and grant only linked functions runtime access.
- [SST StaticSite environment and CDN transform](https://sst.dev/docs/component/aws/static-site/#environment)
  - Specific sections: browser-visible `VITE_` values and `transform.cdn`.
  - Why: inject only public Cognito IDs and forward the narrow same-origin control path without exposing secrets or requiring wildcard CORS.
- [SST app removal policy](https://sst.dev/docs/reference/config/#removal)
  - Why: distinguish production resource retention from DynamoDB deletion protection; apply both deliberately.
- [Cognito admin-create-only user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-admin-create-user-policy.html#user-pool-settings-admin-create-user-policy-admin-create-user-api)
  - Why: `AllowAdminCreateUserOnly` disables public `SignUp` and makes administrator invitation the sole enrollment path.
- [Cognito AdminCreateUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html)
  - Specific sections: invitation message action and `FORCE_CHANGE_PASSWORD` state.
  - Why: the dashboard must handle an invited user's required-new-password challenge, while the implementation must not create users itself.
- [API Gateway HTTP API JWT authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html#http-api-jwt-authorizer-authorizing-requests)
  - Why: documents issuer/audience/time/signature validation and the Lambda claims location.
- [Cognito access-token claims](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
  - Why: API Gateway audience validation alone can also match an ID token; require `token_use: "access"` before deriving owner `sub`.
- [DynamoDB key-condition queries](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.KeyConditionExpressions.html)
  - Why: list projects by the owner GSI with a key condition and pagination, never Scan plus filter.
- [DynamoDB conditional expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
  - Why: make project/utility creation atomic and collision-safe.
- [Amplify with existing Cognito resources](https://docs.amplify.aws/react/build-a-backend/auth/use-existing-cognito-resources/)
  - Why: configure `aws-amplify` directly from SST-created pool/client IDs without an Amplify backend or identity pool.
- [Amplify Auth v6 migration/session APIs](https://docs.amplify.aws/gen1/react/build-a-backend/auth/auth-migration-guide/)
  - Specific sections: `signIn`, `confirmSignIn`, `getCurrentUser`, and `fetchAuthSession`.
  - Why: use supported functional APIs and retrieve `tokens.accessToken`; do not use deprecated `Auth.currentSession`.
- [Amplify sign-out](https://docs.amplify.aws/react/frontend/auth/sign-out/)
  - Why: clear the browser session and return the UI to the unauthenticated state.
- [CloudFront forwarding the Authorization header](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html#add-origin-custom-headers-forward-authorization)
  - Why: a zero-TTL custom cache policy must include `Authorization` so it reaches API Gateway; use exact header/query allowlists and forward no cookies.

### Patterns to Follow

**Physical ownership:**

```text
packages/contracts/src/projects                    public runtime schemas
packages/backend/src/modules/identity-control      owner/project domain slice
packages/backend/src/functions/control             thin Lambda entries
infra/config/control.ts                            pure/testable infra policy
infra/control.ts                                   Cognito + core/control Dynamo resources
apps/dashboard/src/auth                            browser identity/session adapter
apps/dashboard/src/projects                        project UI/API slice
tests/integration                                  assembled cross-owner behavior
```

Do not create global `controllers/`, `services/`, or `repositories/` directories. Do not import `infra` from backend runtime code. Only the resource-link name crosses the infrastructure/runtime seam.

**Public project contract:**

```ts
type FileManagementSettings = {
  uploadUrlLifetimeMinutes: number;   // integer 1..60, default 15
  downloadUrlLifetimeMinutes: number; // integer 1..60, default 5
};

type Project = {
  projectId: `prj_${string}`; // public opaque identifier; never sufficient authorization
  name: string;
  enabledUtilities: ["file-management"];
  fileManagement: FileManagementSettings;
  createdAt: string;
  updatedAt: string;
};
```

Create accepts `name`, exactly `enabledUtilities: ["file-management"]`, and optional bounded File Management settings. Create/inspect return the full public project shape. List returns summaries plus an optional opaque cursor; it need not fetch utility settings for every list row because inspect owns details. Never return `internalProjectId`, Cognito `sub`, Dynamo keys/indexes, table names, or raw AWS errors.

**DynamoDB item/access pattern:**

```text
Project metadata
  PK       = PROJECT#<publicProjectId>
  SK       = METADATA
  GSI1PK   = OWNER#<verifiedCognitoSub>
  GSI1SK   = PROJECT#<createdAt>#<publicProjectId>
  fields   = internalProjectId, publicProjectId, ownerId, name,
             enabledUtilities, createdAt, updatedAt

Enabled utility
  PK       = PROJECT#<publicProjectId>
  SK       = UTILITY#file-management
  fields   = utility, uploadUrlLifetimeMinutes,
             downloadUrlLifetimeMinutes, createdAt, updatedAt
```

- Create both items in one `TransactWrite` with `attribute_not_exists(PK)` conditions.
- List with `Query` on `GSI1PK = OWNER#<trusted owner>`; use descending `GSI1SK`, a bounded limit (default 20, maximum 50), and validated pagination.
- Inspect with a strongly consistent primary-partition `Query`, validate both item schemas, then require metadata `ownerId` to equal trusted owner context. Missing and wrong-owner both map to the same `404 NOT_FOUND` envelope.
- Cursor contents are only `{projectId, createdAt}`; reconstruct the owner index key exclusively from trusted owner context so tampering cannot move a query to another owner.
- `internalProjectId` is an opaque UUID generated server-side for downstream storage/usage identity. `publicProjectId` is independently generated with cryptographic randomness and a `prj_` prefix. Neither ID is authorization.

**Authentication flow:**

```text
Admin-created Cognito user
  -> Amplify signIn (email + temporary/current password)
  -> confirmSignIn(new password) when Cognito requires it
  -> fetchAuthSession().tokens.accessToken
  -> Authorization: Bearer <access token>
  -> API Gateway JWT issuer/audience validation
  -> Lambda requires claims.token_use === "access"
  -> OwnerContext { ownerId: claims.sub }
  -> owner-scoped service/repository operation
```

Do not parse a caller `Authorization` header in domain code, accept an `ownerId` header/body/path value, use an ID token for API authorization, or log the token/claims object. API Gateway's pre-Lambda 401 may use its native minimal error body; Lambda-owned failures use the shared envelope.

**Control-plane browser routing:**

- Keep API Gateway CORS disabled.
- CloudFront forwards only `v1/control/*` to the API Gateway origin using HTTPS.
- Use a custom cache policy with minimum/default/maximum TTL all set to zero. Whitelist only `Authorization` and `Content-Type` headers plus `limit` and `cursor` query strings; forward no cookies. Including `Authorization` in the zero-TTL cache policy both forwards it and prevents any accidental authenticated caching.
- Permit the methods needed by this ticket (`GET`, `POST`, `HEAD`, `OPTIONS`) at minimum; do not use a wildcard path, origin, method, or header policy.
- The SPA calls relative `/v1/control/...`; do not bake a second API base URL into browser code.
- Never route future S3 file bytes through this behavior. Public utility APIs remain on API Gateway and direct transfer URLs remain opaque.

**HTTP and error semantics:**

- `POST /v1/control/projects` -> `201` success envelope.
- `GET /v1/control/projects?limit=20&cursor=...` -> `200` paginated success envelope.
- `GET /v1/control/projects/{projectId}` -> `200` success envelope.
- Boundary/schema failure -> `400 VALIDATION_ERROR`.
- Missing/malformed/non-access owner context reaching Lambda -> `401 UNAUTHORIZED`.
- Missing or wrong-owner project -> identical `404 NOT_FOUND`.
- Conditional collision after bounded regeneration retries -> safe `500 INTERNAL_ERROR`; never expose DynamoDB details.

**Testing:**

Co-locate unit/component tests. Use repository fakes for domain behavior and a stubbed DocumentClient for exact Dynamo commands—do not require AWS for unit tests. The root integration test assembles handlers, real services, and an in-memory repository for two owners. Infra tests assert pure exported policies; an authorized non-production preview is the synthesis/composition gate. Maintain the global 80% coverage thresholds.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts and Universal HTTP Seam

Pin the two new runtime dependency groups, define the public project contract, and extend the existing handler only enough to carry a derived trusted authorization context and a fixed successful status code.

**Tasks:**

- Add exact workspace dependencies and regenerate the lockfile.
- Add strict project/create/list/inspect Zod contracts.
- Add generic `authorization` derivation and `successStatusCode` options to `createHttpHandler` with regression tests.

### Phase 2: Identity-Control Domain and Persistence

**Depends on:** Phase 1 (uses shared contracts and authorization-capable handler)

Implement trusted Cognito owner extraction, project item/key/cursor schemas, DynamoDB repository behavior, and the project service. Keep AWS composition outside the domain.

**Tasks:**

- Validate access-token claims and expose only `OwnerContext`.
- Implement independent cryptographic identifiers and opaque cursors.
- Implement transactional create, owner-index list, and strongly consistent inspect.
- Implement service mappings, safe errors, isolation, and internal-field exclusion.

### Phase 3: Protected Control API and AWS Resources

**Depends on:** Phase 2 (routes need real handlers/repository contract)

Create the invite-only Cognito pool/client, core/control table, runtime linking, JWT authorizer, and three protected routes while retaining the public health route and production retention guarantees.

**Tasks:**

- Add pure tested identity/control infrastructure policy.
- Add Cognito and Dynamo resources.
- Add runtime construction and thin function entries.
- Register protected control routes and outputs.

### Phase 4: Authenticated Dashboard

**Depends on:** Phase 1 contracts and Phase 3 public Cognito/control configuration

Implement Amplify authentication/session behavior and a minimal accessible create/list/inspect UI. Route browser control calls through the same StaticSite origin with caching disabled.

**Tasks:**

- Add validated public browser configuration and Amplify adapter.
- Implement sign-in, required-new-password, session restore, and sign-out states.
- Implement authenticated API adapter and project UI components.
- Add the narrow CloudFront control origin/behavior and keep API CORS disabled.

### Phase 5: Security Integration, Documentation, and Validation

**Depends on:** Phases 1–4

Prove two-owner isolation and safe failure behavior locally, update stale repository guidance, run the full quality suite, and preview infrastructure only under the existing external-action guardrails.

**Tasks:**

- Add assembled cross-owner integration tests.
- Update README/AGENTS facts and validate the Codex layer because `AGENTS.md` changes.
- Run format, lint, typecheck, unit/integration tests, coverage, and build.
- Generate SST types and perform an authorized non-production diff; do not deploy.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. UPDATE workspace dependency manifests and `package-lock.json`

- **IMPLEMENT**: Add exact `aws-amplify@6.20.0` to `@utility-services/dashboard`; add exact `@aws-sdk/client-dynamodb@3.1116.0`, `@aws-sdk/lib-dynamodb@3.1116.0`, and `sst@4.17.1` to `@utility-services/backend`. Use workspace-aware npm commands and commit the regenerated lockfile.
- **PATTERN**: `package.json:31-58`, `packages/backend/package.json:1-13`, and `apps/dashboard/package.json:1-16` use exact direct versions.
- **GOTCHA**: Do not add Amplify UI, React Router, a second schema library, a DynamoDB ORM, or test-only AWS emulators. Re-check `npm view` and peer compatibility immediately before install; change versions only for a documented incompatibility.
- **VALIDATE**: `npm ci`
- **SATISFIES**: Enables AC 1–4 using the inherited stack without unplanned frameworks.

### 2. CREATE `packages/contracts/src/projects/contract.ts` and test; UPDATE exports

- **IMPLEMENT**: Define strict schemas/types for public project ID, project name (trimmed 1–100 Unicode characters), exactly one `file-management` utility, independent integer lifetime settings 1–60 with 15/5 defaults, create request, list query (default 20/max 50), project summary/detail, cursor, and response payloads.
- **PATTERN**: Mirror strict schema-first/inferred-type structure from `packages/contracts/src/health/contract.ts:1-8` and envelope exports from `packages/contracts/src/index.ts:1-15`.
- **GOTCHA**: Defaults must exist in parsed output; reject unknown properties and non-integers. Public schemas must not contain `ownerId`, `internalProjectId`, Dynamo keys, or table fields.
- **VALIDATE**: `npm test -- --project node packages/contracts/src/projects/contract.test.ts`
- **SATISFIES**: AC 3–5 and AC 8 malformed-input behavior.

### 3. UPDATE `packages/backend/src/core/http/handler.ts` and tests

- **IMPLEMENT**: Add an optional generic authorization-context derivation callback that receives the already schema-validated gateway event and places only its returned value on `ParsedHttpRequest.authorization`. Add `successStatusCode` constrained to 200–299, defaulting to 200, and use it consistently in response/logging.
- **PATTERN**: Preserve centralized parse/error/output validation at `handler.ts:174-246`; mirror current `HttpError` handling at lines 36-55.
- **GOTCHA**: Never expose the raw event or raw authorizer claims to domain callbacks. Authorization derivation errors must pass through the same safe envelope/log path. Existing health behavior and tests must remain byte-for-byte compatible at status 200.
- **VALIDATE**: `npm test -- --project node packages/backend/src/core/http/handler.test.ts packages/backend/src/functions/health.test.ts`
- **SATISFIES**: AC 4, AC 6, and safe AC 8 errors.

### 4. CREATE trusted Cognito owner-context extraction

- **IMPLEMENT**: Validate the API Gateway v2 `requestContext.authorizer.jwt.claims` shape, require non-empty `sub` and literal `token_use: "access"`, and return `{ownerId: sub}`. Map absent/malformed/non-access context to one safe 401 error.
- **PATTERN**: Zod `safeParse` plus `HttpError` from `packages/backend/src/core/http/handler.ts:36-55`; no raw-event logging.
- **GOTCHA**: Audience/issuer/signature are API Gateway responsibilities, but API Gateway can accept a matching Cognito ID token when no scope distinguishes it; the Lambda check is mandatory. Ignore caller headers/body/path values named `ownerId`, `sub`, or similar.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/auth/owner-context.test.ts`
- **SATISFIES**: AC 1, AC 6, and AC 8 unauthenticated denial.

### 5. CREATE project model, ID, and cursor primitives

- **IMPLEMENT**: Define strict domain/Dynamo item schemas and deterministic key constructors; add independently generated internal UUID and `prj_` public ID factories; add validated cursor encoding/decoding using only public project ID/created time.
- **PATTERN**: Use Node `crypto` as in `request-context.ts:1-22`; inject ID/time factories for deterministic tests.
- **GOTCHA**: Never accept caller IDs for creation, serialize owner subject/internal ID into the cursor, or treat cursor/project ID as authorization. Item reads from DynamoDB are external runtime input and must be parsed before use.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/projects/model.test.ts packages/backend/src/modules/identity-control/projects/ids.test.ts packages/backend/src/modules/identity-control/projects/cursor.test.ts`
- **SATISFIES**: AC 3, AC 5, and AC 6.

### 6. CREATE the project repository interface and DynamoDB adapter

- **IMPLEMENT**: Add transactional project+utility creation with conditional nonexistence; owner-index query with descending order/limit/pagination; strongly consistent project-partition query for inspect; strict item mapping; and explicit dependency injection for document client/table name.
- **PATTERN**: Cohesive repository in the identity-control slice per `packages/backend/README.md:3-8`; owner query follows the approved GSI access pattern.
- **IMPORTS**: `DynamoDBClient`, `DynamoDBDocumentClient`, `TransactWriteCommand`, and `QueryCommand` from modular AWS SDK v3 packages.
- **GOTCHA**: Never Scan, filter after an unscoped query, interpolate expressions unsafely, trust an owner value from a cursor, or log Dynamo request/items. Keep AWS conditional failures distinguishable internally for bounded ID collision retry but never expose them.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/projects/repository.test.ts`
- **SATISFIES**: AC 3–6 and AC 8, especially owner-scoped list/inspect.

### 7. CREATE the project service and unit tests

- **IMPLEMENT**: Orchestrate create/list/inspect from trusted owner context; apply parsed defaults; generate both IDs/timestamps server-side; retry rare public-ID collisions a bounded number of times; map items to public summaries/details; map missing and wrong-owner to the identical safe 404.
- **PATTERN**: Thin handler/domain split from `.agents/references/backend-api-best-practices.md`; inject repository, ID, and clock dependencies explicitly.
- **GOTCHA**: Project name uniqueness is not required. List only the derived owner's GSI partition. Inspect may load a public project partition but must compare owner before returning any data. Do not pass Dynamo items to response schemas.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/projects/service.test.ts`
- **SATISFIES**: AC 3–6 and AC 8.

### 8. CREATE control handler factories and thin Lambda entries

- **IMPLEMENT**: Compose create/list/inspect schemas, authorization extraction, project service callbacks, status 201/200, safe logger, linked Dynamo runtime, and three thin function exports under `src/functions/control`.
- **PATTERN**: Mirror `packages/backend/src/functions/health.ts:1-10`; centralize shared construction in slice `runtime.ts` rather than duplicating clients per entry file.
- **IMPORTS**: `Resource` from `sst` only in runtime construction; business/domain files remain unaware of SST or infra.
- **GOTCHA**: Validate linked table name before client use, reuse process-level AWS clients, and do not log tokens, claims, owner subjects, request bodies, or Dynamo keys.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/projects/handlers.test.ts`
- **SATISFIES**: AC 4, AC 6, and AC 8.

### 9. CREATE identity/control infrastructure policy and resources

- **IMPLEMENT**: Add pure constants/policies and SST construction for: email username Cognito pool; underlying `adminCreateUserConfig.allowAdminCreateUserOnly = true`; public web client with no secret and SRP/refresh flows; on-demand Dynamo table with `pk/sk` primary index and owner GSI; production deletion protection; resource linking/least-privilege table permissions.
- **PATTERN**: Mirror pure `infra/config/app.ts:3-37` and constant assertions in `infra/composition.test.ts:6-26`.
- **GOTCHA**: User-pool username/admin-create policy is difficult or impossible to change safely later; verify generated Pulumi types before applying. Do not create a Cognito domain, identity pool, user, temporary password, secret, seed, or public signup flow. Stage-level removal retention and table deletion protection are separate and both must be tested.
- **VALIDATE**: `npm test -- --project node infra/config/control.test.ts infra/composition.test.ts`
- **SATISFIES**: AC 1, AC 3, and AC 7 production retention.

### 10. UPDATE API/SST composition for protected control routes

- **IMPLEMENT**: Add a JWT authorizer with issuer `https://cognito-idp.${region}.amazonaws.com/${pool.id}` and audience `[poolClient.id]`; link the table to the three functions; register `POST/GET /v1/control/projects` and `GET /v1/control/projects/{projectId}` with JWT auth; preserve unauthenticated `GET /v1/health`; return pool/client/table/API outputs useful for composition and operator verification.
- **PATTERN**: Extend route constants and `createApi()` in `infra/api.ts:1-26`; preserve explicit Node 24/tracing settings.
- **GOTCHA**: API routes are public unless auth is applied per route. Assert every control route has the authorizer and health does not. Never put pool client secrets or tokens in outputs. API Gateway native authorizer failures must reveal no internals.
- **VALIDATE**: `npm test -- --project node infra/composition.test.ts`
- **VALIDATE**: `npm run typecheck`
- **SATISFIES**: AC 1, AC 4, AC 6, and AC 8 unauthenticated denial.

### 11. CREATE dashboard public configuration and Amplify auth/session adapter; UPDATE dashboard test discovery

- **IMPLEMENT**: Change the dashboard Vitest include to `apps/dashboard/**/*.test.{ts,tsx}`; validate public `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_USER_POOL_CLIENT_ID`; configure Amplify once; wrap functional Auth v6 calls; restore current session; retrieve only `tokens.accessToken`; support `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED`; sign out cleanly.
- **PATTERN**: Strict runtime validation from contracts/backend; dependency-inject the auth adapter into React state for behavior tests.
- **GOTCHA**: Pool/client IDs are public configuration, but passwords, tokens, temporary passwords, session contents, and errors are sensitive. Do not use deprecated `Auth.currentSession`, manually decode JWTs, store an extra token copy, add a sign-up path, or use the ID token for API calls. Confirm `.test.ts` adapter/config/API tests are collected rather than silently skipped.
- **VALIDATE**: `npm test -- --project dashboard apps/dashboard/src/config.test.ts apps/dashboard/src/auth/auth-client.test.ts apps/dashboard/src/auth/AuthProvider.test.tsx apps/dashboard/src/auth/SignInForm.test.tsx`
- **SATISFIES**: AC 1–2 and AC 6.

### 12. CREATE the authenticated project API adapter and UI

- **IMPLEMENT**: Build same-origin fetch calls with bearer access token and strict envelope parsing; accessible create form with only File Management; independent settings inputs; loading/empty/error/list/detail states; pagination; create refresh/selection; and sign-out control. Replace the RUS-01 shell without adding a router/state framework.
- **PATTERN**: Behavior-led accessible tests from `App.test.tsx:6-30` and `.agents/references/frontend-component-best-practices.md:7-42`; one focused component per file.
- **GOTCHA**: Use relative `/v1/control/...`; never render/log/store the token, owner subject, internal project ID, or raw server error. On 401, clear/refresh session safely; on 404, show the same generic unavailable state regardless of project existence.
- **VALIDATE**: `npm test -- --project dashboard apps/dashboard/src/projects apps/dashboard/src/App.test.tsx`
- **SATISFIES**: AC 2, AC 4, AC 5, and AC 8 user-visible behavior.

### 13. UPDATE StaticSite composition with a narrow same-origin control behavior

- **IMPLEMENT**: After the owner explicitly approves this seam, inject only public Cognito IDs as Vite environment values. Add an API Gateway custom origin to the StaticSite CDN and ordered `v1/control/*` behavior with HTTPS-only origin and a custom cache policy whose TTLs are all zero, whose header whitelist is exactly `Authorization`/`Content-Type`, whose query whitelist is exactly `limit`/`cursor`, and whose cookie behavior is `none`. Keep API CORS false and the API URL output available to non-browser clients.
- **PATTERN**: Extend `DASHBOARD_CONFIG`/`createDashboard()` in `infra/dashboard.ts:1-12`; expose pure transform-policy constants for tests.
- **GOTCHA**: This is a material browser-origin/security decision and cannot be implemented until the owner approves it. Do not use `*` CORS/origins/methods/headers, a managed all-viewer origin request policy, nonzero TTLs, cookies, a broad `/v1/*` proxy, or future file/data-plane paths. Confirm custom cache-policy behavior against current AWS/SST docs and generated Pulumi types.
- **VALIDATE**: `npm test -- --project node infra/config/control.test.ts infra/composition.test.ts`
- **VALIDATE**: `npm run typecheck`
- **SATISFIES**: AC 1–2 and AC 9 without weakening browser-origin controls.

### 14. UPDATE Node test discovery and CREATE cross-owner integration/security tests

- **IMPLEMENT**: Add `tests/**/*.test.ts` to the Vitest Node-project include, then assemble actual handlers/services with an in-memory repository and two owner claim fixtures. Prove each owner sees only their list/details; guessed/other-owner public project IDs return the same 404; body/header owner overrides do nothing; absent authorizer and ID token fail; malformed name/settings/cursor fail; public responses/logs exclude all internal fields and authorization material.
- **PATTERN**: Root `tests/integration` is reserved for behavior crossing packages/slices per `README.md:16-24`.
- **GOTCHA**: Do not weaken tests by invoking services with pretrusted arbitrary owner IDs only—exercise the handler owner-extraction seam. Include repeated creates and default/edge lifetime values. Verify the root test is collected by both the task command and unfiltered `npm test`/`npm run check`.
- **VALIDATE**: `npm test -- --project node tests/integration/owner-project-control.test.ts`
- **SATISFIES**: AC 2–6 and AC 8, with explicit cross-owner denial evidence.

### 15. UPDATE `README.md` and `AGENTS.md`; validate instruction drift

- **IMPLEMENT**: Replace stale RUS-01/foundation-only status text, document current module paths, explain local UI versus separately authorized live Cognito testing, state that self-registration is disabled and invitations are external operator actions, and correct `AGENTS.md:13` without copying wiki content. Run the project drift workflow after structural implementation and apply only truthful, approved instruction updates.
- **PATTERN**: Keep wiki links canonical at `README.md:9-12`; preserve all stage/deployment warnings at lines 50-86.
- **GOTCHA**: Do not document real pool IDs, user emails, passwords, tokens, AWS account identifiers, generated API URLs, or a direct unwrapped SST command. Changing `AGENTS.md` requires Codex restart after the implementation turn.
- **VALIDATE**: `python tooling/validate_codex_layer.py`
- **VALIDATE**: `uv run --script tooling/mcp/codebase_search.py --self-test`
- **SATISFIES**: Repository truthfulness and safe operator handoff supporting AC 1–2.

### 16. RUN the complete local validation and guarded infrastructure preview

- **IMPLEMENT**: Run the full root gates, regenerate ignored SST provider declarations for an explicit non-production stage, and inspect the diff for exactly one invite-only pool/client, one on-demand retained/protected control table policy, one JWT authorizer, three protected control routes, one public health route, and one narrow CloudFront behavior.
- **PATTERN**: Use only commands in `package.json:15-28` and the wrapper rules in `README.md:50-86`.
- **GOTCHA**: `infra:install` is local artifact generation. `infra:diff` needs credentials and must stop if SST requests bootstrap or any write not already authorized. Do not run `infra:deploy`, `sst dev`, create a Cognito user, or modify AWS/GitHub resources under this plan.
- **VALIDATE**: `npm run check`
- **VALIDATE**: `npm run infra:install -- --stage dev-<slug>`
- **VALIDATE (only with valid credentials and no unapproved bootstrap/write)**: `npm run infra:diff -- --stage dev-<slug>`
- **SATISFIES**: All ACs at local/composition level; live AWS behavior remains a separately authorized validation step.

---

## TESTING STRATEGY

### Unit Tests

- Contracts: strictness, name bounds/trimming, exactly File Management, settings defaults, 1/60 accepted, 0/61/fraction rejected, cursor/limit bounds, and no internal fields.
- HTTP core: default 200, explicit 201, invalid success status rejected, derived authorization delivered to callbacks, authorization failure safe, raw event unavailable, and health regression.
- Owner context: valid access token, missing authorizer/JWT/claims/sub, ID token, blank subject, extra caller owner fields, and no token/claims logging.
- Model/IDs/cursor: item validation, key determinism, independent IDs, invalid/tampered cursor, and derived owner key reconstruction.
- Repository: exact transaction conditions/items, owner GSI `Query` rather than Scan, descending pagination, consistent inspect query, empty/incomplete/corrupt item behavior, and conditional collision classification.
- Service: defaults, boundary values, public mapping, bounded collision retry, owner-only list/inspect, identical missing/wrong-owner 404, and stable pagination.
- Infra: admin-only signup policy, no client secret/domain, on-demand indexes, production deletion protection plus app retention, protected route auth, public health, no wildcard CORS, disabled-cache control behavior, and no broad `/v1/*` proxy.
- Dashboard: initial session restore, sign-in success/failure, new-password challenge, sign-out, no sign-up UI, access-token use, strict response parsing, create/list/detail states, pagination, and no sensitive DOM/log output.

### Integration Tests

- Assemble HTTP handlers, owner extraction, service, and an in-memory repository for owners A and B.
- Create multiple projects for both owners, paginate each list, and prove there is no cross-owner item.
- Inspect own, missing, guessed, and other-owner project IDs; missing and cross-owner responses must match in status/code/message shape.
- Send body/header/query owner overrides and verify the token subject still owns the operation.
- Exercise malformed JSON, extra fields, invalid utility, settings bounds, malformed cursor, missing JWT context, and an ID token.
- Assert envelopes parse through shared schemas and serialized responses/logs do not contain internal IDs, owner subjects, table keys/names, claims, bearer tokens, or AWS exception text.

### Infrastructure/Boundary Tests

- Pure tests validate route/resource policy without evaluating SST.
- A generated-type pass validates current pinned SST/Pulumi signatures.
- A guarded non-production `infra:diff` validates the assembled resource graph without deployment.
- After separate deployment authorization, live boundary tests must call API Gateway without a token, with an invalid/ID token, and with invited owners A/B; inspect CloudWatch/API responses only for safe status/body behavior and redact all evidence.

### Edge Cases

- First sign-in requires a new permanent password; cancelled/failed challenge returns safely to sign-in.
- Expired session or unavailable refresh token while listing/creating/inspecting.
- Access token has matching client but missing/incorrect `token_use` or `sub`.
- Project name becomes empty after trim, is exactly 100 characters, exceeds 100, or contains Unicode.
- Settings omitted, one omitted, exact 1/60, 0/61, fraction, string, `null`, and unknown property.
- Public/internal ID collision; bounded retry exhaustion.
- Transaction writes metadata but utility would collide (transaction must write neither).
- Owner has zero, one, more than one page of projects; cursor is malformed or reused under another owner.
- Project partition is missing metadata/utility or contains corrupt data; fail closed with no partial response.
- Owner B guesses owner A's public project ID; response is indistinguishable from missing.
- CloudFront control response caching accidentally enabled, `Authorization` not forwarded, cookies forwarded, or header/query allowlists broadened; composition tests/diff must catch this.
- Direct API Gateway control call from a browser has no CORS permission; same-origin StaticSite path is the intended browser route.

---

## VALIDATION COMMANDS

Execute every applicable command and require zero errors. A failed command is not waived by a later passing command.

### Level 1: Syntax & Style

```powershell
npm run format:check
npm run lint
npm run typecheck
```

### Level 2: Unit Tests

```powershell
npm test -- --project node
npm test -- --project dashboard
npm run test:coverage
```

Coverage remains at least 80% for statements, branches, functions, and lines globally. Security-critical owner extraction, repository scoping, and wrong-owner behavior need explicit branch coverage, not only aggregate threshold compliance.

### Level 3: Integration and Full Build

```powershell
npm test -- --project node tests/integration/owner-project-control.test.ts
npm run build
npm run check
```

### Level 4: Infrastructure Composition

```powershell
npm run infra:install -- --stage dev-<slug>
npm run infra:diff -- --stage dev-<slug>
```

`infra:diff` is preview-only and requires valid AWS credentials. Stop if SST requests unapproved bootstrap or state/resource mutation. Deployment is not authorized by this plan.

### Level 5: Manual Validation (requires separate non-production deployment/user authorization)

1. Deploy the already-diffed non-production stage only after explicit owner authorization; never use production.
2. Create two disposable invited users with Cognito administrator tooling only after explicit authorization. Do not record temporary passwords in repository/logs/evidence.
3. Confirm public Cognito `SignUp` is disabled.
4. Sign in as owner A with the temporary-password challenge, create projects using defaults and custom 1/60 bounds, list, inspect, refresh the page/session, and sign out.
5. Repeat as owner B and prove neither owner can list/inspect the other's project, including direct API calls with guessed public IDs.
6. Call control routes with no token, malformed token, ID token, expired token, and valid access token; record only safe status/error shapes.
7. Inspect the CloudFront behavior: owner responses are not cached, `Authorization` reaches API Gateway, health remains public, and no file/data-plane path is proxied.
8. Remove disposable users/stage only under separate authorization and according to the stage's retention policy; never bypass production protection.

### Level 6: Codex Layer Validation

Because implementation corrects `AGENTS.md`, run:

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

Restart Codex after the merged `AGENTS.md` change so a new session rebuilds the instruction chain.

---

## ACCEPTANCE CRITERIA

- [ ] AC 1: An SST Cognito User Pool in `il-central-1` allows only admin-created users, has a secretless SPA client, and protects all dashboard/control project routes through an API Gateway JWT authorizer; public health remains unauthenticated.
- [ ] AC 2: The React dashboard restores a session, signs an invited user in (including required-new-password), signs out, has no self-sign-up path, and presents a minimal authenticated project view.
- [ ] AC 3: The on-demand core/control DynamoDB table stores owner-only project metadata and a separate File Management enabled-utility item, with opaque independent internal/public IDs and documented key/index access patterns.
- [ ] AC 4: Validated `POST /v1/control/projects`, `GET /v1/control/projects`, and `GET /v1/control/projects/{projectId}` operations return strict shared envelopes and the documented 201/200 statuses.
- [ ] AC 5: Upload/download URL lifetimes are independently persisted, integer-bounded to 1–60 minutes, and default to 15/5 when omitted.
- [ ] AC 6: Owner context is derived only from API Gateway-validated Cognito access-token claims; caller owner fields/project IDs never authorize an operation, and public responses omit owner/internal persistence data.
- [ ] AC 7: Production app removal retains the table and production table deletion protection is enabled; non-production remains removable.
- [ ] AC 8: Automated tests prove unauthenticated, ID-token, malformed-input, wrong-owner, cross-owner, corrupt-record, and cursor-tampering cases fail closed without exposing authorization/AWS internals.
- [ ] AC 9: The dashboard uses a same-origin, no-cache CloudFront behavior only for `v1/control/*`; API CORS remains disabled and no future file bytes/data-plane routes are proxied.
- [ ] AC 10: `npm run check`, Codex-layer validation, SST type generation, and the authorized non-production `infra:diff` all pass; no AWS deployment or user creation occurs without separate authorization.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in dependency order.
- [ ] Exact runtime versions revalidated and lockfile regenerated.
- [ ] Every task-level validation passed immediately.
- [ ] Public schemas contain no internal owner/Dynamo fields.
- [ ] Every control route is JWT protected and health remains public.
- [ ] Lambda rejects non-access tokens before deriving owner context.
- [ ] Create/list/inspect are owner-scoped and cross-owner inspect is indistinguishable from missing.
- [ ] Core/control table is on-demand, production-retained, and production deletion-protected.
- [ ] Dashboard has no sign-up flow and does not expose/store an extra token copy.
- [ ] CloudFront authenticated control responses are never cached and file/data-plane routes are absent.
- [ ] Full unit, integration, coverage, lint, typecheck, format, and build suite passes.
- [ ] `README.md` and `AGENTS.md` match the implemented repository; canonical product/architecture content remains in the wiki.
- [ ] SST generated types and non-production preview pass under existing external-action rules.
- [ ] No deployment, Cognito user, secret, credential, or remote tracker/wiki change was made without explicit authorization.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Readiness override (resolved for planning):** Issue #2 still has `queued` rather than its normally required `ready` label. RUS-01 is closed and PR #13 is merged, and the owner explicitly authorized proceeding on 2026-08-23. Implementation must still start from current `origin/main` and drift-check the dependency before editing.
- **Same-origin control route (unresolved approval gate):** The plan recommends using the StaticSite CDN only as a zero-TTL reverse proxy for `v1/control/*` to avoid wildcard CORS and the generated-site/API circular dependency. This does not change file delivery, but it is a new material browser-origin/security/infra decision rather than an inherited wiki decision. Obtain explicit owner approval before implementation. If rejected, stop and resolve an origin strategy at the architecture level rather than silently enabling wildcard CORS.
- **Invitation operations:** The ticket provisions an invite-only pool and supports the temporary-password challenge; it does not automate `AdminCreateUser`. Live proof therefore needs separate authorization for a non-production stage and two disposable users.
- **Names/pagination:** This plan assumes trimmed project names of 1–100 Unicode characters and list pages of 20 by default/50 maximum. These are reversible ticket-level bounds; change the contract before persistence if product requirements differ.
- **Public identifiers:** A prefixed cryptographically random public ID and an independent internal UUID are assumed. The prefix improves support readability but conveys no trust or authorization.
- **List shape:** List returns project summaries; inspect returns File Management settings. This avoids per-row Dynamo reads while satisfying create/list/inspect. If settings must appear in every list row, decide whether to denormalize them before implementation.
- **Native authorizer error body:** API Gateway may return its minimal native 401 body before Lambda; it cannot expose authorization internals. Lambda-owned errors continue using the shared envelope.
- **Live AWS acceptance:** Local tests and `infra:diff` can complete without deployment. Actual invitation/sign-in/API Gateway/CloudFront proof remains explicitly conditional on separate deployment and user-creation authorization.

## NOTES (open canvas)

### Why the owner GSI and project partition are shaped this way

The primary partition uses the public project ID because inspect and later stable public project paths need a direct lookup, while the internal ID remains a hidden downstream storage/usage identity. The owner GSI makes lists natively owner-scoped and avoids Scan/filter authorization. A separate `UTILITY#file-management` item preserves the architecture's enabled-utility entity and gives RUS-03 a narrow utility-enablement lookup seam without coupling future utility models to File Management.

The trade-off is that a public project ID locates a partition. That is safe only because service authorization still compares the persisted owner to the verified Cognito subject and wrong-owner responses are indistinguishable from missing. The ID remains an identifier, never a capability.

### Why Amplify functional Auth APIs

`aws-amplify` v6 supports an existing Cognito pool/client, session refresh, SRP sign-in, challenge continuation, and access-token retrieval without an Amplify backend or identity pool. A project-owned adapter keeps Amplify out of React components and makes session behavior testable. The ticket does not justify Amplify UI, hosted UI, or another state framework.

### Why verify `token_use` in Lambda

API Gateway verifies issuer, signature, expiry, and audience/client ID, but Cognito ID and access tokens can both target the same app client. The control API needs the access token. The JWT authorizer is the cryptographic boundary; the small Lambda claim schema adds semantic enforcement before `sub` becomes an owner ID.

### Data flow

```text
StaticSite browser
  -> Cognito sign-in/session -> access token
  -> same-origin /v1/control/*
  -> CloudFront no-cache API origin behavior
  -> API Gateway JWT validation
  -> owner-context access-token check
  -> thin handler + project service
  -> owner-keyed Dynamo repository
  -> strict public envelope (no owner/internal keys)
```

### One-pass confidence

**8/10 after the same-origin control-route decision is approved; 7/10 while it remains open.** The RUS-01 code patterns and ticket boundaries are clear, official SST/AWS/Amplify APIs cover the required behavior, and the plan resolves the critical auth and persistence seams. Remaining uncertainty is concentrated in owner approval of the generated-origin seam, exact generated SST/Pulumi transform typings, and live Cognito/CloudFront behavior; these are explicitly gated by approval, type generation, pure composition tests, infrastructure diff, and separately authorized live validation.

## AMENDMENTS

<!-- Append dated changes here after approval/execution. -->
