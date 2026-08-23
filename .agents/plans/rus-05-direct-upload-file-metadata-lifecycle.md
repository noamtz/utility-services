# Feature: RUS-05 Direct Upload and File Metadata Lifecycle

The following plan is complete, but implementation must revalidate the issue state, current repository patterns, installed SST/AWS SDK types, and the cited official documentation before changing files. Pay particular attention to signed upload headers, atomic quota reservation, at-least-once S3 notifications, retryable usage handoff, and the rule that neither a file ID nor an object key is authorization.

## Feature Description

Implement the upload half of the File Management utility. A server-side application authenticated with an existing project API key can create a pending file record, receive one short-lived opaque S3 `PUT` URL, send the bytes directly to the stage-private bucket, and later list or inspect the file after an asynchronous processor has verified the object and finalized it. The slice also establishes the file table, file repository/state contract, retained-storage quota accounting, public/private identity fields needed by RUS-06, and the RUS-04 upload/storage usage handoff needed by later lifecycle tickets.

This ticket does not proxy bytes through Lambda or API Gateway. It authorizes and observes the transfer; S3 remains the data plane.

## User Story

As a builder integrating a server-side application,
I want to authorize a project-scoped file upload and transfer the bytes directly to storage,
So that I can reuse secure file handling without provisioning or understanding AWS infrastructure.

## Problem Statement

RUS-03 can authenticate a project and RUS-04 can record idempotent usage, but the repository has no File Management domain, metadata table, file bucket, upload contract, quota reservation, presigning adapter, or S3 completion processor. A naive presigned URL would leave several release-blocking gaps: caller-selected keys, cross-project reads, concurrent quota overrun, completed metadata for unused URLs, overwrite/reuse of one URL, duplicate usage from repeated notifications, and partial finalization when one of the file and usage writes fails.

## Solution Statement

Add a bounded `file-management` module and a separate File DynamoDB table. `POST /v1/files/uploads` authenticates through the RUS-03 `deriveAuthorization` seam, takes only display metadata/visibility/declared size, generates all identifiers and the object key server-side, and atomically creates a pending file plus a project quota reservation. It returns a complete presigned `PUT` URL and the exact signed request headers, without returning the bucket, object key, internal project ID, or AWS details.

Use a private, per-stage S3 bucket with explicit Block Public Access, disabled CORS for the server-side MVP, HTTPS-only access, and production retention. Sign the exact key, content type, content length, and `If-None-Match: *` so a successful authorization cannot select a different key or overwrite an existing object. Treat the declared size as an authorization bound, then verify actual `HeadObject` evidence before readiness.

An at-least-once S3 `ObjectCreated:Put` processor claims stable completion evidence on the pending record, records one `s3-upload-requests` event and opens one storage checkpoint through the existing RUS-04 service, then atomically transitions the file to `ready` and moves reserved bytes to retained bytes. Duplicate or resumed processing reuses the claimed evidence and the idempotent RUS-04 source identity. A periodic reconciler handles missed notifications and releases reservations for genuinely unused uploads after a bounded grace period. Mismatched objects enter a durable failed/cleanup path and are deleted only from their exact server-generated key before quota is released.

Project-scoped `GET /v1/files` and `GET /v1/files/{fileId}` query only the partition derived from `TrustedProjectContext`; wrong-project and unknown IDs return the same safe `404`.

## Out of Scope / Non-Goals

- Not included: private downloads, presigned `GET`, stable public redirect routes, public URL delivery, range testing, or download request/byte metering (RUS-06 and RUS-08).
- Not included: trash, restore, purge, force delete, or closing storage checkpoints (RUS-07). A future trash state continues to count against the quota until physical removal.
- Not included: dashboard file views or integration instructions (RUS-09).
- Not included: the 60-request-per-project-per-minute limiter, project-wide suspension changes, production alarms, DLQs/backlog metrics, or the full IAM/observability release gate (RUS-10). RUS-05 must still use least-privilege route/worker policies, safe errors, and redaction.
- Not included: multipart upload, files over the MVP limit, caller-selected object keys, folders, rename, mutable visibility, arbitrary metadata, file versions, transforms, or browser/mobile delegated authorization.
- Not included: browser CORS for the file bucket. Project keys are server-side secrets, so the MVP upload client is a server process or `curl`.
- Not included: a dedicated SDK, custom domain, CloudFront file delivery, Transfer Acceleration, or a public bucket/prefix.
- Not changing: pricing configuration, cost calculation, RUS-04 ledger semantics, Cognito control routes, owner project APIs, or the shared REST envelope.
- Not authorized by this plan: deployment, AWS mutation, live credentials, disposable user/file creation, GitHub issue/wiki updates, or changes to `dev-rus02`.

## Feature Metadata

**Feature Type**: New Capability

**Estimated Complexity**: High

**Primary Systems Affected**: shared contracts, project-authentication context, File Management backend module, DynamoDB, S3, asynchronous workers, SST composition, usage/pricing runtime integration, API Gateway routes, integration tests

**Dependencies**: RUS-03 and RUS-04 implementations; `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` pinned to the repository's AWS SDK v3 version; existing Zod, Powertools, SST, Vitest, TypeScript

**Estimated Change Size**: approximately 1,400-2,100 lines including tests; the upper bound reflects quota/failure reconciliation needed for correctness

## Related Work

**Implements**: [GitHub issue #5 — RUS-05](https://github.com/noamtz/utility-services/issues/5)  ·  **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic)  ·  **Architecture**: [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture)  ·  **Breakdown**: [MVP Ticket Breakdown](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown)

**Back-references**:

- `.agents/plans/rus-01-deployable-application-foundation.md` - Establishes SST stages, Node.js 24, the API/static-site composition, retention policy, and wrapper-only infrastructure workflow.
- `.agents/plans/rus-02-invite-only-owner-project-control.md` - Establishes public/internal project identities and trusted File Management lifetime settings in the control table.
- `.agents/plans/rus-03-project-credential-lifecycle-authentication.md` - Establishes the bearer parser, constant-behavior verification, `deriveAuthorization`, and minimal trusted project context that this ticket extends with verified File Management configuration.
- `.agents/plans/rus-04-versioned-pricing-usage-ledger.md` - Establishes `recordUsage` and storage checkpoint APIs. It explicitly assigns upload-request recording and storage opening to RUS-05.

**Forward-references**:

- RUS-06 consumes the file/public identity and ready-state lookup contract for private downloads and stable public URLs.
- RUS-07 adds `trashed`/purged states, the purge-time lifecycle index entries, quota release after physical deletion, and `closeStorage`.
- RUS-08 adds download/CloudTrail metering without changing the upload completion source contract.
- RUS-09 exposes files and copyable `curl` instructions in the dashboard.
- RUS-10 wraps transfer authorization with rate limiting and adds production operational controls.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` (lines 1-126) - Canonical repository boundaries, AWS continuity, private-bucket/direct-transfer invariants, file/usage rules, release blockers, validation, and deployment prohibitions.
- `package.json` (lines 10-50) - Node/npm versions, full quality gates, SST wrapper commands, and pinned workspace toolchain.
- `packages/backend/package.json` (lines 6-15) - Existing pinned AWS SDK dependencies; add S3 packages at the same exact SDK version.
- `sst.config.ts` (lines 20-47) - Root resource composition and non-sensitive outputs to extend.
- `infra/config/app.ts` (lines 22-37) - Production `retain`/`protect` policy inherited by the table and bucket.
- `infra/api.ts` (lines 14-66) - Current health/control route registration, linking, per-route permissions, runtime, and tracing pattern.
- `infra/config/control.ts` (lines 22-31, 33-76, 95-97) - Dynamo policy, route descriptor, least-privilege action list, and production deletion-protection patterns.
- `infra/control.ts` (lines 12-45) - Resource factory pattern for linked Dynamo tables.
- `infra/config/usage-pricing.ts` (lines 9-19, 139-141) - Independent bounded-context table policy and production deletion protection.
- `infra/usage-pricing.ts` (lines 20-41) - Usage table resource factory and retained deployment-managed seed pattern.
- `infra/dynamo-link.ts` (lines 1-16) - Query-only Dynamo link baseline; file functions need explicit additional actions.
- `infra/composition.test.ts` (lines 24-60) - Composition assertions and no-wildcard IAM policy convention.
- `infra/usage-pricing.test.ts` (lines 16-88) - SST resource factory test pattern with stubbed globals.
- `infra/sst-globals.d.ts` (lines 64-191) - Hand-maintained SST/Pulumi test-time types that must be extended for Bucket, notifications, and Cron only as needed.
- `packages/contracts/src/http/envelope.ts` (lines 3-43) - Required success/error envelope schemas.
- `packages/contracts/src/projects/contract.ts` (lines 5-28) - File utility literal and validated upload/download lifetime defaults/bounds.
- `packages/contracts/src/auth/project-context.ts` (lines 6-14) - Current minimal trusted context. Extend only with verified public project identity and File Management settings; never with owner or secret material.
- `packages/contracts/src/index.ts` (lines 1-96) - Barrel export organization for the new file contracts.
- `packages/backend/src/core/http/handler.ts` (lines 18-56, 95-151, 181-264) - Validated request sections, authorization seam, safe `HttpError` mapping, response validation, request IDs, and sanitized failures.
- `packages/backend/src/core/observability/redact.ts` (lines 6-45, 53-90) - Existing secret and presigned-URL redaction. Extend tests if the new DTO uses a URL field name not already covered.
- `packages/backend/src/core/observability/powertools.ts` (lines 17-32) - Production safe logger adapter.
- `packages/backend/src/modules/project-authentication/authorization.ts` (lines 4-12) - Exact middleware adapter every file REST handler must use.
- `packages/backend/src/modules/project-authentication/service.ts` (lines 21-36, 40-94) - Credential verification and trusted-context construction. Its verification snapshot already checks project/utility state.
- `packages/backend/src/modules/identity-control/credentials/repository.ts` (lines 48-81, 173-205) - Credential repository interface and transactional verification snapshot needed by the new project-authentication runtime.
- `packages/backend/src/modules/identity-control/projects/model.ts` (lines 17-28, 47-58, 106-143) - Verified internal/public project identity and stored File Management URL settings.
- `packages/backend/src/modules/identity-control/projects/runtime.ts` (lines 1-25) and `credentials/runtime.ts` (lines 1-27) - Process-level `Resource`/DocumentClient/repository/service composition pattern.
- `packages/backend/src/modules/identity-control/projects/model.ts` (lines 64-85) - Canonical key constructors and fail-closed persisted-record validation pattern.
- `packages/backend/src/modules/identity-control/projects/repository.ts` (lines 31-83, 85-198) - Typed repository, scoped query, pagination, and corrupt/cross-scope rejection pattern.
- `packages/backend/src/modules/identity-control/projects/service.ts` (lines 18-62, 79-133) - ID/clock injection, public DTO mapping, safe `404`, and project-scoped cursor pattern.
- `packages/backend/src/modules/identity-control/projects/handlers.ts` (lines 13-38) - Small handler-factory pattern to mirror with project authorization instead of owner authorization.
- `packages/backend/src/modules/usage-pricing/service.ts` (lines 66-82, 114-127, 205-314, 316-374, 519-537) - `recordUsage`, `openStorage`, idempotency/conflict behavior, and returned service surface.
- `packages/backend/src/modules/usage-pricing/model.ts` (lines 207-260) - Stable source digest/fingerprint rules; retry inputs must remain byte-for-byte semantically stable.
- `packages/backend/src/modules/usage-pricing/repository.ts` (lines 48-85, 118-120, 207 onward) - Repository interface, bigint-preserving DocumentClient options, and Dynamo adapter to compose in the worker runtime.
- `packages/backend/src/modules/usage-pricing/storage.ts` (lines 29-75) - Existing byte-time interval splitting; File Management opens but does not duplicate or close this logic.
- `packages/backend/src/modules/usage-pricing/service.test.ts` (lines 240 onward, 323 onward) - Duplicate/conflicting sources and storage checkpoint idempotency tests to mirror.
- `packages/backend/src/modules/project-authentication/authorization.test.ts` (lines 34-83) - Proof that bearer auth runs before the handler and all failures use one safe response.
- `packages/backend/src/core/http/handler.test.ts` (lines 31-217) - Boundary validation, request ID, log, and internal-error fixtures.
- `tests/integration/project-credential-authentication.test.ts` (lines 320-479) - Assembled project context, cross-project, inactive-key, and secret-exclusion evidence.
- `tests/integration/usage-pricing-ledger.test.ts` (lines 203-314) - Assembled project-isolated usage/storage behavior and no-leak public evidence.
- `vitest.config.ts` (lines 4-50) - Node/dashboard test projects and 80% statements/branches/functions/lines coverage thresholds.

### Existing Files to Update

- `package-lock.json` - Lock the two S3 AWS SDK packages through npm, never by hand.
- `packages/backend/package.json` - Add exact-version S3 client and presigner dependencies.
- `packages/contracts/src/auth/project-context.ts` and `.test.ts` - Add verified `publicProjectId` and `fileManagement` settings to the internal context.
- `packages/contracts/src/index.ts` - Export File Management schemas/types.
- `packages/backend/src/modules/project-authentication/service.ts` and `.test.ts` - Populate and verify the richer trusted context from the already-loaded project/utility snapshot.
- `packages/backend/src/core/observability/redact.test.ts` - Lock out full upload URLs/query strings from log evidence.
- `infra/api.ts` - Register project-authenticated utility routes separately from Cognito control routes.
- `infra/composition.test.ts` - Assert route/resource isolation, private bucket policy, event-only transfer, and no wildcard actions.
- `infra/sst-globals.d.ts` - Add the smallest types needed for new SST constructs.
- `sst.config.ts` - Compose/return the File resources without publishing the bucket or object implementation.
- `AGENTS.md` - After implementation and validation, update the repository-map sentence to state that the upload/list/metadata slice is implemented while RUS-06+ remain pending. Do not copy wiki content locally.

### New Files to Create

- `packages/contracts/src/files/contract.ts` - Strict public upload/list/inspect schemas and constants.
- `packages/contracts/src/files/contract.test.ts` - Boundary, strictness, state-shape, and internal-field exclusion tests.
- `packages/backend/src/modules/project-authentication/runtime.ts` - Reusable process-level verifier composition for the first real utility routes.
- `packages/backend/src/modules/usage-pricing/runtime.ts` - Reusable process-level RUS-04 service composition for asynchronous consumers.
- `packages/backend/src/modules/file-management/ids.ts` - Cryptographically generated file/public IDs and collision-safe injection seam.
- `packages/backend/src/modules/file-management/cursor.ts` - Opaque project-scoped list cursor codec.
- `packages/backend/src/modules/file-management/model.ts` - Strict persisted file/quota schemas, key/index constructors, state invariants, and parsers.
- `packages/backend/src/modules/file-management/repository.ts` - Project-scoped queries, atomic pending/quota reservation, completion evidence, terminal transitions, and due-pending access.
- `packages/backend/src/modules/file-management/presigning.ts` - Narrow S3 presigned `PUT` adapter.
- `packages/backend/src/modules/file-management/object-store.ts` - Narrow `HeadObject` and exact-key invalid-upload cleanup adapter; never reads bytes.
- `packages/backend/src/modules/file-management/service.ts` - Upload authorization, list, inspect, validation, DTO mapping, quota/collision retry, and safe errors.
- `packages/backend/src/modules/file-management/completion.ts` - S3 event parsing, completion/reconciliation saga, usage calls, retry/conflict handling, and failure cleanup.
- `packages/backend/src/modules/file-management/handlers.ts` - Three REST handler factories.
- `packages/backend/src/modules/file-management/runtime.ts` - API and worker dependency composition using linked resources.
- Colocated `*.test.ts` files for every module above.
- `packages/backend/src/functions/files/authorize-upload.ts` - Thin REST entrypoint.
- `packages/backend/src/functions/files/list-files.ts` - Thin REST entrypoint.
- `packages/backend/src/functions/files/inspect-file.ts` - Thin REST entrypoint.
- `packages/backend/src/functions/files/process-upload-completion.ts` - Thin S3 notification entrypoint.
- `packages/backend/src/functions/files/reconcile-pending-uploads.ts` - Thin scheduled expiry/missed-event reconciler.
- `infra/config/file-management.ts` and `.test.ts` - Resource names, routes, indexes, byte/grace constants, retention/private-bucket/IAM policies.
- `infra/file-management.ts` and `.test.ts` - File table, bucket, notification subscriber, scheduled reconciler, links, and permissions.
- `infra/bucket-link.ts` and `.test.ts` - Resource-name-only bucket link with no implicit `s3:*`; functions receive explicit actions.
- `tests/integration/direct-upload-file-lifecycle.test.ts` - Assembled cross-project, quota, finalization, duplicate, mismatch, expiry, and no-byte-proxy evidence.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html#using-presigned-url)
  - Specific sections: expiration, bearer-token behavior, repeated use, checksum/header behavior.
  - Why: a URL remains usable until expiry and a normal PUT to an existing key replaces it; the implementation must sign constraints and prevent overwrite.
- [AWS SDK v3 S3 request presigner](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/)
  - Specific API: `getSignedUrl`, `signableHeaders`, and `unhoistableHeaders`.
  - Why: `Content-Type`, `Content-Length`, and `If-None-Match` must be signed/returned consistently rather than assumed.
- [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
  - Specific section: `If-None-Match` with `PutObject`.
  - Why: prevents a reusable presigned URL from overwriting the first successful upload at the same key.
- [PutObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
  - Specific fields: `Content-Length`, `Content-Type`, `If-None-Match`, error behavior.
  - Why: defines the exact request the presigner authorizes.
- [HeadObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
  - Specific response metadata and permission/error notes.
  - Why: verifies actual bytes without routing the body through Lambda; `HeadObject` requires `s3:GetObject` and generic 4xx responses must be handled safely.
- [S3 event notification ordering and duplicates](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html#event-ordering-and-duplicate-events)
  - Specific section: at-least-once, duplicate, and non-ordered delivery.
  - Why: file state, not one invocation/event ID, is the durable idempotency anchor.
- [S3 event message structure](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html)
  - Specific fields: event version/name/time, bucket, URL-encoded key, size/eTag, sequencer.
  - Why: parse only trusted fields and validate the exact server-generated key grammar.
- [DynamoDB condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
  - Specific section: `attribute_not_exists`, numeric comparisons, and conditional failure.
  - Why: protects identity collision, state transition, and quota bounds.
- [DynamoDB TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)
  - Specific sections: all-or-nothing semantics, cancellation reasons, and ten-minute client request token window.
  - Why: pending metadata and quota counters must change atomically; the token is retry help, not durable asynchronous deduplication.
- [SST Bucket](https://sst.dev/docs/component/aws/bucket/)
  - Specific sections: private default, `cors`, `transform.publicAccessBlock`, notifications, and linking.
  - Why: explicitly disable permissive default CORS, assert all four Block Public Access switches, and attach only `ObjectCreated:Put`.
- [SST Dynamo](https://sst.dev/docs/component/aws/dynamo/)
  - Specific sections: fields/indexes, TTL, deletion protection, and linking.
  - Why: the file table needs immutable key/index definitions and production deletion protection.
- [SST Cron](https://sst.dev/docs/component/aws/cron/)
  - Specific sections: schedule and task function.
  - Why: reconciles missed completion events and releases expired pending reservations without making reads mutate state.
- [SST app removal policy](https://sst.dev/docs/reference/config/#removal)
  - Specific section: `retain` versus `remove`.
  - Why: production bucket/table data must survive stack removal.

### Patterns to Follow

**Naming Conventions**

- Public schemas/types use PascalCase and `Schema` suffix; values/constants use uppercase snake case (`packages/contracts/src/projects/contract.ts:5-28`).
- Domain factories use `createXService`, `createDynamoXRepository`, and `createXHandler`; Lambda files only re-export a composed handler.
- Persisted keys are produced by named constructors and revalidated by parsers. Never concatenate unvalidated request values inside repository commands.
- Use public IDs such as `fil_<22 base64url>` and `pfil_<22 base64url>`; use the existing UUID internal project identity unchanged. Exact prefixes must be locked in contract and ID tests.

**Public Contract Pattern**

```ts
const CreateUploadRequestSchema = z
  .object({
    name: FileNameSchema,
    mediaType: FileMediaTypeSchema,
    sizeBytes: FileSizeBytesSchema,
    visibility: FileVisibilitySchema,
  })
  .strict();

const UploadAuthorizationSchema = z
  .object({
    file: FileSchema,
    upload: z
      .object({
        method: z.literal("PUT"),
        url: z.url().startsWith("https://"),
        expiresAt: TimestampSchema,
        requiredHeaders: z
          .object({
            "content-type": FileMediaTypeSchema,
            "content-length": z.string().regex(/^\d+$/u),
            "if-none-match": z.literal("*"),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
```

Return `upload.url` only from the authorization response. List/inspect responses contain file metadata, never a reusable/stored transfer URL, bucket, key, ARN, internal project ID, or usage source ID.

**Authorization Pattern**

```ts
createHttpHandler({
  schemas: { body: CreateUploadRequestSchema, response: UploadAuthorizationSchema },
  deriveAuthorization: createProjectAuthorization(projectAuthenticationService),
  callback: ({ authorization, body }) => fileService.authorizeUpload(authorization, body),
  logger,
});
```

`TrustedProjectContext` is the only project input. Extend it with values already validated in the credential verification snapshot:

```ts
{
  internalProjectId,
  publicProjectId,
  keyId,
  enabledUtilities: ["file-management"],
  fileManagement: {
    uploadUrlLifetimeMinutes,
    downloadUrlLifetimeMinutes,
  },
}
```

Do not accept `projectId`, `publicProjectId`, object key, bucket, lifetime, or storage prefix in the upload body or headers.

**File/Quota Data Pattern**

- Primary file lookup/list partition: `pk = PROJECT#<internalProjectId>`, `sk = FILE#<fileId>`.
- Quota counter in the same partition: `pk = PROJECT#<internalProjectId>`, `sk = QUOTA`.
- Internal object key: `projects/<internalProjectId>/files/<fileId>`.
- Sparse public lookup index for RUS-06: `gsi1pk = PUBLIC_PROJECT#<publicProjectId>`, `gsi1sk = PUBLIC_FILE#<publicFileId>` only when visibility is `public`.
- Sparse lifecycle index: `gsi2pk = UPLOAD#PENDING`, `gsi2sk = <failureEligibleAt>#<internalProjectId>#<fileId>` while pending. RUS-07 may reuse the same index attributes with a separate `TRASH#PENDING_PURGE` partition value.
- Quota fields are Dynamo-safe integers: `reservedBytes`, `retainedBytes`, and `accountedBytes = reservedBytes + retainedBytes`. Authorization atomically adds the declared size to `reservedBytes`/`accountedBytes` only when `accountedBytes <= limit - size`; ready moves bytes from reserved to retained without changing accounted; failed cleanup subtracts reserved/accounted exactly once.
- Use binary bounds aligned with the existing usage byte unit: `MAX_FILE_SIZE_BYTES = 100n * 2n ** 20n` and `MAX_RETAINED_STORAGE_BYTES = 5n * 2n ** 30n`. REST `sizeBytes` stays a safe integer number; convert to bigint immediately inside the domain/repository.

**State and Completion Pattern**

```text
authorize
  -> transaction: create pending file + reserve quota
  -> presign exact PUT
  -> return opaque URL + signed headers

S3 ObjectCreated:Put OR scheduled reconciliation
  -> validate bucket/key/file state
  -> HeadObject (metadata only)
  -> conditionally claim stable completion evidence on pending record
  -> recordUsage(sourceKind="file-upload", sourceId=fileId, metric="s3-upload-requests")
  -> openStorage(storageSubjectId=fileId, verified bytes, claimed completion time)
  -> transaction: pending -> ready; reserved -> retained

expiry/mismatch
  -> persist failed/cleanup evidence without releasing accounted bytes
  -> delete only the exact server-owned invalid object when one exists
  -> transaction: pending -> failed; release reserved/accounted bytes
```

- Keep public status values `pending | ready | failed`. Internal completion/failure evidence fields make multi-step retries resumable without exposing a new public status.
- Claim one canonical completion time before calling RUS-04. The notification path uses the first valid S3 `eventTime`; reconciliation uses `HeadObject.LastModified`. Every retry and later duplicate reuses the stored value so the immutable price version/source fingerprint cannot drift.
- Use `sourceKind = "file-upload"`, `sourceId = fileId`, `quantityAtoms = 1n`, and the claimed completion time for `recordUsage`; use the same file ID, verified size, and time for `openStorage`.
- Do not mark `ready` until both RUS-04 calls have succeeded or returned their idempotent duplicate result. If final metadata commit fails, throw so the event retries.
- A duplicate event for a ready file is a no-op after verifying the stored identity. A conflicting event/evidence is failed/quarantined, never charged twice.
- A 404 from `HeadObject` during notification handling is retryable; the scheduled reconciler decides expiry after the grace period.
- Set `failureEligibleAt = uploadExpiresAt + 60 minutes` and run reconciliation every five minutes. This non-public grace is deliberately bounded and testable. If an object exists, reconcile it through the same completion saga; otherwise fail/release. A later object for an already-failed authorization is an invalid orphan and may be deleted only after exact key/file-state verification.

**Repository/Error Pattern**

- Repository returns typed internal records and throws domain conflicts for collision, quota, state, corrupt records, and conditional races. Services retry only named transient/conflict classes with a low bounded attempt count.
- `413 FILE_TOO_LARGE` for the per-file limit, `409 STORAGE_QUOTA_EXCEEDED` for the retained/reserved quota, `404 FILE_NOT_FOUND` for both missing and wrong-project IDs, and the shared `400 VALIDATION_ERROR` for malformed names/media types/sizes.
- Do not reveal current quota counters, another project's existence, S3 status codes, bucket/key, condition expressions, transaction cancellation reasons, stack traces, or AWS request IDs in public errors.

**Logging Pattern**

- Keep request logs to request ID/method/path/status. Completion logs may use request/event correlation, status transition, and hashed/opaque file ID, but not bucket/key, full event, URL, Authorization, metadata headers, or AWS response objects.
- Pass any structured diagnostic object through `redactSensitiveValues`; test `upload.url` and query stripping explicitly.

**Anti-Patterns to Avoid**

- No API Gateway native API key, caller project header, caller object key, global file lookup, table scan, or file-ID-only authorization.
- No Lambda/API Gateway file body, base64 upload body, or `GetObject` body read in the completion worker.
- No bucket `access: "public"`, wildcard CORS, CloudFront origin for file bytes, or implicit bucket link granting `s3:*`.
- No readiness on presign issuance, API success, notification fields alone, or declared size alone.
- No cost arithmetic in File Management and no direct writes into usage records outside the RUS-04 service.
- No event-ID-only dedupe and no assumption that S3 notifications are ordered or unique.
- No release of quota before an invalid physical object has been removed or confirmed absent.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts and Trusted Context

Define the exact public file API and minimally enrich the internal authenticated context with verified project/public identity and File Management settings already loaded during RUS-03 verification.

**Tasks:**

- Pin S3 AWS SDK dependencies.
- Define IDs, status/visibility, filename/media type/size, upload/list/inspect schemas, safe errors, and pagination limits.
- Extend `TrustedProjectContext` and project-authentication tests without exposing owner or credential material.

### Phase 2: Infrastructure and Persistence Foundation

**Depends on:** Phase 1 for shared constants and route/resource names.

Create the File table/bucket, sparse public/lifecycle indexes, explicit private/retention policy, narrow linking, S3 completion subscription, and scheduled reconciliation. Implement validated file/quota records and atomic repository operations before business orchestration.

**Tasks:**

- Create and test file resource policy/configuration.
- Add the private bucket and File Dynamo table.
- Implement keys, IDs, cursors, persisted schemas, quota transactions, state/evidence operations, and due-pending queries.

### Phase 3: Upload Authorization and Read APIs

**Depends on:** Phase 2 for the repository and linked resources.

Compose the existing project-authentication service, implement the constrained presigner and File service, expose project-authenticated upload/list/inspect routes, and prove that only control JSON crosses API Gateway.

**Tasks:**

- Add shared authentication runtime composition.
- Add S3 presigning adapter with exact signed headers.
- Implement upload authorization, collision/quota retry, public DTO mapping, list cursor, and metadata lookup.
- Register three utility routes with per-action IAM.

### Phase 4: Completion, Usage, and Expiry Reconciliation

**Depends on:** Phase 3 for pending files and the object/key contract.

Implement the resumable completion saga and the scheduled missing-event/expiry path. Compose RUS-04 at runtime rather than importing its persistence/pricing details into File Management.

**Tasks:**

- Add usage runtime composition and object metadata adapter.
- Parse/validate S3 events, claim stable completion evidence, record upload usage, open storage, and finalize exactly once.
- Handle duplicates, conflicts, mismatches, invalid-object cleanup, missed events, and unused expiry without premature quota release.

### Phase 5: Boundary Validation and Repository Truthfulness

**Depends on:** all prior phases.

Add assembled integration/security tests, verify coverage and infrastructure synthesis locally, and update only the repository-map implementation status. A live diff or deploy remains separately authorized.

**Tasks:**

- Prove cross-project denial, no caller key control, direct-byte bypass, quota races, duplicate/out-of-order events, mismatch/expiry cleanup, and usage idempotency.
- Run local full validation and the Codex-layer validator only if `AGENTS.md` changes.
- Run an AWS-backed `infra:diff`/disposable transfer smoke test only after explicit owner authorization and exact AWS identity preflight.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. UPDATE `packages/backend/package.json` and `package-lock.json`

- **IMPLEMENT**: install `@aws-sdk/client-s3@3.1116.0` and `@aws-sdk/s3-request-presigner@3.1116.0` in `@utility-services/backend` with exact versions; use npm so the lockfile is generated.
- **PATTERN**: `packages/backend/package.json:6-14` pins Dynamo SDK packages to `3.1116.0`.
- **GOTCHA**: do not upgrade unrelated SDK, SST, TypeScript, or lockfile packages. Recheck the installed `PutObjectCommandInput` and presigner header options before relying on `IfNoneMatch`/signed headers.
- **VALIDATE**: `npm ls @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/client-dynamodb`
- **SATISFIES**: AC2, AC4.

### 2. CREATE `packages/contracts/src/files/contract.ts` and tests; UPDATE the contract barrel/context

- **IMPLEMENT**: strict schemas/types for `fil_`/`pfil_` IDs, `private | public`, `pending | ready | failed`, display name, media type, size, path/query/cursor, public file DTO, upload authorization request/response, list payload, and inspect payload. Use 20 default/50 maximum list limits and the explicit binary 100 MiB cap.
- **IMPLEMENT**: response `upload` contains only method, full HTTPS URL, expiry, and required signed headers; file DTO never contains AWS/internal values.
- **IMPLEMENT**: extend `TrustedProjectContextSchema` with verified `publicProjectId` and `fileManagement` settings, then update project-authentication service construction and all fixtures/tests.
- **PATTERN**: `packages/contracts/src/projects/contract.ts:1-90`; `packages/contracts/src/index.ts:16-96`; `packages/backend/src/modules/project-authentication/service.ts:64-94`.
- **GOTCHA**: this is an internal context expansion, not a new caller input. Values must come from the transactional verification snapshot, not headers/body. Do not add owner ID, project name, public object URL, secret/hash, bucket, key, or arbitrary settings.
- **VALIDATE**: `npm test -- --project node packages/contracts/src/files/contract.test.ts packages/contracts/src/auth/project-context.test.ts packages/backend/src/modules/project-authentication/service.test.ts packages/backend/src/modules/project-authentication/authorization.test.ts`
- **SATISFIES**: AC2, AC3, AC4, AC7.

### 3. CREATE `infra/config/file-management.ts`, `infra/bucket-link.ts`, and tests

- **IMPLEMENT**: centralize component/index/route names, `MAX_FILE_SIZE_BYTES`, `MAX_RETAINED_STORAGE_BYTES`, URL-completion grace, reconciliation schedule, table fields/indexes, production deletion-protection helper, bucket private/CORS/Block Public Access policy, route-specific Dynamo/S3 action lists, and worker action lists.
- **IMPLEMENT**: configure a Bucket link wrapper that exports only `{ name }` and no implicit S3 actions; every function receives explicit object/table permissions.
- **PATTERN**: `infra/config/control.ts:22-31,33-76,95-97`; `infra/config/usage-pricing.ts:9-19,139-141`; `infra/dynamo-link.ts:1-16`.
- **GOTCHA**: do not put the bucket name in public output or API responses. Do not use wildcard actions or `s3:*`. Do not add CORS for browsers.
- **VALIDATE**: `npm test -- --project node infra/config/file-management.test.ts infra/bucket-link.test.ts`
- **SATISFIES**: AC1, AC3, AC4, AC8.

### 4. CREATE `infra/file-management.ts` and tests; UPDATE SST composition/types

- **IMPLEMENT**: create one on-demand File Dynamo table with primary/public/lifecycle indexes and production deletion protection; create one stage bucket with `cors:false`, all four public-access-block flags true, HTTPS-only behavior, and production `forceDestroy:false`/inherited retain protection.
- **IMPLEMENT**: attach only `s3:ObjectCreated:Put` with `projects/` prefix to the completion worker. Add a five-minute `sst.aws.Cron` for reconciliation. Link only required resource names and grant explicit `s3:PutObject`, `s3:GetObject` (HEAD), `s3:DeleteObject` (invalid exact-key cleanup), and Dynamo actions to the functions that need each one.
- **IMPLEMENT**: update `sst.config.ts` to create usage resources before file resources, pass control/usage/file resources into API composition, and return only `fileTableName` as a non-secret operational output. Extend `infra/sst-globals.d.ts` minimally and update composition tests.
- **PATTERN**: `infra/control.ts:12-45`; `infra/usage-pricing.ts:20-41`; `infra/usage-pricing.test.ts:16-88`; `sst.config.ts:20-47`.
- **GOTCHA**: `sst.aws.Bucket` default linking can grant broad S3 access; the explicit link wrapper must override it. Production retention depends on both root `removal/protect` and resource behavior. Notification delivery is at-least-once; infra must not imply exactly-once.
- **VALIDATE**: `npm test -- --project node infra/file-management.test.ts infra/composition.test.ts && npm run typecheck`
- **SATISFIES**: AC1, AC4, AC6, AC8.

### 5. CREATE File Management IDs, cursor, persisted model, repository, and tests

- **IMPLEMENT**: generate high-entropy server-owned file/public IDs; define project/file/quota/public/lifecycle keys; parse every persisted item with cross-field/key/state invariants; encode opaque cursors without trusting embedded project scope.
- **IMPLEMENT**: repository operations for project-scoped get/list, atomic pending create plus quota reserve, completion-evidence claim/read, ready transition plus reserved-to-retained movement, failure-evidence claim, cleanup-complete failure plus quota release, and lifecycle-index query of due pending uploads.
- **IMPLEMENT**: initialize/mutate Dynamo integers safely; preserve `accountedBytes = reservedBytes + retainedBytes`; use conditions on current status, IDs, sizes, revisions/evidence, and quota bound. Parse cancellation reasons into specific collision/quota/state conflicts.
- **PATTERN**: `identity-control/projects/model.ts:64-85`; `projects/repository.ts:31-83,85-198`; `usage-pricing/repository.ts:87-118,207 onward`.
- **GOTCHA**: no table scans, global file lookup, or event-provided partition. List/inspect always use `PROJECT#trustedInternalProjectId`. A failed object retains accounted bytes until exact cleanup succeeds/absence is proven. Dynamo `ClientRequestToken` is only a short retry aid.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/file-management/ids.test.ts packages/backend/src/modules/file-management/cursor.test.ts packages/backend/src/modules/file-management/model.test.ts packages/backend/src/modules/file-management/repository.test.ts`
- **SATISFIES**: AC2, AC3, AC5, AC6, AC7, AC8.

### 6. CREATE shared project-authentication/usage runtime factories and tests

- **IMPLEMENT**: move first-consumer runtime composition into `project-authentication/runtime.ts` and `usage-pricing/runtime.ts`: validate linked table names, use the existing bigint-preserving DocumentClient options, construct existing repositories/services once per process, and export factories suitable for API/worker composition.
- **PATTERN**: `identity-control/credentials/runtime.ts:1-27`; `usage-pricing/repository.ts:118-120`; `usage-pricing/service.ts:114-127`.
- **GOTCHA**: do not duplicate authentication or pricing logic inside File Management. Do not create a usage HTTP endpoint. The API routes need ControlTable get/transact-get; the worker needs UsagePricing query/get/put/update/transact actions beyond the query-only link baseline.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/project-authentication packages/backend/src/modules/usage-pricing && npm run typecheck`
- **SATISFIES**: AC2, AC6, AC7.

### 7. CREATE `presigning.ts`, `object-store.ts`, and tests

- **IMPLEMENT**: narrow injected adapters around `S3Client`, `PutObjectCommand`, `HeadObjectCommand`, `DeleteObjectCommand`, and `getSignedUrl`. Presign exact bucket/key/content type/content length/`IfNoneMatch:"*"`; explicitly sign those headers and return the same normalized required-header map.
- **IMPLEMENT**: `HeadObject` returns only normalized length/type/eTag/last-modified evidence. Delete accepts only a previously validated exact server-owned key and is idempotent for absence.
- **PATTERN**: dependency-injected adapters/repositories in existing modules; official SDK links above.
- **GOTCHA**: never log the command input, URL, bucket, key, or response object. `HeadObject` is authorized with `s3:GetObject` and must never issue `GetObject`. If installed SDK behavior cannot make the required headers signature-bound, stop and raise the architecture risk; do not silently weaken the contract or switch to presigned POST.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/file-management/presigning.test.ts packages/backend/src/modules/file-management/object-store.test.ts`
- **SATISFIES**: AC3, AC4, AC5, AC8.

### 8. CREATE File service, handlers, API runtime/entrypoints, and route integration

- **IMPLEMENT**: authorize upload from `TrustedProjectContext` plus validated body; generate IDs/key; compute expiry from verified project settings; atomically reserve; presign; retry ID collisions/conditional races within a strict bound; map internal file to safe response.
- **IMPLEMENT**: list/inspect only within trusted project partition, use opaque cursor pagination, and map unknown/wrong-project to the identical `FILE_NOT_FOUND` envelope.
- **IMPLEMENT**: add three small handler factories and one-line entrypoints. Register `POST /v1/files/uploads`, `GET /v1/files`, and `GET /v1/files/{fileId}` as utility routes without Cognito JWT auth; application middleware verifies the bearer.
- **PATTERN**: `projects/service.ts:18-133`; `projects/handlers.ts:13-38`; `project-authentication/authorization.ts:4-12`; `infra/api.ts:20-66`.
- **GOTCHA**: derive authorization before request business logic; never use a request project header/path. `POST` returns `201`; GETs return `200`. No route accepts or returns bytes/key/bucket. Do not expose a public download URL in RUS-05.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/file-management/service.test.ts packages/backend/src/modules/file-management/handlers.test.ts packages/backend/src/modules/file-management/runtime.test.ts && npm run typecheck`
- **SATISFIES**: AC2, AC3, AC4, AC5, AC7, AC8.

### 9. CREATE the completion saga, S3 worker entrypoint, and tests

- **IMPLEMENT**: strictly parse S3 records, accept only the configured bucket, `ObjectCreated:Put`, and exact `projects/<uuid>/files/<fil_id>` key; load the project-scoped pending record and HEAD the object.
- **IMPLEMENT**: compare actual length/content type and event/head identity against pending intent; claim canonical completion time/evidence; call `recordUsage` and `openStorage` with stable file-based inputs; transition to ready and move reserved to retained only after both calls succeed.
- **IMPLEMENT**: make ready duplicates no-op, replay partially completed work, reject conflicting/out-of-order evidence, and throw retryable failures. Persist failure evidence and safely clean exact invalid objects before releasing quota.
- **PATTERN**: `usage-pricing/service.ts:205-314`; source fingerprint `usage-pricing/model.ts:207-260`; S3 event official docs.
- **GOTCHA**: do not use the raw event key as authorization, trust notification size without HEAD, choose a new occurrence time on retry, mark ready before usage/storage succeeds, or swallow a usage failure. Unknown/malformed events need safe structured rejection/quarantine evidence, not charging.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/file-management/completion.test.ts packages/backend/src/modules/usage-pricing/service.test.ts`
- **SATISFIES**: AC5, AC6, AC8.

### 10. CREATE the scheduled pending-upload reconciler and tests

- **IMPLEMENT**: query due pending records from the lifecycle GSI in bounded pages. For each, HEAD the exact key: existing matching objects enter the same completion saga using persisted/LastModified evidence; absence after the 60-minute grace becomes failed and releases reservation; mismatches use the durable cleanup path.
- **IMPLEMENT**: a later completion event for a terminal failed record never revives it or records usage; it may remove only the exact invalid orphan after verifying record/key identity.
- **PATTERN**: same completion service and repository; do not fork state logic into the Lambda entrypoint.
- **GOTCHA**: Dynamo TTL is not a quota-release mechanism and GET/list routes must not mutate lifecycle state. Bound batch/page concurrency so one run cannot exhaust Lambda time or S3/Dynamo capacity; leave backlog alarms to RUS-10.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/file-management/completion.test.ts infra/file-management.test.ts`
- **SATISFIES**: AC3, AC5, AC6, AC8.

### 11. ADD assembled integration, isolation, redaction, and direct-transfer tests

- **IMPLEMENT**: assemble in-memory project authentication, file repository, fake presigner/object store, and real RUS-04 service contract. Cover happy upload -> completion -> list/inspect -> one upload event/open storage.
- **IMPLEMENT**: cover exact 100 MiB/5 GiB boundaries, concurrent quota reservations, collision retry, duplicate/out-of-order notifications, missing/mismatched objects, partial usage/finalization retries, expired/unused URLs, late orphan cleanup, wrong project, guessed file/public IDs, caller key fields rejected, URL expiry/headers, and immutable visibility.
- **IMPLEMENT**: assert no byte body touches the API handler; the upload response URL points directly to the fake/expected S3 endpoint, and no API route accepts a file payload. Assert logs/errors/public JSON exclude API key, Authorization, presigned query, bucket, object key, internal project ID, Dynamo keys, AWS IDs, and stack traces.
- **PATTERN**: `tests/integration/project-credential-authentication.test.ts:320-479`; `tests/integration/usage-pricing-ledger.test.ts:203-314`; `core/http/handler.test.ts:31-217`.
- **GOTCHA**: do not serialize secret keys or full presigned URLs into snapshots/test output. Use synthetic values in memory and explicit exclusion assertions.
- **VALIDATE**: `npm test -- --project node tests/integration/direct-upload-file-lifecycle.test.ts`
- **SATISFIES**: AC1-AC8.

### 12. UPDATE repository truth and run local gates

- **IMPLEMENT**: update only the `AGENTS.md` repository-map status sentence after code/tests exist; state that File Management direct upload/list/metadata and completion are implemented and RUS-06+ remain pending. Do not change canonical product/architecture decisions or create local wiki copies.
- **IMPLEMENT**: format, lint, typecheck, run tests/coverage/build, regenerate ignored SST provider artifacts through the wrapper, and validate the Codex layer because `AGENTS.md` changed.
- **PATTERN**: repository Commands and validation rules in `AGENTS.md`.
- **GOTCHA**: no deploy, user creation, live upload, AWS data mutation, GitHub write, or `dev-rus02` change is authorized. Do not bypass `tooling/run-sst.mjs`.
- **VALIDATE**: `npm run check && python tooling/validate_codex_layer.py && uv run --script tooling/mcp/codebase_search.py --self-test`
- **SATISFIES**: AC1-AC8 and repository truthfulness.

---

## TESTING STRATEGY

### Unit Tests

- **Contracts**: accept exact public shapes; reject unknown fields, malformed IDs, invalid/empty/overlong names, invalid media types, non-integer/zero/negative/over-limit sizes, invalid visibility/status, unsafe cursor, non-HTTPS URL, missing/mutated required headers, and internal/AWS fields.
- **Trusted context**: project authentication returns only verified internal/public IDs, key ID, enabled utility, and URL settings; unknown/revoked/replaced/suspended/disabled/corrupt records remain indistinguishable `401` failures.
- **IDs/cursor/model**: deterministic injected entropy, correct prefixes, project-scoped cursor, key/object-prefix invariants, public-index sparsity, pending lifecycle index, terminal-field invariants, quota arithmetic, and corrupt/cross-project record rejection.
- **Repository**: assert exact Dynamo commands/conditions/transactions and pagination. Cover initialization, 100 MiB/5 GiB boundaries, two concurrent reservations where only one fits, collision, conditional cancellation classification, evidence claim, idempotent ready/failure replay, no double quota movement, and due-pending queries without `Scan`.
- **Presigner/object store**: exact key, expires-in seconds, content type/length/If-None-Match signing, required header echo, opaque URL mapping, HEAD-only behavior, absent/error classification, and exact-key cleanup.
- **Service/handlers**: successful `201`, settings-derived lifetime, public ID only for public visibility, list/inspect pagination, wrong-project/missing common `404`, shared validation/error envelopes, response-schema enforcement, safe logs, and no caller project/key/lifetime fields.
- **Completion**: event schema/key validation, duplicate and non-ordered records, first evidence claim, stable occurrence time, RUS-04 duplicate results, partial failure resume, actual/declared mismatch, missing HEAD retry, invalid cleanup, ready/failed terminal behavior, and batch partial failure behavior.
- **Infrastructure**: private bucket/BPA/CORS, only PUT event/prefix, Cron schedule, table indexes, production deletion protection/retention, route auth separation, explicit permissions, no `s3:*`/Dynamo wildcard, and no API byte route.

### Integration Tests

- Exercise the real shared HTTP/auth envelope around a fake storage data plane and in-memory file/usage repositories.
- Use two projects and overlapping/guessed file IDs to prove all list/inspect/upload context comes from the bearer.
- Simulate two authorization requests at the quota boundary and transaction races.
- Simulate notification duplicate, notification after reconciliation, reconciliation before delayed notification, usage write success followed by storage/finalization failure, and worker retry.
- Confirm one immutable upload usage event and one storage checkpoint per ready file.
- Confirm unused expiry and mismatched cleanup never create ready metadata or usage/storage records.
- Confirm output/log evidence excludes all implementation/security-sensitive values.

### Edge Cases

- Empty/whitespace/control-character filename; Unicode display name; maximum length.
- Invalid or overlong media type, parameters/case normalization decision, missing type.
- `sizeBytes` 0, fractional, unsafe integer, 100 MiB exact, one byte over.
- First project upload with absent quota item; quota exactly full; reserved plus retained exactly 5 GiB; concurrent last-slot requests.
- ID collision on file and public file identifiers.
- Private file accidentally receiving a public ID/index; public file missing either.
- Caller sends `projectId`, `objectKey`, `bucket`, `lifetimeMinutes`, visibility mutation, or extra JSON.
- Presign failure after reservation: mark authorization failed/release reservation through a compensating repository operation; never return a URL for an untracked object.
- HTTP client omits or changes any signed required header; S3 rejects it and the record remains pending/ultimately failed.
- Reuse of the same URL after first success; `If-None-Match: *` prevents overwrite.
- URL expires before use; use begins before expiry but completion notification arrives after expiry; delayed/missed notification; notification batch with mixed records.
- Duplicate event with same sequencer, out-of-order/conflicting sequencer, malformed/URL-encoded key, wrong bucket, COPY/multipart event, record missing/wrong project.
- HEAD 404/403/5xx, size mismatch, media-type mismatch, event/head eTag mismatch, missing LastModified.
- Worker dies after evidence claim, after upload usage, after storage open, after ready transition, after invalid object delete, or before quota release.
- Failed record receives a very late PUT event; ready record receives a duplicate/conflicting event.
- Dynamo conditional cancellation without reasons; corrupt numeric/key/status record; cursor from another project.

---

## VALIDATION COMMANDS

Execute every local command before claiming completion. AWS-backed commands are separate because this plan does not authorize external access or mutation.

### Level 1: Syntax & Style

```powershell
npm run format:check
npm run lint
npm run typecheck
```

### Level 2: Focused Unit Tests

```powershell
npm test -- --project node packages/contracts/src/files packages/backend/src/modules/project-authentication packages/backend/src/modules/file-management infra/config/file-management.test.ts infra/file-management.test.ts infra/bucket-link.test.ts infra/composition.test.ts
```

### Level 3: Integration and Full Regression

```powershell
npm test -- --project node tests/integration/direct-upload-file-lifecycle.test.ts tests/integration/project-credential-authentication.test.ts tests/integration/usage-pricing-ledger.test.ts
npm run test:coverage
npm run build
npm run check
```

Coverage must remain at least 80% for statements, branches, functions, and lines, with explicit tests for every release-blocking boundary rather than relying on aggregate coverage alone.

### Level 4: Local Infrastructure/Codex Validation

```powershell
npm run infra:install -- --stage dev-rus02
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

`infra:install` is local and uses the required wrapper. Restart Codex after the `AGENTS.md` status update so a later session rebuilds the instruction chain.

### Level 5: Authorized Non-Production Preview and Manual Validation

Only after the owner explicitly authorizes AWS reads/use of `dev-rus02`:

```powershell
npm run infra:diff -- --stage dev-rus02
```

The wrapper must set `AWS_PROFILE=ntz-cli`, `AWS_REGION=il-central-1`, the required CA bundle, and verify exact account `162067902192` plus principal `arn:aws:iam::162067902192:user/ntz-cli`. Stop on any mismatch. Do not probe another profile and do not deploy from this validation step.

After a separately authorized deploy of the same previewed stage, use a disposable project/key/file and never record credentials or the full presigned URL in evidence:

1. Request a private pending upload with a small known file.
2. PUT bytes directly to the opaque URL with every returned required header.
3. Poll metadata until `ready`; verify list shows exactly one file.
4. Confirm Lambda/API Gateway metrics/logs show no file body and no full URL/query.
5. Confirm exactly one upload usage event and one storage checkpoint after duplicate notification/retry.
6. Try changed content length/type and URL reuse; confirm S3 rejection/no overwrite.
7. Try wrong-project metadata lookup; confirm the same `404` as an unknown file.
8. Exercise one unused authorization through the grace/reconciliation path; confirm failed state and quota release without usage.

No deployment, key creation, data mutation, or live smoke test is implied by this plan.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1 — Private retained infrastructure:** One on-demand File table and one stage-private S3 bucket exist; CORS is disabled, all Block Public Access controls are explicit, HTTPS/private encryption assumptions hold, and production table/bucket data are protected/retained.
- [ ] **AC2 — Trusted upload authorization:** `POST /v1/files/uploads` validates strict JSON, authenticates through RUS-03, generates file/public identities and `projects/{internalProjectId}/files/{fileId}` internally, keeps visibility immutable, and accepts no caller project/key/bucket/lifetime.
- [ ] **AC3 — Bounds and atomic quota:** Name, media type, safe integer size, verified 1-60 minute project setting, binary 100 MiB file limit, and binary 5 GiB retained-plus-reserved project quota are enforced before signing; concurrent requests cannot overrun quota.
- [ ] **AC4 — Opaque constrained PUT:** The response contains a complete HTTPS `PUT` URL plus exact signed headers/expiry, but no bucket/key/internal ID/AWS detail. The signature binds exact key/type/length and `If-None-Match: *`; file bytes bypass Lambda/API Gateway.
- [ ] **AC5 — Explicit lifecycle:** Pending, ready, and failed states are persisted and validated. Issuance alone never creates ready/storage usage; unused expiry/mismatch follows resumable failure/cleanup and does not retain a quota reservation indefinitely or accrue product storage.
- [ ] **AC6 — Exactly-once observable completion:** S3 completion/reconciliation HEAD-verifies actual properties, claims stable evidence, records one `s3-upload-requests` event, opens one storage checkpoint, and finalizes ready once despite duplicates, non-ordering, missed notification, or partial retry.
- [ ] **AC7 — Project-scoped reads:** List and metadata operations query the trusted project partition; a file ID/public ID/object key is never authorization, and missing/wrong-project lookup is indistinguishable.
- [ ] **AC8 — Explicit adversarial tests:** Automated tests cover duplicate/out-of-order/missed notifications, missing/mismatched objects, quota races, wrong project, caller key attempts, URL expiry/header mutation/reuse, partial failure replay, redaction, and the no-byte-proxy invariant.
- [ ] All targeted and full validation commands pass with zero errors and at least 80% coverage thresholds.
- [ ] No RUS-06+ feature, dashboard change, AWS deployment/mutation, credential creation, or GitHub/wiki write is included.

---

## COMPLETION CHECKLIST

- [ ] Issue/workflow status and dependencies revalidated before implementation.
- [ ] All tasks completed in dependency order.
- [ ] Every task's targeted validation passed immediately.
- [ ] Public contracts contain no AWS/internal fields and remain strict.
- [ ] Project context derives exclusively from verified credential state.
- [ ] File/table/index/object-key invariants are parser-enforced.
- [ ] Quota reservation/finalization/failure transitions are atomic and race-tested.
- [ ] Presigned request headers are demonstrably signature-bound with the installed SDK.
- [ ] Completion and reconciliation reuse one idempotent saga and stable RUS-04 inputs.
- [ ] Invalid object cleanup cannot target a caller-chosen or cross-project key.
- [ ] No file bytes pass through Lambda/API Gateway and no full URL/credential is logged.
- [ ] Infrastructure policies contain no public access, wildcard CORS, or wildcard IAM actions.
- [ ] Unit/integration/coverage/build/full check all pass.
- [ ] `AGENTS.md` repository-map status is truthful and Codex-layer validation passes.
- [ ] Any authorized `infra:diff` used the wrapper and exact AWS identity; no unapproved deployment occurred.
- [ ] Acceptance criteria AC1-AC8 are all checked with evidence.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Workflow label drift:** As of 2026-08-23, issue #5 is open with `queued`, not the ticket-required `ready`, although RUS-03 and RUS-04 are closed and the repository says both are implemented. The owner's explicit `$piv-plan-implementation` invocation is treated as authorization to create this local plan, not to change GitHub workflow state. Before implementation, either add/confirm `ready` through an authorized GitHub workflow or obtain an explicit owner override.
- **REST route choice:** The wiki defines operations but not exact paths. This plan owns the ticket-level decision `POST /v1/files/uploads`, `GET /v1/files`, and `GET /v1/files/{fileId}`. Changing these after consumer integration is a public-contract change.
- **Trusted context expansion:** RUS-03 intentionally kept `TrustedProjectContext` minimal. RUS-05 needs verified upload lifetime and should store the verified public project identity for RUS-06. The plan extends the internal context from the same verification snapshot rather than adding a second unindexed ControlTable lookup.
- **Binary limits:** The plan interprets the approved “100 MB” and “5 GB” limits as 100 MiB and 5 GiB, aligned with the repository's existing `BINARY_GIB_BYTES`. If product intent is decimal bytes, change the constants/contracts/tests before implementation; do not mix units.
- **Server-side transfer client:** Bucket CORS is disabled because project API keys cannot safely be used in browser/mobile code. Any browser-direct upload requires delegated authorization and is explicitly deferred.
- **Notification transport:** Use direct S3 `ObjectCreated:Put` to Lambda plus scheduled reconciliation, not EventBridge event bus/SQS. File state/usage idempotency supplies duplicate safety; RUS-10 owns later backlog/DLQ observability.
- **Completion grace:** The proposed non-public grace is 60 minutes beyond URL expiry, reconciled every five minutes. It balances uploads begun just before expiry against stale quota reservations. Keep it a named tested constant so owner evidence can change it without changing the public API.
- **Signed length constraint:** The architecture requires presigned `PUT`, while S3 POST policy is the API with a native `content-length-range` condition. This plan binds an exact `Content-Length` header through the v3 presigner and then HEAD-verifies actual length. Implementation must prove the installed SDK preserves the signature constraint; if not, stop rather than weakening it or silently changing the approved transfer architecture.
- **Event occurrence time:** First valid S3 event time is canonical; reconciliation uses `HeadObject.LastModified` only when no event claimed evidence. The stored claim is reused for price selection and storage opening on every retry.
- **Rate limiting:** The architecture's 60 control requests/project/minute guardrail is ticketed to RUS-10. RUS-05 leaves an explicit middleware seam and must not claim release readiness before RUS-10.
- **No current blocking product/architecture question:** The canonical Architecture page states none remain for MVP implementation. The assumptions above are local contract/operational choices; workflow readiness and signed-header feasibility are the two pre-execution checks.

## NOTES (open canvas)

### Why reserve before presigning

Checking current retained bytes and then writing a pending file in separate operations permits two concurrent requests to both pass a 5 GiB boundary. The quota item and pending record therefore change in one DynamoDB transaction. Pending bytes are reservations, not billable storage; they move to retained only after HEAD verification and usage/storage handoff. Failure releases them only after an invalid physical object is absent.

### Why completion evidence is claimed before usage

RUS-04 dedupe fingerprints include occurrence time. Recomputing that time from each retry or from a delayed event would convert a benign duplicate into a source conflict. The file record first claims one canonical event/LastModified time and object evidence. Every retry then supplies identical `recordUsage`/`openStorage` inputs.

### Why readiness follows usage handoff

The usage table and file table are separate bounded contexts and the existing RUS-04 API deliberately owns its own transactions. Instead of coupling both tables in a new cross-domain transaction, the worker uses a resumable saga:

```text
pending + evidence
  -> idempotent upload usage
  -> idempotent storage open
  -> conditional ready/quota transition
```

Any failure throws and replays. Public readers may temporarily observe pending, but never ready without the required usage/storage evidence.

### Security boundaries

```text
Bearer credential
  -> RUS-03 verification
  -> TrustedProjectContext (internal/public identity + bounded settings)
  -> File service generates file IDs and object key
  -> presigner authorizes one exact private-bucket PUT
  -> client sends bytes directly to S3

S3 event / scheduled HEAD
  -> exact bucket/key parser
  -> project-scoped pending record
  -> metadata verification
  -> RUS-04 usage/storage
  -> ready metadata
```

The user-visible file ID helps address a resource; it never establishes the project. The object key is an internal organization/IAM boundary; it never appears in public JSON.

### Confidence Score

**8/10** for one-pass implementation under the stated assumptions. The repository has strong authentication, Dynamo repository, REST envelope, redaction, usage idempotency, infrastructure, and Vitest patterns. The remaining risk is concentrated in three seams: proving exact signed `Content-Length`/conditional PUT behavior with the installed AWS SDK, composing least-privilege SST bucket links/notifications/cron with handwritten test types, and making the file/usage saga plus failed-object cleanup correct under every partial retry. The plan makes each risk explicit and independently testable.

## AMENDMENTS

<!-- Append entries only after initial approval/execution. -->
