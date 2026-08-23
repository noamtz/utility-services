# Feature: RUS-03 Project Credential Lifecycle and Authentication

The following plan is complete, but implementation must revalidate the issue state, current codebase patterns, installed SST/provider types, and cited official documentation before changing files. Pay special attention to the distinction between owner-authenticated control operations and server-application project authentication, the dual-record DynamoDB invariants, one-time plaintext handling, and the fact that a public project ID or API-key lookup ID is never authorization.

## Feature Description

Implement the server-side project API-key lifecycle and the reusable project-authentication boundary for the File Management MVP. An authenticated project owner can issue multiple project keys, list only non-secret metadata, revoke a key, and atomically replace one key with a newly generated key. A consuming server application presents a split bearer credential containing a non-secret lookup identifier and a 256-bit secret; the backend stores only a SHA-256 digest of the secret, compares fixed-size digests with Node's timing-safe primitive, and returns an immutable trusted project context only after the key, project linkage, status, and File Management enablement have all been verified.

This ticket extends the RUS-02 core/control table and authenticated control-route pattern. It creates the contract that RUS-05 and later utility handlers consume, but it does not create a File Management route merely to exercise authentication, does not put file behavior into the authentication module, and does not deploy or create live credentials.

## User Story

As an invited project owner,
I want to issue, rotate, inspect, and revoke server-side project API keys,
so that my application can authenticate to reusable utilities without exposing AWS credentials or trusting caller-supplied project identity.

## Problem Statement

RUS-02 establishes invited owner identity and owner-only projects, but consuming applications have no credential or trustworthy way to establish project context. Passing a project ID is insufficient because IDs are identifiers, not proof of authority. Storing plaintext API keys would turn a control-table read or log leak into immediate project compromise, and non-atomic replacement could leave a key unexpectedly usable or make rotation unsafe.

The missing seam must therefore solve two related but separate concerns: Cognito-authenticated owners manage credential lifecycle in the identity/control bounded context, while utility handlers obtain project context only through a reusable verifier in the project-authentication bounded context.

## Solution Statement

Add strict Zod contracts, an identity/control credential vertical slice, and a separate project-authentication module. Use the existing on-demand core/control table without a new index or table:

- Store a hash-free credential metadata item in the project partition at `pk = PROJECT#<publicProjectId>`, `sk = API_KEY#<keyId>` so owner-scoped list and lifecycle operations use a native project-partition query.
- Store the only secret digest in a direct lookup item at `pk = API_KEY#<keyId>`, `sk = LOOKUP` so authentication resolves the non-secret lookup ID without a scan.
- Keep the two items' project linkage, status, and lifecycle fields consistent through conditional DynamoDB transactions. Issue writes both records; revoke updates both; replace updates both old records and writes both new records in one transaction.
- Generate a 128-bit public lookup ID and independent 256-bit secret with `node:crypto.randomBytes`, encode them as URL-safe base64, and expose the versioned bearer format `rus_v1.<keyId>.<secret>` only in successful issue/replace responses.
- Hash the high-entropy secret with SHA-256 and store a fixed 32-byte digest encoding. Do not add a pepper/Secrets Manager dependency in this ticket: the architecture requires a cryptographic hash, the input is independently generated 256-bit entropy rather than a human password, and a pepper would add an unapproved secret lifecycle. Keep hashing behind a narrow function so a future versioned keyed digest can be introduced deliberately.
- Parse `Authorization: Bearer ...` strictly inside the shared HTTP handler's `deriveAuthorization` seam. Resolve the lookup record, hash the presented secret, perform a fixed-length `timingSafeEqual` comparison (using a fixed dummy digest for an unknown lookup), then consistently load and cross-check the lookup record, project credential metadata, project metadata, and enabled-utility record before returning a frozen `TrustedProjectContext`.
- Return the same safe `401 UNAUTHORIZED` envelope for malformed, unknown, hash-mismatched, revoked, replaced, suspended, corrupt/mismatched, or utility-disabled project credentials. “Constant behavior” means one public status/code/message and a fixed-size timing-safe digest comparison for parseable credentials; it does not claim identical end-to-end network latency across different DynamoDB paths.
- Use application-level authentication middleware rather than an API Gateway native API key or Lambda authorizer. This preserves the repository's validated shared error envelope and directly plugs into the existing `deriveAuthorization` handler seam. RUS-05 will attach it to real utility routes.

## Out of Scope / Non-Goals

- Not included: File Management upload, download, list, metadata, public access, trash, purge, or S3 resources (RUS-05 through RUS-08).
- Not included: a synthetic or publicly deployed “verify key” endpoint; verification is proven through unit and assembled integration tests until a real utility route consumes it in RUS-05.
- Not included: native API Gateway API keys, usage plans, or treating them as authorization.
- Not included: API Gateway Lambda-authorizer caching or a separate authorizer resource. Authentication stays in the Lambda integration middleware so revocation is checked on every request and errors retain the shared envelope.
- Not included: browser/mobile delegated credentials or embedding a project key in consuming browser JavaScript/mobile binaries.
- Not included: the completed dashboard credential-management and integration-instructions experience; RUS-09 owns that UI. RUS-03 exposes the authenticated control operations and one-time response contract it will consume.
- Not included: project-key labels, expiry, scopes beyond enabled utilities, per-key rate limits, last-used tracking, secret recovery, or revealing an existing secret.
- Not included: a control operation that suspends keys or projects. The persisted key status and verifier must recognize and reject `suspended` records so a later administrative/service-protection operation can use the state safely.
- Not included: a password KDF, a pepper, Secrets Manager, KMS customer keys, or key-hash migration automation.
- Not included: production deployment, non-production deployment, creation of a live API key, mutation of `dev-rus02`, Cognito user creation, remote GitHub/wiki/issue changes, or any other AWS mutation without separate explicit authorization.
- Not changing: Cognito remains the owner/control principal; `/v1/health` stays public; project public IDs remain non-authorizing; the control table remains the identity/control store; shared envelopes, Node.js 24, SST stage policy, `il-central-1`, and production retention stay intact.

## Feature Metadata

**Feature Type**: New Capability

**Estimated Complexity**: High

**Primary Systems Affected**: shared credential/project-context contracts, identity/control credential lifecycle, project-authentication middleware, core/control DynamoDB access patterns, control Lambda routes, sensitive-value redaction tests, infrastructure route/IAM policy, cross-boundary security tests, repository status documentation

**Dependencies**: implemented RUS-02 owner/project control; existing `ControlTable`; Node.js 24 built-in crypto; TypeScript 6; Zod 4.4.3; AWS SDK v3 DynamoDB clients already installed; existing SST 4.17.1/Vitest 4 toolchain. No new runtime dependency is required.

## Related Work

**Implements**: [RUS-03 / GitHub issue #3](https://github.com/noamtz/utility-services/issues/3) · **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) · **Architecture**: [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture)

**Back-references**:

- `.agents/plans/rus-02-invite-only-owner-project-control.md` - Establishes the Cognito owner context, control table, project/utility item shapes, project ownership checks, protected control-route composition, same-origin dashboard path, and testing patterns extended here.
- [RUS-02 / issue #2](https://github.com/noamtz/utility-services/issues/2) - Closed prerequisite; its merged implementation is present on `main`.
- [MVP Ticket Breakdown — RUS-03](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown#rus-03--implement-project-credential-lifecycle-and-authentication) - Stable scope, dependency, and acceptance criteria.

**Forward-references**:

- RUS-05 must attach the project-authentication middleware to utility routes and consume only `TrustedProjectContext`, never a caller-supplied project ID.
- RUS-09 will add the owner-facing key controls, one-time display warning, and copyable placeholder-based `curl` instructions without persisting the plaintext in browser storage.
- RUS-10 may add operational suspension controls and authentication-failure alarms while preserving the status/context contracts created here.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` (lines 7-17) - Canonical wiki policy, repository status, and required logical boundary between identity/control and project authentication.
- `AGENTS.md` (lines 19-29) - Exact AWS identity/stage continuity rules; `dev-rus02` is reusable but no mutation is authorized by this plan.
- `AGENTS.md` (lines 31-50) - Modular SST, Dynamo bounded contexts, trusted project-context, split-key, hash-only, one-time display, and no-secret logging invariants.
- `AGENTS.md` (lines 63-79) - `/v1` route separation, shared envelope, server-side-secret, release-blocker, and external-action rules.
- `packages/backend/README.md` (lines 1-8) - Physical ownership map: business slices under `src/modules`, thin functions, shared contracts, and no backend imports from `infra`.
- `packages/contracts/src/projects/contract.ts` (lines 5-36) - File Management utility constant, public project ID, strict request, and bounded schema conventions to reuse.
- `packages/contracts/src/projects/contract.ts` (lines 56-92) - Strict path/public response/envelope and inferred-type pattern; do not add internal IDs or credential secrets to `ProjectSchema`.
- `packages/contracts/src/index.ts` (lines 1-44) - Package export boundary to extend with API-key and trusted-context schemas/types.
- `packages/contracts/src/http/envelope.ts` (lines 3-40) - Shared strict success/error envelope contract every control and utility operation must preserve.
- `packages/backend/src/modules/identity-control/auth/owner-context.ts` (lines 5-38) - Frozen minimal derived-context pattern. Credential control handlers continue to use this Cognito owner context.
- `packages/backend/src/modules/identity-control/projects/model.ts` (lines 10-58) - Existing `PROJECT#...` partition, metadata record, enabled-utility record, and strict stored-item schemas.
- `packages/backend/src/modules/identity-control/projects/model.ts` (lines 64-143) - Canonical key builders, cross-field consistency validation, and project assembly to reuse rather than reconstructing keys ad hoc.
- `packages/backend/src/modules/identity-control/projects/repository.ts` (lines 31-53) - Narrow repository interfaces and safe domain error pattern.
- `packages/backend/src/modules/identity-control/projects/repository.ts` (lines 85-128) - Injected DocumentClient plus conditional transacted-write pattern to mirror for dual credential records.
- `packages/backend/src/modules/identity-control/projects/repository.ts` (lines 159-197) - Strongly consistent project-partition read and fail-closed stored-record validation.
- `packages/backend/src/modules/identity-control/projects/service.ts` (lines 18-29) - Interface/dependency-injection pattern for service testability.
- `packages/backend/src/modules/identity-control/projects/service.ts` (lines 52-62, 126-132) - Safe identical not-found behavior and bounded collision configuration.
- `packages/backend/src/modules/identity-control/projects/handlers.ts` (lines 13-38) - Exact `createHttpHandler` factory pattern for owner-authenticated control operations.
- `packages/backend/src/modules/identity-control/projects/runtime.ts` (lines 15-25) - Process-level SST resource/client/repository/service/handler composition.
- `packages/backend/src/modules/identity-control/projects/ids.ts` (lines 1-23) - Node crypto, injected entropy, base64url, exact-length validation, and frozen result pattern.
- `packages/backend/src/core/http/handler.ts` (lines 18-56) - Safe logger and `HttpError` primitives.
- `packages/backend/src/core/http/handler.ts` (lines 59-112, 181-264) - Gateway event validation, async `deriveAuthorization`, strict section parsing, shared envelopes, and deliberately sparse request logging. Project auth plugs in here.
- `packages/backend/src/core/observability/redact.ts` (lines 6-25, 50-87) - Recursive sensitive-key redaction; current normalized aliases already include authorization, API key, token, and secret.
- `packages/backend/src/core/observability/redact.test.ts` (lines 5-24, 64-71) - Exact nested-secret and transfer-URL redaction assertions to extend for credential field aliases.
- `packages/backend/src/functions/control/create-project.ts` (line 1) - Thin deployed function entry pattern.
- `infra/config/control.ts` (lines 22-31) - Existing control-table/index/link policy. Reuse the primary key and do not add a credential GSI or `Scan`.
- `infra/config/control.ts` (lines 33-69) - Cognito-protected control-route declarations and same-origin forwarded path/query values. New lifecycle routes belong here.
- `infra/api.ts` (lines 14-18, 35-65) - Existing owner JWT authorizer and route loop; every `CONTROL_ROUTES` entry automatically links the table and receives Cognito auth.
- `infra/config/control.test.ts` (lines 27-78) - Least-privilege, exact-route, no-wildcard/no-scan, and CloudFront-forwarding policy tests.
- `infra/composition.test.ts` (lines 22-49) - Pure composition assertions for public health, route count, and same-origin control forwarding.
- `tests/integration/owner-project-control.test.ts` (lines 27-104) - Synthetic API Gateway/Cognito events, assembled real handlers/services, in-memory repository, and fake logger pattern.
- `tests/integration/owner-project-control.test.ts` (lines 106-184) - Two-owner isolation and serialized evidence assertion that excludes bearer, owner, internal ID, and Dynamo key material.
- `vitest.config.ts` (lines 4-50) - Node/jsdom test projects and enforced 80% statement/branch/function/line coverage thresholds.
- `package.json` (lines 15-28) - Canonical non-interactive quality commands; do not invent parallel command names.
- `README.md` (lines 3-13, 99-104) - Current product/infra status that must be updated when RUS-03 becomes implemented.

### Existing Files to Update

- `packages/contracts/src/index.ts` - Export strict API-key lifecycle schemas/types and the internal trusted-project-context contract.
- `packages/backend/src/core/observability/redact.test.ts` - Add credential-specific regression cases; production redaction code should change only if tests expose a missing normalized alias.
- `infra/config/control.ts` - Add the four Cognito-owner lifecycle routes with narrowly declared DynamoDB actions.
- `infra/config/control.test.ts`, `infra/composition.test.ts` - Update exact route/IAM assertions and preserve public health/no-cache control forwarding.
- `README.md` - Record RUS-03 behavior, auth boundary, and safe local/test workflow without embedding a usable key or duplicating the canonical wiki.
- `AGENTS.md` - Update only the repository-status sentence after implementation so project authentication is no longer described as unimplemented; preserve all architecture/security rules and restart Codex afterward.

### New Files to Create

Shared contracts:

- `packages/contracts/src/credentials/contract.ts` - API-key ID/status, lifecycle path/query, metadata, one-time issuance/replace payload, revoke response, and strict envelope schemas.
- `packages/contracts/src/credentials/contract.test.ts` - Strict public shape, malformed input, lifecycle-state, one-time response, and no-secret metadata tests.
- `packages/contracts/src/auth/project-context.ts` - Minimal non-REST `TrustedProjectContextSchema` containing internal project ID, verified key ID, and enabled utilities.
- `packages/contracts/src/auth/project-context.test.ts` - Strict context validation and internal-only shape tests.

Identity/control credential lifecycle:

- `packages/backend/src/modules/identity-control/credentials/credential.ts` - Versioned split-key generation, parsing types used at issuance, SHA-256 digest creation/encoding, and timing-safe digest comparison primitives with injectable entropy/comparison seams.
- `packages/backend/src/modules/identity-control/credentials/credential.test.ts` - Entropy lengths, format/round-trip, hash-only behavior, known digest vectors, fixed-length comparison, dummy digest, and malformed-format tests.
- `packages/backend/src/modules/identity-control/credentials/model.ts` - Strict project-metadata and lookup-item schemas, key builders, state transitions, canonical cross-record validation, and public metadata mapping.
- `packages/backend/src/modules/identity-control/credentials/model.test.ts` - Canonical keys, forbidden plaintext fields, valid states/timestamps, mismatched project/status linkage, and public projection tests.
- `packages/backend/src/modules/identity-control/credentials/cursor.ts` - Opaque bounded project-partition cursor containing only a validated key ID.
- `packages/backend/src/modules/identity-control/credentials/cursor.test.ts` - Round-trip, malformed/tampered, and cross-project reconstruction tests.
- `packages/backend/src/modules/identity-control/credentials/repository.ts` - Separate credential repository interface and Dynamo adapter for project inspection, metadata query, direct lookup, consistent verification snapshot, and atomic issue/revoke/replace transitions.
- `packages/backend/src/modules/identity-control/credentials/repository.test.ts` - Exact Get/Query/TransactGet/TransactWrite commands, conditions, collision/state classification, consistency, pagination, and corrupt-record tests.
- `packages/backend/src/modules/identity-control/credentials/service.ts` - Owner-authorized issue/list/revoke/replace orchestration, collision retry, one-time public response, identical missing/wrong-owner behavior, and safe state mapping.
- `packages/backend/src/modules/identity-control/credentials/service.test.ts` - Owner isolation, hash-only persistence, one-time display, multiple active keys, idempotent revoke, atomic replacement semantics, status conflicts, collision retry, and no-internal-field tests.
- `packages/backend/src/modules/identity-control/credentials/handlers.ts` - Four owner/Cognito handler factories wired to strict contracts and shared envelopes.
- `packages/backend/src/modules/identity-control/credentials/handlers.test.ts` - Path/query validation, 201/200 envelopes, owner derivation, wrong-owner safety, and no-response/no-log leakage tests.
- `packages/backend/src/modules/identity-control/credentials/runtime.ts` - Shared Dynamo client plus repository/service/control-handler composition using `Resource.ControlTable.name`.
- `packages/backend/src/functions/control/issue-project-api-key.ts` - Thin issue-handler export.
- `packages/backend/src/functions/control/list-project-api-keys.ts` - Thin metadata-list-handler export.
- `packages/backend/src/functions/control/revoke-project-api-key.ts` - Thin revoke-handler export.
- `packages/backend/src/functions/control/replace-project-api-key.ts` - Thin replace-handler export.

Project authentication:

- `packages/backend/src/modules/project-authentication/bearer.ts` - Case-insensitive Authorization-header discovery, exact single Bearer grammar, and split-credential parsing without logging/echoing the value.
- `packages/backend/src/modules/project-authentication/bearer.test.ts` - Missing, duplicated, malformed scheme/spacing/segments/lengths, and valid header tests.
- `packages/backend/src/modules/project-authentication/service.ts` - Parseable-credential lookup/hash comparison, active-state/project/utility cross-check, generic failure mapping, and frozen trusted-context creation.
- `packages/backend/src/modules/project-authentication/service.test.ts` - Valid context, unknown dummy comparison, wrong secret, revoked/replaced/suspended, disabled utility, mismatched/corrupt project, and one generic failure contract.
- `packages/backend/src/modules/project-authentication/authorization.ts` - `createProjectAuthorization` adapter matching `createHttpHandler`'s async `deriveAuthorization` signature.
- `packages/backend/src/modules/project-authentication/authorization.test.ts` - Synthetic gateway event to trusted context and shared `401` failure assertions through an assembled test handler.

Cross-boundary validation:

- `tests/integration/project-credential-authentication.test.ts` - Two-owner lifecycle plus consuming-application authentication using an in-memory dual-record repository, atomic rotation/revocation behavior, utility enablement, cross-project denial, and serialized response/log/store evidence proving no plaintext/digest/header leakage.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Product Requirements — MVP and five-minute goal](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic#6-mvp)
  - Specific sections: MVP item 3 and success metrics.
  - Why: issuance is an activation seam; unnecessary setup or recovery workflows work against the product hypothesis.
- [Architecture — Module boundaries](https://github.com/noamtz/utility-services/wiki/Architecture#module-boundaries)
  - Specific section: identity/control versus project authentication.
  - Why: lifecycle code and reusable utility authentication must remain separate modules inside one SST application.
- [Architecture — Core/control table](https://github.com/noamtz/utility-services/wiki/Architecture#corecontrol-table)
  - Specific section: API key record fields and plaintext prohibition.
  - Why: fixes the bounded-context store and durable attributes.
- [Architecture — Consuming applications](https://github.com/noamtz/utility-services/wiki/Architecture#consuming-applications)
  - Specific section: split key, cryptographic comparison, one-time display, revocation/replacement, and File Management enablement.
  - Why: authoritative authentication and rotation decisions.
- [Architecture — Security, abuse, and cost guardrails](https://github.com/noamtz/utility-services/wiki/Architecture#security-abuse-and-cost-guardrails)
  - Specific section: suspendability and structured redaction.
  - Why: inactive states and credential leakage are security boundaries.
- [Node.js 24 `crypto.randomBytes`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandombytessize-callback)
  - Specific section: cryptographically strong pseudorandom data.
  - Why: generate independent lookup and 256-bit secret material with the pinned runtime.
- [Node.js 24 `crypto.createHash`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehashalgorithm-options)
  - Specific section: SHA-256 digest construction.
  - Why: persist only the deterministic digest of high-entropy secret material.
- [Node.js 24 `crypto.timingSafeEqual`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptotimingsafeequala-b)
  - Specific section: equal-length constant-time byte comparison and surrounding-code warning.
  - Why: compare fixed 32-byte digests without a normal string equality oracle; normalize lengths before calling because unequal lengths throw.
- [DynamoDB `TransactWriteItems`](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)
  - Specific sections: atomicity, conditional rejection, distinct-item restriction, and idempotent client request token.
  - Why: keep lookup/metadata records and replacement state transitions atomic.
- [DynamoDB condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
  - Specific sections: `attribute_not_exists` conditional put and conditional update.
  - Why: prevent lookup collisions, stale transitions, and overwrites.
- [Using IAM with DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)
  - Specific sections: permissions for transactional `Get`, `Put`, `Update`, and `ConditionCheck` actions.
  - Why: transaction API calls are authorized through their underlying item actions (`GetItem`, `PutItem`, `UpdateItem`, and `ConditionCheckItem`), not invented `TransactGetItems`/`TransactWriteItems` IAM action strings.

### Patterns to Follow

**Naming Conventions:**

- Public JSON/API: camelCase (`keyId`, `apiKey`, `createdAt`, `replacementKeyId`).
- Constants: uppercase snake case (`API_KEY_LOOKUP_SORT_KEY`, `API_KEY_STATUS_ACTIVE`).
- File/directory names: kebab case and bounded-context vertical slices.
- Dynamo keys: uppercase tagged segments. Centralize `projectApiKeySortKey(keyId)` and `apiKeyLookupPartitionKey(keyId)`; never interpolate them outside model helpers.
- Use “API key” in owner-facing public contracts and `TrustedProjectContext` in downstream code. Do not call the secret an AWS credential or expose the stored digest as a token.

**Schema and projection pattern:**

```ts
export const ApiKeyMetadataSchema = z
  .object({
    keyId: ApiKeyIdSchema,
    status: ApiKeyStatusSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    revokedAt: TimestampSchema.optional(),
    replacedAt: TimestampSchema.optional(),
    replacementKeyId: ApiKeyIdSchema.optional(),
  })
  .strict();
```

Keep the one-time schema separate:

```ts
export const IssuedApiKeySchema = z
  .object({ apiKey: ProjectApiKeySchema, metadata: ApiKeyMetadataSchema })
  .strict();
```

List/revoke responses use metadata only. `ProjectApiKeySchema` must never appear in stored model schemas or list/revoke response schemas.

**Dynamo record topology:**

```text
PROJECT#prj_... / API_KEY#key_...   -> listable owner metadata, no digest
API_KEY#key_... / LOOKUP            -> secretHash + project linkage, never plaintext
```

Issue and replace write both records in one transaction. Revoke and replace update both old records in one transaction. Project metadata ownership and the `UTILITY#file-management` record are checked from stored state, not request input. Never add a table scan or duplicate the digest into the project-partition item.

**Service and error pattern:**

```ts
function unauthorized(): HttpError {
  return new HttpError(401, "UNAUTHORIZED", "Authentication required");
}
```

All project-credential failures converge on this error. Owner control operations may return validated `404 NOT_FOUND` for missing/wrong-owner project or key and `409 CONFLICT` for an invalid lifecycle transition, but those responses must not expose another owner's resource existence or AWS details.

**Logging pattern:**

Follow `createHttpHandler`: log request ID, method, path, status, and safe error code only. Do not pass headers, the parsed credential, key secret, full `apiKey`, `secretHash`, owner subject, or authorizer context to log attributes. Redaction is defense in depth, not permission to log secrets.

**Multiple-key and rotation semantics:**

- Each issue operation creates a new independent active key; existing active keys remain active.
- Replace targets exactly one active or suspended key, atomically marks it `replaced`, and creates one new active key. Other active keys are unaffected.
- The replace response is the only display of the new plaintext.
- Revoke is idempotent: active or suspended becomes revoked; already revoked/replaced remains unusable and is returned without reactivation.
- Authentication accepts only `active`. `revoked`, `replaced`, and `suspended` are indistinguishable from unknown externally.

**Trusted-context pattern:**

Return only a frozen, schema-validated object such as:

```ts
{
  internalProjectId,
  keyId,
  enabledUtilities: ["file-management"]
}
```

No utility service should receive the raw header, plaintext secret, digest, owner subject, DynamoDB keys, or a caller-provided project identity through this seam.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts and Credential Primitives

Define the immutable public and internal seams first: strict lifecycle payloads, the trusted project context, versioned split-key format, strong entropy generation, fixed digest representation, and timing-safe comparison.

**Tasks:**

- Add public API-key lifecycle schemas without changing `ProjectSchema`.
- Add a minimal internal trusted-context schema for future utility handlers.
- Implement and test key generation, parsing, hashing, dummy digest, and fixed-size comparison.

### Phase 2: Persisted Model and Atomic Repository

**Depends on:** Phase 1 (needs validated IDs, statuses, and digest shapes)

Extend the existing core/control table through a separate credential repository. Model the listable metadata and direct lookup records explicitly, validate their relationships, and make issue/revoke/replace atomic with conditional transactions.

**Tasks:**

- Add canonical key builders, item schemas, public projection, and status-transition invariants.
- Add cursor pagination for project-partition key metadata.
- Add direct lookup and consistent verification-snapshot reads.
- Add conditional dual-record issue/revoke/replace operations with typed safe failures.

### Phase 3: Owner Lifecycle Control Slice

**Depends on:** Phase 2 (needs atomic persistence)

Implement owner-authorized lifecycle services and four Cognito-protected control handlers. Preserve identical missing/wrong-owner behavior, return plaintext only from successful issue/replace calls, and keep every other response/log/store secret-free.

**Tasks:**

- Implement issue/list/revoke/replace orchestration with injected time/entropy and bounded collision retry.
- Create strict handler factories and thin runtime/function entries.
- Add the four routes and least-privilege DynamoDB actions to existing control composition.

### Phase 4: Reusable Project Authentication

**Depends on:** Phase 2 (needs lookup and verification snapshot)

Build the separate middleware consumed by future utility routes. Parse the bearer safely, authenticate against stored state, enforce enabled utility, and expose only `TrustedProjectContext` through `deriveAuthorization`.

**Tasks:**

- Implement header/bearer parsing without echoing input.
- Implement generic-failure verification with fixed digest comparison and strict cross-record validation.
- Implement the `deriveAuthorization` adapter and assembled handler proof without a public synthetic route.

### Phase 5: Cross-Boundary Security, Infrastructure, and Status Documentation

**Depends on:** Phases 3 and 4 (tests the complete lifecycle-to-authentication seam)

Prove two-owner isolation, hash-only persistence, immediate revocation/replacement behavior, inactive-state rejection, utility enablement, and no secret leakage. Update repository truth only after all behavior exists.

**Tasks:**

- Add assembled integration tests and credential-specific redaction regression tests.
- Update infrastructure policy tests, README, and the AGENTS repository-status sentence.
- Run targeted, full, coverage, build, AI-layer, and preview validation within external-action guardrails.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. CREATE `packages/contracts/src/credentials/contract.ts` and `contract.test.ts`; UPDATE `packages/contracts/src/index.ts`

- **IMPLEMENT**: strict `ApiKeyIdSchema`, versioned full-key schema, statuses (`active`, `revoked`, `replaced`, `suspended`), project/key path schemas, bounded list query/cursor, public metadata, list payload, one-time issue/replace payload, revoke payload, and success envelopes.
- **IMPLEMENT**: exact route input shapes for `POST/GET /v1/control/projects/{projectId}/api-keys`, `DELETE /.../{keyId}`, and `POST /.../{keyId}/replace`; issue/replace need no caller-supplied secret or project identity in a body.
- **PATTERN**: `packages/contracts/src/projects/contract.ts:11-92` and `packages/contracts/src/http/envelope.ts:29-40`.
- **GOTCHA**: do not extend `ProjectSchema` with credential data. Metadata/list/revoke schemas must reject `apiKey`, `secret`, `secretHash`, owner ID, internal project ID, and Dynamo key fields. Only issue/replace payloads may contain `apiKey`.
- **VALIDATE**: `npm test -- --project node packages/contracts/src/credentials/contract.test.ts`
- **SATISFIES**: AC1, AC2, AC3, AC7.

### 2. CREATE `packages/contracts/src/auth/project-context.ts` and `project-context.test.ts`; UPDATE `packages/contracts/src/index.ts`

- **IMPLEMENT**: strict `TrustedProjectContextSchema`/type with only `internalProjectId`, verified `keyId`, and the validated enabled-utility tuple.
- **PATTERN**: `packages/backend/src/modules/identity-control/auth/owner-context.ts:28-38` for a small immutable authorization result; `EnabledUtilitiesSchema` for the approved utility value.
- **GOTCHA**: this is a service-to-service/module contract, not a REST response. It must never contain raw authorization, public caller input, secret/digest, owner subject, bucket/key, or settings unrelated to authorization.
- **VALIDATE**: `npm test -- --project node packages/contracts/src/auth/project-context.test.ts`
- **SATISFIES**: AC4, AC8.

### 3. CREATE `packages/backend/src/modules/identity-control/credentials/credential.ts` and `credential.test.ts`

- **IMPLEMENT**: generate an independent 16-byte lookup ID and 32-byte secret; validate entropy output lengths; base64url encode; assemble the exact `rus_v1.<keyId>.<secret>` format; return a frozen ephemeral object.
- **IMPLEMENT**: SHA-256 digest bytes/encoding, a fixed 32-byte dummy digest, and a comparison helper that always normalizes/validates equal-sized buffers before `timingSafeEqual`.
- **PATTERN**: `packages/backend/src/modules/identity-control/projects/ids.ts:11-23` for injectable factories and exact entropy validation.
- **IMPORTS**: `randomBytes`, `createHash`, and `timingSafeEqual` from `node:crypto`; contract schemas from `@utility-services/contracts`.
- **GOTCHA**: never include the plaintext or digest in an error message. Do not use normal string equality for digests. Do not add a password KDF or a hard-coded/environment pepper.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/credentials/credential.test.ts`
- **SATISFIES**: AC1, AC2, AC6, AC8.

### 4. CREATE `packages/backend/src/modules/identity-control/credentials/model.ts` and `model.test.ts`

- **IMPLEMENT**: strict metadata/lookup record schemas, `PROJECT#.../API_KEY#...` and `API_KEY#.../LOOKUP` key builders, lifecycle timestamp refinements, canonical cross-record validation, and public metadata projection.
- **IMPLEMENT**: lookup record contains `secretHash`, internal/public project linkage, key ID, status, and lifecycle timestamps; project metadata record duplicates linkage/status/timestamps but deliberately omits the digest.
- **PATTERN**: `packages/backend/src/modules/identity-control/projects/model.ts:30-58,64-143`.
- **GOTCHA**: `suspended` is a readable/rejectable stored state but has no new control operation in this ticket. Enforce status-specific fields: replaced requires replacement key/timestamp; revoked requires revoke timestamp; active cannot carry terminal timestamps.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/credentials/model.test.ts`
- **SATISFIES**: AC2, AC5, AC7, AC8.

### 5. CREATE `packages/backend/src/modules/identity-control/credentials/cursor.ts` and `cursor.test.ts`

- **IMPLEMENT**: encode/decode only a validated key ID as an opaque base64url cursor; reconstruct `PROJECT#<trusted path project>/API_KEY#<cursor key>` at the repository boundary.
- **PATTERN**: the existing project cursor's strict parse/error approach; owner/project scope is always supplied separately from trusted owner/path validation.
- **GOTCHA**: do not embed owner ID, internal project ID, secret/digest, or a raw DynamoDB key object. Treat malformed decoded JSON and unsupported fields as validation errors.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/credentials/cursor.test.ts`
- **SATISFIES**: AC3, AC8.

### 6. CREATE `packages/backend/src/modules/identity-control/credentials/repository.ts` and `repository.test.ts`

- **IMPLEMENT**: a narrow repository interface supporting owned project inspection, metadata list, direct lookup, verification snapshot, atomic issue, idempotent revoke, and atomic replace.
- **IMPLEMENT**: use `GetCommand`/`QueryCommand`/`TransactGetCommand`/`TransactWriteCommand` as appropriate; all auth-relevant reads must be strongly consistent. Query only `pk = PROJECT#... AND begins_with(sk, 'API_KEY#')`; never `Scan`.
- **IMPLEMENT**: issue transaction condition-checks the project/utility state and conditionally puts both new items; revoke conditionally updates both old items; replace conditionally updates both old items and puts both new items in the same transaction. Use a deterministic non-secret client request token where safe for one repository call, never the plaintext.
- **IMPLEMENT**: second verification snapshot re-reads the lookup record together with project credential metadata, project metadata, and `UTILITY#file-management`, then validates all linkage/status values before returning.
- **PATTERN**: `packages/backend/src/modules/identity-control/projects/repository.ts:85-128,159-197` and its tests.
- **GOTCHA**: DynamoDB does not allow two transaction actions against the same item; put lifecycle conditions directly on each update. Classify cancellation/collision/state failures into domain errors without returning AWS messages. Retry only a confirmed new-key collision, not ownership/state failures.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/credentials/repository.test.ts`
- **SATISFIES**: AC2, AC3, AC4, AC5, AC7, AC8.

### 7. CREATE `packages/backend/src/modules/identity-control/credentials/service.ts` and `service.test.ts`

- **IMPLEMENT**: owner-authorized `issue`, `list`, `revoke`, and `replace`; derive ownership by inspecting stored project state against `OwnerContext`; use injected generator/time/collision-attempt dependencies.
- **IMPLEMENT**: issue and replace hash/persist before returning `{apiKey, metadata}`; plaintext exists only in the local call result and is never accepted back by lifecycle APIs. List/revoke return metadata only.
- **IMPLEMENT**: support multiple independently issued active keys. Replace only the targeted active/suspended key atomically and leave other active keys unchanged. Revoke is idempotent and never reactivates terminal keys.
- **PATTERN**: `packages/backend/src/modules/identity-control/projects/service.ts:52-62,64-94,126-132`.
- **GOTCHA**: missing and wrong-owner project/key paths must be indistinguishable. Do not query the global lookup item to decide whether another project's key exists. Terminal-state conflicts use safe domain messages and never reveal digest/AWS details.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/credentials/service.test.ts`
- **SATISFIES**: AC2, AC3, AC5, AC7, AC8.

### 8. CREATE credential control handlers, runtime, and four thin function entrypoints

- **IMPLEMENT**: `handlers.ts` factories for issue/list/revoke/replace with strict path/query/response schemas, `extractOwnerContext`, 201 for issue/replace and 200 for list/revoke.
- **IMPLEMENT**: `runtime.ts` composes one process-level DocumentClient/repository/service and safe logger; function files only re-export handlers.
- **PATTERN**: `packages/backend/src/modules/identity-control/projects/handlers.ts:13-38`, `runtime.ts:15-25`, and `packages/backend/src/functions/control/create-project.ts:1`.
- **GOTCHA**: handler logs must not receive bodies, authorization headers, owner context, generated plaintext, or hashes. Tests must serialize response and logger calls and explicitly exclude fixture secrets.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/identity-control/credentials/handlers.test.ts`
- **SATISFIES**: AC2, AC3, AC6, AC7.

### 9. CREATE `packages/backend/src/modules/project-authentication/bearer.ts` and `bearer.test.ts`

- **IMPLEMENT**: case-insensitive discovery of exactly one Authorization value, exact `Bearer` scheme/spacing, and strict version/key-ID/secret segment parsing into a non-logging internal result.
- **PATTERN**: `packages/backend/src/core/http/handler.ts:59-79` for the incoming event shape; all validation results map later to one auth error rather than echoing schema details.
- **GOTCHA**: reject missing, empty, repeated/comma-joined, wrong-scheme, extra-segment, wrong-length, and non-base64url values. Never accept credentials from query/body/path/cookie or an `x-api-key` header.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/project-authentication/bearer.test.ts`
- **SATISFIES**: AC1, AC4, AC5, AC6.

### 10. CREATE `packages/backend/src/modules/project-authentication/service.ts` and `service.test.ts`

- **IMPLEMENT**: lookup by non-secret key ID, SHA-256 the presented secret, compare against stored or dummy fixed digest, require active status, load the consistent verification snapshot, validate cross-record project/key/status linkage and File Management enablement, and return frozen `TrustedProjectContext`.
- **IMPLEMENT**: one `unauthorized()` mapping for malformed, unknown, wrong secret, revoked, replaced, suspended, missing/corrupt/mismatched project/key, and disabled utility. Internal infrastructure exceptions remain safe 500s through the shared handler and never contain request material.
- **PATTERN**: `packages/backend/src/modules/identity-control/projects/service.ts:52-54` for a single safe error factory and `owner-context.ts:28-38` for a frozen context.
- **GOTCHA**: test observable equivalence by status/code/message/envelope and absence of private evidence, not wall-clock equality. Ensure the unknown parseable key path still hashes and calls the fixed-length comparison with a dummy digest.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/project-authentication/service.test.ts`
- **SATISFIES**: AC4, AC5, AC6, AC8.

### 11. CREATE `packages/backend/src/modules/project-authentication/authorization.ts` and `authorization.test.ts`

- **IMPLEMENT**: `createProjectAuthorization(service)` returning an async `deriveAuthorization(gatewayEvent)` adapter; demonstrate it through a small test handler built with `createHttpHandler`, not a deployed verification endpoint.
- **PATTERN**: `packages/backend/src/core/http/handler.ts:95-112,215-234` and project handler factories.
- **GOTCHA**: future utility callbacks receive only the trusted context. They must not receive or reparse the original header and must not accept a project ID as a substitute.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/project-authentication/authorization.test.ts`
- **SATISFIES**: AC4, AC5, AC6, AC8.

### 12. UPDATE `infra/config/control.ts`, `infra/config/control.test.ts`, and `infra/composition.test.ts`

- **ADD**: the exact four Cognito-JWT owner routes under `/v1/control/projects/{projectId}/api-keys`, pointing to the thin entries.
- **ADD**: only the Dynamo actions actually emitted by each function. Preserve the baseline query link; use route-specific underlying `GetItem`, `PutItem`, `UpdateItem`, and `ConditionCheckItem` permissions required by transactional actions, with the existing table ARN and no wildcard/scan/batch-write expansion. Do not add nonexistent transaction API action strings to IAM.
- **PATTERN**: `infra/config/control.ts:31-52` and `infra/api.ts:44-64`.
- **GOTCHA**: these are owner/control routes and use Cognito JWT auth. Do not attach project-key middleware to them. Existing `v1/control/*` CloudFront behavior already forwards Authorization/Content-Type with TTL zero and already allowlists `limit`/`cursor`; no new origin or cache policy is needed.
- **VALIDATE**: `npm test -- --project node infra/config/control.test.ts infra/composition.test.ts`
- **SATISFIES**: AC3, AC6.

### 13. UPDATE credential redaction regression coverage

- **ADD**: nested/case/punctuation variants for `apiKey`, `projectApiKey`, `secretHash`, `credential`, and full Authorization header fixtures. Change `redact.ts` only for aliases whose normalized keys are not already covered.
- **PATTERN**: `packages/backend/src/core/observability/redact.test.ts:5-24,64-71`.
- **GOTCHA**: no redactor can identify an arbitrary unlabelled secret string reliably. The primary rule remains never placing credential material into logger attributes or exception messages.
- **VALIDATE**: `npm test -- --project node packages/backend/src/core/observability/redact.test.ts`
- **SATISFIES**: AC6.

### 14. CREATE `tests/integration/project-credential-authentication.test.ts`

- **IMPLEMENT**: assemble real lifecycle handlers/services and project-auth middleware around an in-memory repository that enforces the dual-record/atomic semantics; exercise two owners and at least two projects.
- **TEST**: issue returns a usable key once while stored evidence contains only hash; list/revoke never return it; two active keys work; replacement immediately invalidates only the old target and returns one new secret; revocation invalidates the target; suspended/unknown/malformed/wrong-secret/utility-disabled/mismatched records share the same safe auth response.
- **TEST**: owner A cannot list/revoke/replace owner B's key; a valid key cannot resolve another internal project; caller project IDs/headers do not override verified context.
- **TEST**: serialize handler responses except the deliberately captured one-time field after it is extracted, store snapshots, errors, and logger calls; assert no raw bearer, secret, digest, owner subject, internal Dynamo keys, or Authorization header is present.
- **PATTERN**: `tests/integration/owner-project-control.test.ts:27-104,106-184`.
- **GOTCHA**: test fixtures may hold a synthetic key in memory, but must never write it to snapshots, plan/report files, stdout, or failure messages. Assertions should compare derived behavior and use explicit exclusion checks.
- **VALIDATE**: `npm test -- --project node tests/integration/project-credential-authentication.test.ts`
- **SATISFIES**: AC1 through AC8.

### 15. UPDATE `README.md` and `AGENTS.md`

- **UPDATE**: README status/layout/infra summary to describe implemented owner API-key lifecycle and project-authentication middleware, clarify that the dashboard UI/instructions remain RUS-09, and document local tests without a usable key example.
- **UPDATE**: AGENTS repository-status sentence so identity/control credential lifecycle and project authentication are described truthfully; leave canonical architecture/security/AWS instructions untouched.
- **PATTERN**: `README.md:3-13,15-26,99-104` and `AGENTS.md:7-17`.
- **GOTCHA**: do not copy canonical wiki text into local docs, record credential material, imply a live stage was changed, or claim File Management routes consume the context before RUS-05. Restart Codex after the AGENTS change so a later session rebuilds the instruction chain.
- **VALIDATE**: `python tooling/validate_codex_layer.py`
- **SATISFIES**: documentation/status completeness and downstream implementation safety.

### 16. RUN targeted and full local validation

- **RUN**: credential contracts, lifecycle module, authentication module, redaction, infrastructure policy, and integration tests first.
- **RUN**: formatting, lint, typecheck, complete tests, coverage, and build through the committed scripts.
- **GOTCHA**: do not relax the 80% global thresholds, skip security tests, print secrets for debugging, or use `--update` snapshots containing credential material.
- **VALIDATE**: `npm run check`
- **SATISFIES**: AC1 through AC8 and zero-regression requirements.

### 17. PREVIEW infrastructure composition against the approved shared development stage

- **INSPECT**: before any preview, confirm no parallel branch is using `dev-rus02`, inspect relevant known stage state without exposing data, and use only `tooling/run-sst.mjs` through npm scripts.
- **RUN**: generate ignored provider artifacts locally if needed, then run a fresh diff for the historical shared stage.
- **GOTCHA**: `infra:diff` is preview-only and performs the mandated AWS identity preflight. Stop on account/principal mismatch or if SST requests an unapproved bootstrap/write. This plan does not authorize deploy, resource mutation, user/key creation, or data changes.
- **VALIDATE**: `npm run infra:install -- --stage dev-rus02` then `npm run infra:diff -- --stage dev-rus02`
- **SATISFIES**: infrastructure composition and least-privilege preview evidence.

---

## TESTING STRATEGY

### Unit Tests

Use colocated Vitest tests with dependency injection, matching the current project slice:

- Contracts: strict accepted/rejected shapes; one-time payload distinct from metadata payloads; extra secret/internal fields rejected.
- Credential primitive: independent entropy sources, exact byte lengths, exact versioned grammar, URL-safe encoding, SHA-256 known vectors, fixed 32-byte compare inputs, equal/different comparison, unknown-key dummy digest, and no value-bearing errors.
- Stored model: canonical pk/sk relationships, status/timestamp invariants, strict cross-record project/key/status agreement, no plaintext in either item, digest present only in lookup.
- Repository: exact Dynamo command inputs, `ConsistentRead`/transaction use, no scan, ownership/utility conditions, collision classification, atomic dual-record lifecycle transitions, pagination, terminal-state races, and fail-closed corrupt data.
- Lifecycle service: owner enforcement, one-time return, multiple active keys, revoke idempotency, targeted atomic replacement, collision bounds, safe 404/409 behavior, and no private public projection.
- Bearer parser/auth service: header casing and grammar, malformed/unknown/wrong-secret/inactive/corrupt/disabled cases, dummy comparison, frozen minimal context, and one generic 401.
- Handler/authorization adapters: parsed input, status codes, shared envelopes, Cognito versus project-auth principal separation, and sparse secret-free logs.
- Infrastructure policies: exact route set, Cognito auth, route-specific table actions, public health, no wildcards/scan, and unchanged no-cache control forwarding.

### Integration Tests

Assemble real contracts, handlers, services, cryptographic primitives, and project-auth adapter around an in-memory repository. Avoid AWS in automated integration tests. Cover:

1. Owner A issues two keys for project A; both authenticate to project A's internal ID.
2. Stored records include the digest but not either plaintext; list metadata includes neither.
3. Replacing key A1 produces one new key, invalidates A1 immediately, preserves A2, and authenticates the replacement.
4. Revoking A2 invalidates it; repeated revoke does not reactivate or corrupt state.
5. Owner B cannot see or mutate A's keys using A's project/key IDs.
6. A key record linked to the wrong project or missing File Management fails closed and never yields context.
7. All credential-auth failures return the same safe status/code/message envelope and no secret material reaches logger/error evidence.

### Edge Cases

- Entropy provider returns too few/many bytes.
- Key ID collision on either lookup or project record, including collision retry exhaustion.
- Missing, empty, case-variant, repeated, comma-joined, malformed, or whitespace-padded Authorization header.
- Unsupported key version, extra/missing segments, illegal base64url, wrong key-ID/secret length.
- Digest encoding corruption or length mismatch that would otherwise make `timingSafeEqual` throw.
- Lookup not found, wrong secret, status `revoked`, `replaced`, or `suspended`.
- Project metadata missing, wrong internal/public project linkage, credential record missing, duplicated states disagree, utility record missing/disabled/corrupt.
- Owner project missing versus belonging to another owner; key missing versus belonging to another project.
- Concurrent revoke/replace, repeated revoke, replace of revoked/replaced key, replacement-ID collision, and failure after only one intended record would have changed (transaction must roll back all).
- More keys than one page, malformed cursor, and cursor from another project's listing request.
- Logger/error paths when repository/crypto/schema code throws unexpectedly.

---

## VALIDATION COMMANDS

Execute every applicable command and retain only secret-free pass/fail evidence.

### Level 1: Syntax & Style

```powershell
npm run format:check
npm run lint
npm run typecheck
```

### Level 2: Targeted Unit Tests

```powershell
npm test -- --project node packages/contracts/src/credentials/contract.test.ts
npm test -- --project node packages/contracts/src/auth/project-context.test.ts
npm test -- --project node packages/backend/src/modules/identity-control/credentials
npm test -- --project node packages/backend/src/modules/project-authentication
npm test -- --project node packages/backend/src/core/observability/redact.test.ts
npm test -- --project node infra/config/control.test.ts infra/composition.test.ts
```

### Level 3: Integration and Full Regression

```powershell
npm test -- --project node tests/integration/project-credential-authentication.test.ts
npm test
npm run test:coverage
npm run build
npm run check
```

Coverage must keep the existing 80% global statement, branch, function, and line thresholds. Security-critical credential/auth paths should have direct behavior assertions even when global coverage already passes.

### Level 4: Infrastructure Preview

```powershell
npm run infra:install -- --stage dev-rus02
npm run infra:diff -- --stage dev-rus02
```

The wrapper must verify account `162067902192`, principal `arn:aws:iam::162067902192:user/ntz-cli`, region `il-central-1`, and the Windows CA bundle before the diff. The diff must show only the expected Lambda/control-route/IAM changes and no new table/index, no replacement/deletion of retained resources, no native API Gateway API key, and no public health/Cognito regression. Stop if the stage is in parallel use or if any unapproved write/bootstrap is requested.

### Level 5: Manual Validation (Requires Separate Explicit Authorization)

Only after explicit owner approval to mutate `dev-rus02` and a successful preview/deployment of that exact implementation:

1. Use an invited owner's Cognito access token to issue a disposable project key through the control API; capture the plaintext only in a temporary process variable, never shell history, a file, chat, logs, or test evidence.
2. Confirm list metadata cannot recover the plaintext or digest.
3. Exercise a local/internal test consumer wired to project-auth middleware (or the first RUS-05 route once it exists) and confirm the trusted internal project context/utility state.
4. Replace the key; confirm the old key fails and the new key succeeds. Revoke the new key; confirm it fails.
5. Confirm application/CloudWatch traces and logs contain no full Authorization header, API key, secret, or digest.
6. Destroy the temporary process variable and report only redacted identifiers/statuses.

Do not invent or deploy a public verify endpoint for this exercise. No live mutation is authorized by this planning request.

### Level 6: AI-Layer Validation

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

Run because `AGENTS.md` repository-status context changes. Restart Codex after that change.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1 — Split high-entropy credential:** Issuance creates a versioned split key with a non-secret 128-bit lookup ID and independent 256-bit secret using Node cryptographic randomness; malformed formats fail closed.
- [ ] **AC2 — Hash-only and one-time display:** Only a SHA-256 digest is persisted, plaintext appears only in the successful issue/replace response, and list/revoke/inspect/store/log/error paths cannot recover or expose it.
- [ ] **AC3 — Owner lifecycle operations:** Validated issue, paginated metadata list, idempotent revoke, and atomic replace operations are available only through Cognito-owner control routes and enforce stored project ownership.
- [ ] **AC4 — Trusted project authentication:** A valid active bearer resolves a frozen internal project context and enabled File Management state; downstream callbacks receive no raw credential or caller-authorizing project ID.
- [ ] **AC5 — Uniform rejection:** Malformed, unknown, wrong-secret, revoked, replaced, suspended, corrupt/mismatched, utility-disabled, and wrong-project credentials all fail with the same safe shared `401` envelope; parseable comparisons use fixed-size timing-safe digest comparison.
- [ ] **AC6 — No leakage:** Credentials/full bearer headers/digests never appear in application logs, traces, URLs, examples, stored metadata, error details, test snapshots, or reports.
- [ ] **AC7 — Safe rotation and multiple keys:** Multiple independently issued keys may remain active; replacement atomically invalidates only its target and creates one new active key; revoke/replace cannot partially update the dual records or expose stored secret material.
- [ ] **AC8 — Explicit security/isolation tests:** Tests cover one-time display, hash-only persistence, lifecycle states, utility enablement, observable failure equivalence, timing-safe comparison seam, transaction races, and cross-owner/cross-project isolation.
- [ ] All targeted and full validation commands pass with zero errors and existing 80% global coverage thresholds.
- [ ] Infrastructure preview shows only expected control route/Lambda/IAM changes and no unapproved resource mutation was performed.
- [ ] README and AGENTS repository status are truthful; canonical product/architecture decisions remain in the wiki.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order.
- [ ] Each task's targeted validation passed immediately.
- [ ] API-key metadata and trusted-context contracts are strict and contain no secret/digest leakage.
- [ ] Dual Dynamo records and all lifecycle transitions are canonical, conditional, and atomic.
- [ ] Owner and project authentication principals remain separate.
- [ ] No scan, native API Gateway API key, synthetic verify route, or new table/index was introduced.
- [ ] One-time issue/replace behavior and inactive-state rejection are explicitly proven.
- [ ] Cross-owner/project isolation and secret-free logs/errors are explicitly proven.
- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run build`, and `npm run check` pass.
- [ ] `dev-rus02` diff was run only after required preflight and shared-stage availability check; no deployment/data mutation occurred without explicit authorization.
- [ ] `python tooling/validate_codex_layer.py` and codebase-search self-test pass after status documentation changes.
- [ ] Codex restart requirement after AGENTS change is reported.
- [ ] Acceptance criteria AC1-AC8 are all checked against evidence.
- [ ] Code is reviewed for release-blocking credential leakage and cross-project defects before commit.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Readiness metadata:** Issue #3 is still labelled `queued`, even though RUS-02 is closed and its implementation is present on `main`. The user explicitly invoked planning, so this plan treats the label as stale. Before implementation begins, update/confirm the issue's `ready` status through the owner-approved GitHub workflow; this plan does not authorize that external write.
- **Dashboard scope:** This plan assumes RUS-03 owns the control API and authentication seam, while RUS-09 owns the complete dashboard credential UI/integration instructions. This follows the RUS-03 estimated touch points and RUS-09 dependency/scope. If the owner requires a usable dashboard issue/one-time-display flow in RUS-03, amend the plan before implementation because it materially expands frontend/public-contract/security work.
- **Digest choice:** This plan deliberately selects unkeyed SHA-256 for an independently generated 256-bit secret, not a password KDF and not HMAC with a pepper. A pepper would require a separately approved secret provisioning/version/rotation design. If defense against a database-only exfiltration is required beyond 256-bit offline-guess resistance, decide that architecture change before implementation and amend the record/runtime/infra tasks.
- **Status administration:** `suspended` is modeled and rejected but not created by an owner endpoint in this ticket. RUS-10 or an explicit follow-up may provide rapid operator suspension. Do not silently add that control operation here.
- **No critical implementation ambiguity remains** under these assumptions. The record topology, API routes, key format, hashing, rotation behavior, middleware seam, tests, and validation order are specified for one-pass execution.

## NOTES (open canvas)

### Why two records instead of a new GSI

A project-partition metadata record makes owner list/revoke/replace native and keeps the digest out of listable output. A direct lookup record makes authentication one keyed read. A second GSI would add schema/index cost and still require careful projection to avoid duplicating sensitive material. The two-record design spends atomic write capacity to obtain simple, bounded read paths; transactions make that duplication explicit and enforceable.

### Why application middleware instead of an API Gateway key/authorizer

Native API Gateway API keys are not authorization and are explicitly rejected by the architecture. A Lambda authorizer would add a second response/error boundary and creates future cache/revocation concerns. The existing async `deriveAuthorization` seam already centralizes validated errors and ensures utility callbacks receive only derived context. Keeping cache-free verification inside each future utility Lambda is the smallest implementation that satisfies immediate revocation and shared-envelope behavior.

### Authentication data flow

```text
Authorization header
  -> exact Bearer/split-key parser
  -> direct lookup by non-secret keyId
  -> SHA-256(presented secret)
  -> timingSafeEqual(stored-or-dummy 32-byte digest)
  -> consistent lookup + project-key + project + utility snapshot
  -> strict linkage/status/utility validation
  -> frozen TrustedProjectContext
  -> future utility callback
```

At no point does a caller project ID become an authorization input. The public project ID in persisted linkage is validated only as stored evidence leading to the hidden internal project identity.

### Rollout and external-action boundary

All automated behavior can be implemented and proven locally. An infrastructure diff against `dev-rus02` is read-only preview evidence after exact AWS identity preflight. Deployment, Cognito interaction, issuing a real key, or modifying data remains a separately authorized action. Never include even disposable live key material in validation evidence.

### Confidence Score

**9/10** for one-pass implementation under the stated assumptions. The existing RUS-02 vertical slice supplies strong patterns for contracts, owner auth, Dynamo transactions, handler composition, redaction, and tests. The principal risk is correctly classifying multi-action Dynamo transaction failures/races while preserving atomic dual-record invariants; the repository tests and explicit error-domain boundary address it. Confidence drops materially if dashboard UI or pepper/secret infrastructure is added without amending the plan.

## AMENDMENTS

(None at creation.)
