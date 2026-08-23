# Feature: RUS-06 Private Download and Stable Public Access

The following plan is complete for the repository state on 2026-08-23, but the implementation agent must still drift-check the cited files, package versions, ticket, and canonical wiki pages before changing code.

Pay special attention to the existing project-scoped repository keys, the sparse public-file index, the JSON-only HTTP helper, the project-specific download lifetime, and the distinction between an authenticated private authorization response and an unauthenticated stable public redirect.

## Feature Description

Implement the download half of File Management. A server application authenticated by its project API key can request a fresh private download authorization for a ready file in its own project. A public file also receives a stable service URL at `GET /files/public/{publicProjectId}/{publicFileId}`; every request to that URL rechecks the public project/file pair and current file state before returning a non-cacheable redirect to a newly presigned S3 `GET` URL.

Both flows keep the stage bucket private, keep file bytes out of Lambda and API Gateway, apply the owning project's configured 1–60 minute download lifetime (default five minutes), and expose no bucket name, object key, AWS internals, full presigned URL in logs, or sensitive query strings. S3 remains the transfer data plane, including range and retry behavior.

## User Story

As a builder integrating File Management into a server-side application,
I want project-authorized private downloads and stable public file URLs,
so that I can deliver private and public files without exposing AWS storage details or rebuilding access control.

## Problem Statement

RUS-05 can create, upload, finalize, list, and inspect files, but there is no authorized download path. Returning a raw object key, making the bucket public, authorizing from a caller-supplied project/file ID, or proxying bytes through the API would violate the approved isolation and transfer boundaries. A long-lived public presigned URL would also bypass later state changes and expiry policy.

The implemented code already stores the required immutable public identity and sparse `PublicFiles` index, but it lacks an exact public-pair repository lookup, an S3 `GET` presigner, ready-state download policy, public-project settings lookup, a redirect-capable HTTP boundary, route wiring, and security tests.

## Solution Statement

Add two download vertical slices inside the existing File Management bounded context:

- `POST /v1/files/{fileId}/downloads` uses the existing project bearer authorizer. It reads the file only through the trusted internal project partition, allows only `ready`, presigns an S3 `GetObjectCommand` for the stored server-generated key, and returns a strict JSON envelope containing file metadata plus an opaque `GET` transfer URL and expiry.
- `GET /files/public/{publicProjectId}/{publicFileId}` requires no credential. It queries the existing sparse `PublicFiles` GSI by the complete public project/file pair, reads the existing project record for its current download lifetime, verifies both records refer to the same internal project, permits only an immutable public `ready` file, and returns `302` with `Location`, `Cache-Control: no-store`, an empty body, and `x-request-id`.

Create a focused download service rather than adding control-table dependencies to the existing upload/list/inspect service. Reuse the existing project repository structurally through a narrow reader interface at composition time. Add a sibling S3 download presigner while preserving the upload presigner API. Generalize the shared HTTP boundary internally just enough to add a dedicated redirect factory; retain the public behavior and signature of `createHttpHandler` for all JSON endpoints.

## Out of Scope / Non-Goals

- Not included: trash, restore, purge, force-delete, or new lifecycle persistence/state transitions (RUS-07). Download checks must use a `status === "ready"` allow-list so future trashed states are denied by default; a purged/missing record is denied as not found.
- Not included: CloudTrail download metering, outbound-byte charging, reconciliation, or enabling non-zero download pricing (RUS-08).
- Not included: dashboard download buttons, public URL copy UI, integration instructions, or browser/mobile delegated authorization (RUS-09).
- Not included: CloudFront file delivery, custom domains, multipart downloads, S3 Transfer Acceleration, SDKs, or proxying file bytes.
- Not included: mutable visibility, rename, folders, arbitrary metadata, or caller-selected object keys.
- Not changing: the private bucket, Block Public Access, RUS-05 upload/finalization/quota behavior, existing JSON/error envelopes, project bearer format, or Cognito control routes.
- Not guaranteeing immediate public-index visibility after finalization: DynamoDB GSIs are eventually consistent. The safe behavior during propagation is a temporary `404`, never a fallback lookup or redirect.
- Not signing or forwarding a fixed `Range` header. Clients may send their own single-range request to the presigned S3 URL; S3 owns transfer semantics.

## Feature Metadata

**Feature Type**: New Capability  
**Estimated Complexity**: High  
**Primary Systems Affected**: shared contracts, HTTP boundary, File Management repository/service/handlers/runtime, S3 presigning, API route/IAM composition, integration and security tests  
**Dependencies**: implemented RUS-03 project authentication, RUS-05 file repository/state/public identity, AWS SDK v3 `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` 3.1116.0, Zod 4.4.3, SST 4.17.1, API Gateway HTTP API payload v2

## Related Work

**Implements**: [GitHub issue RUS-06](https://github.com/noamtz/utility-services/issues/6)  ·  **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) and [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture)

**Back-references**:

- `.agents/plans/rus-05-direct-upload-file-metadata-lifecycle.md` - Establishes the file item, immutable visibility/public IDs, sparse public GSI, private S3 key, ready-state transition, repository conventions, and upload presigner mirrored here.
- `.agents/plans/rus-03-project-credential-lifecycle-authentication.md` - Establishes trusted project context and the uniform project-bearer authorization seam used by the private route.
- `.agents/plans/rus-02-invite-only-owner-project-control.md` - Establishes the public project identity and project-level upload/download lifetime settings read by the public route.

**Forward-references**:

- [RUS-07](https://github.com/noamtz/utility-services/issues/7) - Extends lifecycle states; it must preserve the ready-only download allow-list.
- [RUS-08](https://github.com/noamtz/utility-services/issues/8) - Meters actual successful S3 `GetObject` traffic produced by these URLs.
- [RUS-09](https://github.com/noamtz/utility-services/issues/9) - Consumes both download contracts in the dashboard and canonical `curl` journey.
- [RUS-11](https://github.com/noamtz/utility-services/issues/11) - Proves the deployed private/public, expiry, range, isolation, and release journey.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` - Repository boundaries, security/release blockers, AWS identity/stage policy, and validation commands.
- `package.json` (lines 1-38) - Node 24/npm 11 engines, full quality gates, and pinned workspace tooling.
- `packages/backend/package.json` (lines 1-18) - Exact AWS SDK, Powertools, SST, and Zod versions; no new dependency is required.
- `packages/contracts/src/files/contract.ts` (lines 9-14, 52-84, 86-139) - File/public ID, immutable visibility, status, paths, DTO, and upload envelope patterns to extend.
- `packages/contracts/src/projects/contract.ts` (lines 4-27) - Five-minute default and strict 1–60 minute download lifetime.
- `packages/contracts/src/index.ts` (lines 75-108) - Public File Management contract export surface.
- `packages/backend/src/modules/file-management/model.ts` (lines 38-92, 96-120, 130-190, 208-249) - Stored file state, canonical object keys, exact public-index key helpers, invariants, and immutable sparse public fields.
- `packages/backend/src/modules/file-management/repository.ts` (lines 43-69, 125-172, 177-207) - Repository interface, corrupt-record mapping, project-scoped consistent read, and Dynamo query conventions.
- `packages/backend/src/modules/file-management/service.ts` (lines 29-45, 47-63, 147-185) - Existing public DTO mapping, generic not-found behavior, project scoping, and service dependency style. Keep upload/list/inspect behavior unchanged.
- `packages/backend/src/modules/file-management/presigning.ts` (lines 1-72) - Canonical-key, HTTPS, TTL, injectable signer, and `getSignedUrl` patterns for the sibling `GET` presigner.
- `packages/backend/src/modules/file-management/handlers.ts` (lines 20-57) - Thin schema/auth/service handler factories; private download must mirror `createInspectFileHandler`.
- `packages/backend/src/modules/file-management/runtime.ts` (lines 20-45, 68-100) - API composition, shared clients/resources, repository index names, service assembly, and handler registry.
- `packages/backend/src/modules/identity-control/projects/repository.ts` (lines 31-40, 85-89, 159-197) - Existing public-project reader that assembles the project and current download settings without adding a second control-table access pattern.
- `packages/backend/src/modules/project-authentication/authorization.ts` (lines 4-12) - Bearer-to-trusted-context derivation for the private route.
- `packages/backend/src/modules/project-authentication/service.ts` (lines 64-95) - Active credential/project linkage and File Management enablement guarantees present in `TrustedProjectContext`.
- `packages/backend/src/core/http/handler.ts` (lines 18-57, 59-112, 154-178, 181-264) - Shared input parsing, request IDs, safe errors/logging, JSON-only success path, and the seam for a redirect factory.
- `packages/backend/src/core/observability/redact.ts` (lines 6-45, 53-90) - Existing `downloadUrl`/`transferUrl` key redaction and query/fragment stripping.
- `infra/config/file-management.ts` (lines 5-33, 35-50, 54-79) - Existing `PublicFiles` GSI, private-bucket policy, route descriptors, and route-specific permissions.
- `infra/dynamo-link.ts` (lines 1-15) - Linked-table baseline `Query` permission already covers table and index ARNs; `GetItem` remains explicit.
- `infra/bucket-link.ts` (lines 1-10) - Bucket links grant no implicit permissions; both download routes need explicit `s3:GetObject`.
- `infra/api.ts` (lines 80-105) - File route loop, resource links, object ARN, permissions, and no Cognito JWT on project/public utility routes.
- `packages/backend/src/modules/file-management/handlers.test.ts` (lines 55-75, 77-175) - API Gateway event factory, service/auth doubles, envelope, and project authorization tests.
- `packages/backend/src/modules/file-management/repository.test.ts` (lines 38-120) - AWS command inspection and malformed-record repository tests.
- `packages/backend/src/modules/file-management/presigning.test.ts` (lines 9-82) - Injectable signer and exact S3 command/expiry assertions.
- `packages/backend/src/core/http/handler.test.ts` (lines 31-217) - Validation, envelope, correlation, error, and safe-log behavior that must remain regression-free.
- `packages/backend/src/core/observability/redact.test.ts` (lines 64-81) - Presigned transfer URL/query redaction regression seam.
- `packages/backend/src/modules/file-management/runtime.test.ts` (lines 19-56) - Composition/resource validation and handler-registry expectations.
- `tests/integration/direct-upload-file-lifecycle.test.ts` (lines 83-185, 289-405) - In-memory file repository, assembled auth/file flow, ready state, and project-isolation test pattern to extend.
- `infra/config/file-management.test.ts` (lines 1-49), `infra/composition.test.ts` (lines 13-61), and `infra/file-management.test.ts` (lines 64-95) - Exact route inventory, deny-list, least privilege, bucket privacy, and infrastructure composition assertions.

### New Files to Create

- `packages/backend/src/modules/file-management/downloads.ts` - Private/public download orchestration, ready-only policy, project-settings resolution, exact identity checks, and fresh expiry calculation.
- `packages/backend/src/modules/file-management/downloads.test.ts` - Unit matrix for project isolation, public pair/state/visibility, TTL bounds/default, future lifecycle denial, signer failures, and no capability on rejection.
- `packages/backend/src/functions/files/authorize-download.ts` - One-line private download handler export.
- `packages/backend/src/functions/files/public-download.ts` - One-line stable public redirect handler export.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Canonical Architecture: File contracts, project isolation, and presigned transfers](https://github.com/noamtz/utility-services/wiki/Architecture#file-contracts-and-project-isolation)
  - Why: exact trusted-context, stable public pair, private bucket, temporary URL, direct transfer, and lifecycle boundaries.
- [AWS SDK for JavaScript v3 S3 presigned URL migration](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html#amazon-s3-presigned-url)
  - Why: official `GetObjectCommand` plus `getSignedUrl(client, command, { expiresIn })` pattern.
- [Amazon S3 GetObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html#API_GetObject_RequestSyntax)
  - Why: `Range`, `206 Partial Content`, response headers, and `GetObject` request semantics. Do not add a fixed/signed Range in this ticket.
- [Amazon S3 presigned URL expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html#using-presigned-url-expiration)
  - Why: URL validity is bounded by both `expiresIn` and the signing credential lifetime; S3 evaluates expiry when a request begins.
- [Signature Version 4 query authentication](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html#query-string-auth-v4-signing)
  - Why: official `X-Amz-Expires` bounds; the product's 60–3,600 seconds is safely within them.
- [API Gateway HTTP API Lambda response format](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.response)
  - Why: payload v2 permits explicit `statusCode`, `headers`, and `body`, including `302` plus `Location`.
- [SST ApiGatewayV2 routes](https://sst.dev/docs/component/aws/apigatewayv2/#route)
  - Why: exact method/path registration and path-parameter syntax for the two Lambda routes.

### Patterns to Follow

**Naming Conventions:**

- Public JSON and path fields use camelCase: `fileId`, `publicProjectId`, `publicFileId`, `expiresAt`.
- Route descriptors and Lambda component names use PascalCase, e.g. `AuthorizeFileDownloadRoute` and `PublicFileDownloadRoute`.
- Function entry points remain one-line kebab-case files under `src/functions/files`.
- Stored keys remain uppercase tagged strings produced only by model helpers.

**Project-scoped private read:**

```ts
const item = await repository.get(project.internalProjectId, fileId);
if (!item || item.internalProjectId !== project.internalProjectId) throw fileNotFound();
```

Extend this pattern with `item.status === "ready"`. Do not use `publicProjectId`, `fileId`, public IDs, headers, or query parameters as proof of authority.

**Exact public lookup:**

```ts
KeyConditionExpression: "gsi1pk = :project AND gsi1sk = :file"
```

Use `publicFilePartitionKey(publicProjectId)` and `publicFileSortKey(publicFileId)`, `IndexName: publicIndexName`, and `Limit: 2`. Zero is missing; more than one or malformed/mismatched data is corruption and must never select an arbitrary record.

**Ready-only policy:**

```ts
if (item.status !== "ready") throw fileNotFound();
```

This is intentionally an allow-list. Pending, failed, future trashed states, and missing/purged records receive no transfer capability.

**Transfer presigner:**

```ts
const command = new GetObjectCommand({ Bucket: bucketName, Key: objectKey });
const url = await sign(client, command, { expiresIn: expiresInSeconds });
```

Validate the canonical object key and 60–3,600 second lifetime before signing, and validate the returned URL as HTTPS. Do not add `Range`, bucket/key fields to responses, or hand-append query parameters after signing.

**HTTP success/error split:**

- Private route: existing `{ data, requestId }` JSON success envelope and error envelopes.
- Public route success: `{ statusCode: 302, headers: { location, "cache-control": "no-store", "x-request-id": requestId }, body: "" }`.
- Public route rejection: the existing JSON error envelope with the same correlation header.
- Neither shared helper may log callback data, response bodies, `Location`, bearer headers, full URLs, or query strings.

**Error Handling:**

- Missing, wrong-project, non-ready, private-through-public-path, mismatched public pair, and missing public project return the same safe `404 FILE_NOT_FOUND` result and never invoke the signer.
- Invalid path syntax uses the shared `400 VALIDATION_ERROR` envelope.
- Authentication failures remain the shared `401 UNAUTHORIZED` result.
- Corrupt stored state and unexpected AWS/signing failures remain redacted safe `500 INTERNAL_ERROR`; do not translate infrastructure failures into false authorization successes.

---

## IMPLEMENTATION PLAN

### Phase 1: Public Contracts and HTTP Boundary

Define the strict private download response and public path. Add a narrowly scoped redirect handler factory by sharing the existing parsing, authorization, error, request-ID, and logging pipeline internally while keeping `createHttpHandler`'s external JSON behavior unchanged.

**Tasks:**

- Add download transfer/authorization and public path schemas/types/exports/tests.
- Refactor the HTTP handler's internal success rendering without changing existing callers.
- Add a fixed 302 redirect factory with HTTPS `Location`, no-store, empty body, and existing error envelopes.

### Phase 2: Data Access and Presigning

**Depends on:** Phase 1 for the download result shapes.

Implement exact public-pair access through the already-provisioned GSI and an S3 `GET` presigner that uses only the stored canonical object key and bounded project lifetime.

**Tasks:**

- Extend the repository with exact public lookup and corruption checks.
- Add the public index name to API and worker repository construction.
- Add a sibling download presigner with exact command/expiry/HTTPS tests.

### Phase 3: Download Domain and Handlers

**Depends on:** Phase 2 for repository and presigner contracts.

Create a focused download service. The private operation consumes only trusted context. The public operation consumes the complete public pair, uses the existing project repository for current download settings, verifies internal-project linkage, and permits only public ready state. Compose the two handler factories and thin Lambda entry points.

**Tasks:**

- Implement private and public authorization with a shared fresh-transfer helper.
- Wire current project settings into the public flow without copying settings into file records.
- Add private JSON and public redirect handler factories and runtime exports.

### Phase 4: Infrastructure and Integration

**Depends on:** Phase 3 for deployed entry points.

Register the exact routes and least-privilege permissions, then prove assembled isolation, state, expiry, redirect, range-capability, and redaction behavior.

**Tasks:**

- Add `POST /v1/files/{fileId}/downloads` and `GET /files/public/{publicProjectId}/{publicFileId}`.
- Grant only the existing control/file reads and `s3:GetObject` over `projects/*`; keep the bucket private.
- Extend unit, integration, composition, coverage, and optional preview/deployed validation.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. UPDATE `packages/contracts/src/files/contract.ts`, `packages/contracts/src/files/contract.test.ts`, and `packages/contracts/src/index.ts`

- **IMPLEMENT**: add `PublicFilePathSchema` as a strict object containing `PublicProjectIdSchema` and `PublicFileIdSchema`.
- **IMPLEMENT**: add a strict reusable download transfer object with `method: "GET"`, HTTPS `url`, and offset-aware `expiresAt`; add `DownloadAuthorizationSchema` containing the existing `FileSchema` plus nested `download` transfer details; add its success-envelope schema and inferred types.
- **TEST**: accept valid private/public file metadata and URLs; reject HTTP URLs, unknown fields, malformed public IDs, missing expiry/method, bucket/key-like extra fields, and invalid state/visibility projections.
- **PATTERN**: mirror `UploadAuthorizationSchema` at `files/contract.ts:103-127` and the existing strict path schemas.
- **GOTCHA**: the public redirect has no JSON success schema. Do not expose a public file DTO, object key, bucket, internal project ID, or presigned query pieces through that route.
- **VALIDATE**: `npx vitest run --project node packages/contracts/src/files/contract.test.ts`
- **SATISFIES**: AC3, AC4, AC5, AC7.

### 2. UPDATE `packages/backend/src/core/http/handler.ts` and `packages/backend/src/core/http/handler.test.ts`

- **IMPLEMENT**: factor the existing event parsing, optional authorization, callback invocation, `HttpError` mapping, request ID, and logger calls into one internal boundary runner with an injected success renderer.
- **IMPLEMENT**: retain `createHttpHandler`'s current signature, 2xx validation, JSON envelope, headers, and observable behavior exactly. Add `createHttpRedirectHandler` as a narrow public factory whose callback result is schema-validated before it returns fixed `302`, lowercase `location`, `cache-control: no-store`, `x-request-id`, and `body: ""`.
- **TEST**: all existing JSON tests remain unchanged; redirect success has no JSON/content body, preserves the full Location only in the response, rejects invalid paths/HTTP locations through safe envelopes, maps service errors identically, and logs method/path/status without logging Location or callback data.
- **GOTCHA**: do not loosen `successStatusCode` to arbitrary 3xx for existing JSON callers and do not create a second copy of gateway parsing/error logic.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/core/http/handler.test.ts`
- **SATISFIES**: AC2, AC3, AC6.

### 3. UPDATE `packages/backend/src/modules/file-management/presigning.ts` and `packages/backend/src/modules/file-management/presigning.test.ts`

- **IMPLEMENT**: add `DownloadPresigner`, `PresignedDownload`, and `createS3DownloadPresigner` beside the existing upload types/factory. Reuse canonical `parseFileObjectKey`, strict nonempty bucket parsing, 60–3,600 second validation, injectable `getSignedUrl`, and HTTPS result parsing.
- **IMPLEMENT**: create only `new GetObjectCommand({ Bucket, Key })`; pass `{ expiresIn }` to the signer. Do not include `Range`, `ResponseContentDisposition`, content headers, or caller-provided S3 properties.
- **TEST**: exact bucket/key command, 60/300/3,600 seconds, invalid key/lifetime/URL rejection, no `Range` or response overrides, and real/static-credential URL query evidence (or injected signer options) showing the exact expiry rather than a default.
- **GOTCHA**: the presigned URL is a bearer capability. It may be returned to the authorized caller or `Location` header but never logged or included in thrown error text.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/presigning.test.ts`
- **SATISFIES**: AC3, AC5, AC6, AC7, AC8.

### 4. UPDATE `packages/backend/src/modules/file-management/repository.ts` and `packages/backend/src/modules/file-management/repository.test.ts`

- **IMPLEMENT**: extend `FileRepository` with `getPublic(publicProjectId, publicFileId)`. Add required `publicIndexName` to `createDynamoFileRepository` options.
- **IMPLEMENT**: query the sparse GSI with both key components and `Limit: 2`; do not request strong consistency on a GSI. Parse with `parseFileItem`, recheck `visibility`, public IDs, and derived GSI keys, and return undefined only for zero records.
- **IMPLEMENT**: treat multiple, malformed, private, or identity-inconsistent returned records as `CorruptFileRecordError`; never choose the first record or fall back to scan, single-ID lookup, primary-key guessing, or object-prefix construction.
- **TEST**: exact command/index/key values; zero/one/multiple results; malformed item; wrong public project/file identity; private record; and no table scan.
- **PATTERN**: preserve the project-scoped consistent `get()` at `repository.ts:163-172` unchanged for private authorization.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/repository.test.ts`
- **SATISFIES**: AC1, AC2, AC4, AC8.

### 5. CREATE `packages/backend/src/modules/file-management/downloads.ts` and `downloads.test.ts`

- **IMPLEMENT**: define a narrow `PublicProjectReader` that structurally accepts the existing `ProjectRepository.inspect()` result needed for `internalProjectId`, `publicProjectId`, and `fileManagement.downloadUrlLifetimeMinutes`. Do not duplicate a control-table adapter or copy project settings into file items.
- **IMPLEMENT**: `authorizePrivate(project, fileId)` reads only `repository.get(project.internalProjectId, fileId)`, rechecks the internal project, requires ready state, and returns `DownloadAuthorizationSchema` with `toPublicFile(item)`, a fresh GET URL, and `now + project.fileManagement.downloadUrlLifetimeMinutes`.
- **IMPLEMENT**: `authorizePublic(publicProjectId, publicFileId)` reads the exact public file and current public project (parallel reads are acceptable), verifies both public IDs and the same internal project, requires `visibility === "public"` and `status === "ready"`, uses the project's current download lifetime, and returns an internal redirect result without public JSON metadata.
- **IMPLEMENT**: use one shared presign helper so private/public expiry and signing rules cannot drift. Permit authenticated download of either a ready private or ready public file; “private” names the authenticated path, not a visibility exclusion.
- **TEST**: own ready private/public success; cross-project private file; missing file; pending/failed; future-shaped `trashed` denial; purged/missing denial; correct public pair; guessed ID; wrong project/file pairing; private-through-public; missing/mismatched project; default five minutes; project-specific one and sixty minutes; reauthorization after clock advance yields a fresh expiry/signer call; signer failure; and no signer invocation for every denial.
- **GOTCHA**: do not compare against a deny-list. Only exact `ready` is downloadable, which keeps RUS-07 lifecycle additions safe.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/downloads.test.ts packages/backend/src/modules/file-management/service.test.ts`
- **SATISFIES**: AC1, AC2, AC3, AC4, AC5, AC8.

### 6. UPDATE handler/runtime wiring and CREATE the two Lambda entry points

- **UPDATE**: `packages/backend/src/modules/file-management/handlers.ts` and `.test.ts` with:
  - private handler using `FilePathSchema`, `DownloadAuthorizationSchema`, `createProjectAuthorization`, JSON envelope, and the download service;
  - public handler using `PublicFilePathSchema`, no authentication derivation, the redirect helper, and only the URL returned by the public download service.
- **UPDATE**: `packages/backend/src/modules/file-management/runtime.ts` and `.test.ts` to create the existing project repository with the shared control client, add `publicIndexName: "PublicFiles"` to every file repository construction, compose the download presigner/service, and expose `authorizeDownload` and `publicDownload` handlers with `safeLogger`.
- **CREATE**: thin `authorize-download.ts` and `public-download.ts` exports using `getFileHandlers()`.
- **TEST**: valid private envelope, missing/malformed bearer, wrong project, public 302/no-store/empty body, public 404 state matrix, validation errors, request IDs, no URL in logger calls, and handler registry/resource option validation.
- **GOTCHA**: do not authenticate the public route and do not allow its path IDs to flow into the private project-scoped lookup. Do not return JSON on public success.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/handlers.test.ts packages/backend/src/modules/file-management/runtime.test.ts packages/backend/src/core/observability/redact.test.ts`
- **SATISFIES**: AC1, AC2, AC3, AC4, AC6, AC8.

### 7. UPDATE `infra/config/file-management.ts`, its tests, `infra/composition.test.ts`, and verify `infra/api.ts`

- **IMPLEMENT**: register `POST /v1/files/{fileId}/downloads` -> `authorize-download.handler` with auth-verification control reads, project-scoped file `GetItem`, and `s3:GetObject`.
- **IMPLEMENT**: register exact stable `GET /files/public/{publicProjectId}/{publicFileId}` -> `public-download.handler`; it needs the linked control/file tables' baseline `Query` permissions and explicit `s3:GetObject`, but no Cognito JWT and no credential-specific extra read.
- **VERIFY**: the existing `createApi` loop links control/file/bucket resources, applies explicit actions over the stage table and `projects/*` object ARN, and creates both routes without widening permissions. Change `infra/api.ts` only if route metadata cannot express the required split cleanly.
- **TEST**: exact five-route order/list, distinct handler names, `GetObject` only on the object ARN, private `GetItem`, public GSI `Query` via baseline, no `s3:*`/`dynamodb:*`, no put/delete/list permissions, unchanged Block Public Access, no CORS/public bucket access, and no Lambda/API byte/body integration.
- **GOTCHA**: signing `GetObject` requires the Lambda's S3 permission even though S3 later serves the bytes. Both handlers must be limited to the stage bucket's `projects/*` objects.
- **VALIDATE**: `npx vitest run --project node infra/config/file-management.test.ts infra/composition.test.ts infra/file-management.test.ts infra/bucket-link.test.ts`
- **SATISFIES**: AC2, AC3, AC6, AC7, AC8.

### 8. UPDATE `tests/integration/direct-upload-file-lifecycle.test.ts`

- **IMPLEMENT**: extend the in-memory repository with exact public-pair lookup and add an in-memory public project reader. Assemble authentication, upload/finalization, download service, and handlers using two independent projects.
- **TEST**: upload/finalize a private file and public file; owning project private authorization succeeds for each; a second project using the first file ID receives 404/no URL; correct stable public pair returns 302; guessed/wrong pair, private, pending, failed, trashed-shaped, and removed/purged records do not redirect.
- **TEST**: assert every authorization call signs a fresh URL with the current project's TTL; old/expired authorization is never reused. Assert the redirect has no-store, Location is opaque, and response bodies/log captures contain no bucket, object key, signing query, or authorization header.
- **TEST**: prove range capability at the boundary by asserting `GetObjectCommand` has no fixed `Range` and the public response redirects directly to S3. Leave actual S3 `206` behavior to the explicitly authorized disposable-stage exercise below.
- **GOTCHA**: do not turn this into RUS-07 lifecycle persistence or RUS-08 metering. The test may use a future-shaped non-ready status to prove the allow-list; production status expansion belongs to RUS-07.
- **VALIDATE**: `npx vitest run --project node tests/integration/direct-upload-file-lifecycle.test.ts`
- **SATISFIES**: AC1 through AC8.

### 9. RUN full local validation and the safe infrastructure preview gate

- **VALIDATE**: `npm run format:check`
- **VALIDATE**: `npm run lint`
- **VALIDATE**: `npm run typecheck`
- **VALIDATE**: `npm test`
- **VALIDATE**: `npm run test:coverage`
- **VALIDATE**: `npm run build`
- **VALIDATE**: `npm run check`
- **VALIDATE**: after confirming `dev-rus02` is not being used concurrently and local tests pass, run `npm run infra:diff -- --stage dev-rus02`. The wrapper must verify AWS account `162067902192`, principal `arn:aws:iam::162067902192:user/ntz-cli`, region `il-central-1`, and the configured CA bundle. Stop on identity mismatch, bootstrap/write prompts, replacement/deletion, public bucket changes, or permission widening.
- **GOTCHA**: preview is not deployment authorization. Do not deploy, create fixtures/credentials, mutate data, or remove a stage without explicit owner authorization.
- **SATISFIES**: all acceptance criteria and the repository quality gate.

---

## TESTING STRATEGY

### Unit Tests

- Contracts reject malformed IDs, insecure URLs, extra fields, and internal/AWS leakage.
- HTTP boundary regression-tests every existing JSON behavior plus 302/no-store/empty-body/error/log behavior.
- Presigner tests inspect the real `GetObjectCommand` and signer options, including absence of Range.
- Repository tests inspect the exact GSI query and fail closed for duplicate/corrupt/mismatched results.
- Download service tests use injectable repository/project reader/presigner/time to cover the complete authorization matrix without AWS.
- Handler tests prove authorization ordering, response shape, request correlation, and capability-free logs.
- Infrastructure tests prove exact routes, links, IAM actions, and unchanged bucket privacy.

### Integration Tests

Extend the existing direct-upload lifecycle integration rather than create a disconnected fixture. The assembled test must take files from pending through verified ready, then exercise both download paths with two projects. It must prove that file IDs and public IDs are identifiers only, that current project settings determine expiry, and that no denied path invokes the presigner.

### Edge Cases

- Missing, malformed, guessed, or cross-project private file ID.
- Correct public file ID under the wrong public project ID and vice versa.
- Duplicate or corrupt public-index records.
- Private file queried on the public route.
- Pending, failed, future trashed, removed/purged, and eventual-consistency-missing records.
- Ready public file available through authenticated owner path and public stable path.
- One-minute, default five-minute, and sixty-minute lifetimes; fresh authorization after prior expiry.
- Invalid/noncanonical object key and insecure/malformed signer URL.
- Presigner/AWS failure without stored-state mutation or URL leakage.
- Redirect caching, body/content type, request ID, and safe error envelopes.
- Arbitrary client Range left unsigned; no byte body through API/Lambda.
- Full presigned query, bearer header, bucket name, object key, and internal project ID absent from logs/errors/public JSON.

---

## VALIDATION COMMANDS

Execute every command from the repository root.

### Level 1: Syntax & Style

```powershell
npm run format:check
npm run lint
npm run typecheck
```

### Level 2: Focused Unit Tests

```powershell
npx vitest run --project node packages/contracts/src/files/contract.test.ts packages/backend/src/core/http/handler.test.ts packages/backend/src/core/observability/redact.test.ts packages/backend/src/modules/file-management/presigning.test.ts packages/backend/src/modules/file-management/repository.test.ts packages/backend/src/modules/file-management/downloads.test.ts packages/backend/src/modules/file-management/handlers.test.ts packages/backend/src/modules/file-management/runtime.test.ts
```

### Level 3: Integration, Infrastructure, and Full Suite

```powershell
npx vitest run --project node tests/integration/direct-upload-file-lifecycle.test.ts infra/config/file-management.test.ts infra/composition.test.ts infra/file-management.test.ts infra/bucket-link.test.ts
npm test
npm run test:coverage
npm run build
npm run check
```

Coverage must retain the configured 80% statements, branches, functions, and lines thresholds.

### Level 4: Manual Local Boundary Validation

Use handler/service fixtures only; no AWS mutation is needed:

1. Call the private handler with a valid project key context and ready own file; validate the strict download envelope and five-minute default.
2. Call with another project's file ID; validate identical 404/no signer behavior.
3. Call the public handler with correct public pair; validate 302, opaque `Location`, empty body, no-store, and request ID.
4. Repeat with private, pending, failed, wrong-pair, and missing records; validate no redirect and no signed URL in captured logs.

### Level 5: Infrastructure Preview and Authorized Disposable-Stage Exercise

Preview only after the local suite:

```powershell
npm run infra:diff -- --stage dev-rus02
```

The diff must contain only the two Lambdas/routes and their narrow control/file/S3 permissions; no bucket exposure, table/index replacement, unrelated resource changes, or deployment is acceptable.

Only after separate owner authorization to deploy/mutate the shared development stage, use disposable files to validate:

1. Private file succeeds only with its owning project credential.
2. Public stable URL responds with a fresh 302 on repeated requests; Location changes or its signing timestamp/expiry refreshes.
3. `curl -L -H "Range: bytes=0-9" <stable-public-url>` reaches S3 and returns the expected ten bytes/`206` final response without Lambda/API body transfer.
4. A one-minute URL fails on a new S3 request after expiry, while requesting the stable/API route again returns a fresh usable URL.
5. Changing/removing the test file from ready/public availability prevents a new public redirect.
6. CloudWatch logs contain request IDs/statuses but no bearer values, full Location, signing query, bucket, or object key.

Do not deploy or create credentials/fixtures as part of plan execution without that explicit authorization.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1 — Trusted private authorization:** `POST /v1/files/{fileId}/downloads` authenticates the project bearer, reads by trusted internal project partition plus file ID, permits only ready files, and returns the same safe not-found behavior for missing/cross-project/non-ready records.
- [ ] **AC2 — Stable public route:** exact `GET /files/public/{publicProjectId}/{publicFileId}` performs an unauthenticated but exact public-pair/state/project-linkage check and redirects only a ready immutable public file belonging to that public project.
- [ ] **AC3 — Fresh opaque GET capability:** both paths create a new bounded S3 `GetObject` URL for the stored server key; private JSON returns a complete opaque URL and public success is 302 Location with no bucket/key/AWS fields.
- [ ] **AC4 — Fail-closed visibility/lifecycle:** private-through-public, guessed/mismatched IDs, pending, failed, trashed/future non-ready, purged/missing, duplicate, and corrupt records never receive a transfer capability; visibility remains immutable.
- [ ] **AC5 — Project lifetime:** private and public flows use the current owning project's strict 1–60 minute download lifetime, default five minutes, and reauthorization creates a fresh URL after expiry.
- [ ] **AC6 — Secret-safe observability:** no full presigned URL, Location, signing query, bearer, bucket, object key, or internal project ID appears in logs/errors/public JSON; public success is explicitly non-cacheable.
- [ ] **AC7 — Direct range-capable transfer:** S3 remains private and serves all bytes directly; the signer does not fix Range, and Lambda/API Gateway never proxy a file body.
- [ ] **AC8 — Explicit regression evidence:** unit/integration/infra tests cover cross-project IDs, guessed public pairs, private exposure, ready/non-ready transitions, expiry, range-capable redirect, redacted logs, exact routes, and least-privilege permissions.
- [ ] All focused and repository-wide formatting, lint, type, test, 80% coverage, and build gates pass.
- [ ] A fresh `dev-rus02` infrastructure diff is reviewed with the exact AWS identity and shows no destructive/public/unrelated changes; deployment remains separately authorized.

---

## COMPLETION CHECKLIST

- [ ] Ticket, wiki architecture, RUS-05 plan, and cited code are drift-checked before implementation.
- [ ] Tasks 1–9 complete in order and each focused validation passes immediately.
- [ ] Every acceptance criterion has automated evidence at its owning boundary.
- [ ] Existing upload/list/inspect, authentication, HTTP envelope, and bucket privacy tests remain green.
- [ ] Full test suite, coverage thresholds, typecheck, lint, formatting, and build pass.
- [ ] Infrastructure diff is identity-verified and reviewed without deploying.
- [ ] No architecture, public contract, security, lifecycle, metering, or dashboard scope was silently expanded.
- [ ] Manual deployed checks are either completed under explicit authorization or clearly recorded as pending external validation.
- [ ] Code review treats cross-project access, private exposure, URL leakage, and file-byte proxying as release blockers.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Ticket-level route decision:** the canonical architecture specifies the operations but only fixes the public path. This plan chooses `POST /v1/files/{fileId}/downloads` for the private capability issuance: POST prevents cache-oriented semantics and plural `downloads` represents creation of a fresh ephemeral authorization. Approve/change this before implementation; changing it after integration is a public-contract change.
- **Authenticated public-file behavior:** the authenticated route may download any ready file owned by the project, including a public file. Public visibility adds the stable route; it does not remove owner-authorized access.
- **Public project settings lookup:** the public route reads the existing control-table project record on each request so current download lifetime applies. It does not snapshot the lifetime into file metadata.
- **Eventual consistency:** safe temporary 404 from the public GSI is accepted. No primary-table fallback can be built from untrusted public path IDs without weakening the established access pattern.
- **RUS-07 coordination:** the repository currently models only pending/ready/failed. RUS-06 does not introduce trash/purge persistence. Its ready-only predicate and future-shaped denial test are the compatibility contract RUS-07 must preserve.
- **Redirect code:** use 302, not 301, because public state and the S3 capability must be revalidated. `Cache-Control: no-store` is mandatory. If implementation evidence shows a specific integration requires 307, that is a public behavior decision to review rather than change silently.
- **Content disposition:** do not set `ResponseContentDisposition` in RUS-06. The requirements do not define inline/attachment or filename encoding, and adding signed response overrides would create a new public behavior. S3 continues to return stored object metadata.
- No blocking architecture question remains if the private route decision above is accepted during plan review.

## NOTES (open canvas)

The main security/data flow is:

```text
Private:
Bearer -> verified TrustedProjectContext -> PK(internalProjectId)+fileId -> ready
       -> GetObject(server objectKey, project TTL) -> JSON opaque URL -> client -> S3

Public:
publicProjectId+publicFileId -> exact sparse GSI pair ----┐
publicProjectId -> existing project/settings -----------+-> same internal project
                                                         -> public + ready
                                                         -> GetObject(server objectKey, project TTL)
                                                         -> 302 no-store -> client -> S3
```

The project read on the public path is necessary even though the file record contains both project IDs: the download lifetime is project configuration and may change independently. Reusing `ProjectRepository.inspect` keeps the control-table schema authoritative and avoids cross-context duplication.

The redirect helper belongs in the shared HTTP boundary because public success is non-JSON but validation, safe errors, request IDs, and logging are universal. A single internal runner plus two fixed success renderers is safer than a bespoke Lambda handler that duplicates parsing/error behavior or a general raw-response escape hatch that every domain could misuse.

Do not add a range header to the signature. A normal presigned `GetObject` URL allows the downstream client to send `Range`; S3 returns the partial body. The API's responsibility is to redirect without consuming the body, not to forward request headers itself.

Confidence score for one-pass implementation: **8.8/10**. The implemented RUS-05 public index, key invariants, presigner pattern, trusted context, and test harness make the change well-bounded. The remaining risk is coordination with RUS-07's future lifecycle representation and the new shared redirect response seam; both are explicitly isolated and covered by regression tests.

## AMENDMENTS

<!-- Append approved/executed plan changes here; newest entry at the bottom. -->
