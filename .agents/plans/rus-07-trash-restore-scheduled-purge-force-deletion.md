# Feature: RUS-07 Trash, Restore, Scheduled Purge, and Force Deletion

The following plan is complete, but implementation must revalidate the issue state, current repository patterns, installed SST/AWS SDK types, and the cited official documentation before changing files. Pay special attention to the persisted permanent-removal evidence, the ordering of S3 deletion/storage closure/quota release, and project-scoped authorization. Do not deploy or mutate AWS resources without separate owner authorization.

## Feature Description

Add the recoverable and permanent deletion half of File Management. A project-authenticated caller can move a ready file to trash for 14 days, restore it without changing any project/file/public/object identity, or explicitly request immediate permanent deletion with `force=true`. A scheduled worker permanently removes expired trash. Trashed objects remain private, inaccessible, quota-counted, and storage-billed until physical S3 removal succeeds. Permanent removal closes the existing RUS-04 storage checkpoint once and only then atomically removes active file metadata and releases retained quota.

The implementation extends the existing sparse `FileLifecycle` DynamoDB index and the RUS-05 file state/repository contract. It does not create another table, index, bucket, or usage model.

## User Story

As a server-side application using File Management,
I want normal deletion to be recoverable and permanent deletion to be explicit,
So that accidental deletion can be undone while expired or deliberately removed files stop consuming retained storage and cost.

## Problem Statement

RUS-05/06 support upload, metadata, and downloads, but a ready file currently has no legal path to trash, restore, or permanent removal. Deleting only metadata would orphan physical bytes and storage charges. Deleting only S3 bytes would leave downloadable/visible metadata and retained quota. Closing usage or decrementing quota before physical deletion would undercount cost and allow quota reuse while the object still exists. S3 and DynamoDB cannot participate in one transaction, so a crash-safe, evidence-backed saga is required.

## Solution Statement

Extend the public file status with `trashed` and the persisted file record with trash/due-index fields plus internal permanent-removal progress evidence. Normal delete conditionally changes `ready -> trashed`, sets `trashedAt` and `purgeAt = trashedAt + 14 days`, preserves the public index/object identity, and does not touch usage or quota. Restore conditionally changes an unclaimed, unexpired `trashed -> ready`, removes the purge index fields, and leaves S3, quota, and storage checkpoints unchanged.

Both scheduled purge and `force=true` invoke one permanent-removal saga:

1. Persist/claim `purgeStartedAt` to make the file non-restorable and give retries one operation identity. Force deletion also transitions a ready file to trash and moves its due key to the current time so the worker can resume a failed synchronous request.
2. Delete the exact server-derived S3 key through the existing idempotent `ObjectStore.delete` adapter.
3. Persist `objectRemovedAt` only after the delete succeeds. If the process dies between steps 2 and 3, retrying the idempotent delete may conservatively move this observation time later; it must never infer an earlier physical-removal time.
4. Call RUS-04 `closeStorage` with the persisted `objectRemovedAt`, original file ID, and verified completion size. A retry reuses the exact timestamp required by the existing idempotency contract.
5. Atomically delete the active File item and decrement `retainedBytes` and `accountedBytes`. The quota stays occupied if S3 deletion or usage closure has not completed.

The final file row is removed rather than converted into an indefinite tombstone. The closed usage checkpoint/ledger remains the policy-required evidence. A repeated in-flight operation is idempotent; an HTTP force-delete retried after full completion returns the same project-scoped not-found response as any absent file, while its effects remain idempotent.

## Out of Scope / Non-Goals

- Not included: dashboard trash/restore/confirmation UI (RUS-09).
- Not included: download metering, CloudTrail ingestion, reconciliation, or pricing-gate work (RUS-08).
- Not included: rate limiting, suspension, alarms, generalized DLQ/quarantine infrastructure, or production observability (RUS-10).
- Not included: S3 lifecycle rules for trash. S3 object age is not trash age, and the approved architecture requires an application-owned purge-time index.
- Not included: DynamoDB TTL for active File records or indefinite purge tombstones.
- Not included: deletion of `pending` or `failed` uploads through the lifecycle API; RUS-05 reconciliation continues to own their cleanup.
- Not changing: immutable visibility, project/public/file/object identities, private bucket posture, 100 MB limit, 5 GB retained quota, or direct S3 transfer behavior.
- Not changing: usage pricing/repository internals; File Management consumes the existing `closeStorage` service contract.
- Not changing: the existing upload-reconciliation Cron or migrating all scheduled resources from `sst.aws.Cron` to `CronV2` in this ticket.

## Feature Metadata

**Feature Type**: New Capability

**Estimated Complexity**: High

**Estimated Change Size**: approximately 1,000-1,600 lines including tests

**Primary Systems Affected**: shared file REST contracts, File Management model/repository/services, S3 object removal, RUS-04 storage checkpoint integration, API routing/IAM, SST scheduled worker, lifecycle integration tests

**Dependencies**: merged RUS-04 usage ledger, merged RUS-05 upload/file lifecycle, merged RUS-06 download gating, pinned Node 24/TypeScript 6/Zod 4/AWS SDK v3/SST 4/Vitest 4 workspace

## Related Work

**Implements**: [GitHub issue RUS-07](https://github.com/noamtz/utility-services/issues/7) · **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) · **Architecture**: [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture)

**Workflow state at planning time (2026-08-23):** issue #7 is open and its only stated dependency, RUS-05, is closed, but the issue still has the stale `queued` label instead of `ready`. The owner explicitly invoked this planning workflow, so planning proceeded; correct the issue label/project workflow before implementation begins.

**Back-references:**

- `.agents/plans/rus-04-versioned-pricing-usage-ledger.md` (lines 65-66, 417-420) - Assigns RUS-07 responsibility for closing storage only after physical removal and explicitly keeps trash billable.
- `.agents/plans/rus-05-direct-upload-file-metadata-lifecycle.md` (lines 276-314, 335) - Establishes the sparse lifecycle index, atomic quota invariants, exact object-key cleanup, and resumable asynchronous patterns this plan extends.
- `.agents/plans/rus-06-private-download-stable-public-access.md` - Establishes ready-only private/public download authorization and public identity lookup behavior that trash must fail closed.

**Forward-references:**

- RUS-09 consumes `trashed`, `purgeAt`, restore, and force-delete contracts in the dashboard.
- RUS-10 adds lifecycle backlog/error alarms and operational retry visibility around the worker.
- RUS-11 proves scheduled-purge retry and the complete owner journey end to end.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/contracts/src/files/contract.ts` (lines 10-16, 53-91, 139-168) - Current strict file IDs/status/DTO/path schemas. Extend status and lifecycle contracts without leaking internal progress evidence.
- `packages/contracts/src/files/contract.test.ts` - Contract strictness, public identity, and internal-field exclusion tests to extend.
- `packages/contracts/src/index.ts` (file-contract export block) - Public schema/type exports for new query/result contracts.
- `packages/backend/src/modules/file-management/model.ts` (lines 13-16, 38-82, 88-128, 150-203) - Current file/quota schemas, exact object identity, sparse lifecycle keys, and state/quota invariants.
- `packages/backend/src/modules/file-management/model.test.ts` (lines 54-106) - State/index/quota parser test style.
- `packages/backend/src/modules/file-management/repository.ts` (lines 29-65, 74-101, 176-189, 261-410, 459-596) - Repository surface, transaction token pattern, conditional state changes, atomic quota movement/release, and paginated lifecycle GSI query.
- `packages/backend/src/modules/file-management/repository.test.ts` (lines 194-375) - Dynamo command/transaction assertions, lifecycle query, terminal replay, and cleanup-before-quota-release tests.
- `packages/backend/src/modules/file-management/service.ts` (lines 29-69, 147-186) - Public mapping, project-scoped not-found behavior, and file service composition.
- `packages/backend/src/modules/file-management/downloads.ts` (lines 36-93) - Both private/public flows already require `status === "ready"`; preserve this fail-closed rule.
- `packages/backend/src/modules/file-management/downloads.test.ts` (lines 121-195) - Existing future-`trashed` denial cases that must become typed regression tests.
- `packages/backend/src/modules/file-management/completion.ts` (lines 133-210, 213-267) - Existing resumable S3/usage saga and bounded paginated worker loop. Late duplicate completion for a typed trashed record needs an explicit safe no-op branch.
- `packages/backend/src/modules/file-management/object-store.ts` (lines 19-27, 36-43, 49-94) - Exact-key validation and idempotent S3 delete adapter; reuse it unchanged unless tests expose a missing documented case.
- `packages/backend/src/modules/file-management/handlers.ts` (lines 23-85) - Validated/authenticated handler factory pattern.
- `packages/backend/src/modules/file-management/runtime.ts` (lines 24-80, 82-120) - API runtime currently lacks object-store/usage composition; worker runtime already has all permanent-removal dependencies.
- `packages/backend/src/modules/file-management/workers.ts` (lines 1-25) - Cached worker-service and thin exported worker pattern.
- `packages/backend/src/modules/usage-pricing/service.ts` (lines 279-374, 519-533) - `openStorage`/`closeStorage`; a duplicate close is idempotent only with identical size and `through`.
- `packages/backend/src/modules/usage-pricing/service.test.ts` (lines 323-422) - Duplicate close, trash-like continued accrual, boundary splitting, and conflict expectations.
- `packages/backend/src/modules/usage-pricing/model.ts` (lines 109-138) - Active/closed storage checkpoint evidence retained after file metadata removal.
- `infra/config/file-management.ts` (lines 3-12, 16-35, 54-112) - Existing lifecycle GSI, five routes, schedules, and least-privilege action groups.
- `infra/file-management.ts` (lines 25-81) - File table/bucket, completion subscriber, and current `sst.aws.Cron` reconciler construction.
- `infra/file-management.test.ts` - Resource count, notification, Cron, links, and permission tests to extend.
- `infra/api.ts` (lines 21-33, 80-106) - File route permission/link assembly; delete needs route-specific UsagePricingTable access.
- `infra/composition.test.ts` (lines 48-69) - Route count/order, bucket actions, indexes, and wildcard-policy assertions.
- `packages/backend/src/functions/files/*.ts` - One-line Lambda entrypoint convention.
- `tests/integration/direct-upload-file-lifecycle.test.ts` (lines 97-207, 355-452, 705-741) - Existing in-memory File/Usage assembly, quota accounting, checkpoint assertions, and future trashed download denial.
- `sst.config.ts` (lines 20-55) - Existing control/usage/file resource composition and API wiring.
- `package.json`, `packages/backend/package.json`, `vitest.config.ts` - Pinned tool/runtime versions, validation scripts, Node/dashboard test projects, and 80% coverage thresholds.

### New Files to Create

- `packages/backend/src/modules/file-management/lifecycle.ts` - Trash/restore API orchestration plus the shared permanent-removal saga and bounded due-purge loop.
- `packages/backend/src/modules/file-management/lifecycle.test.ts` - State legality, timestamps, cross-project safety, force/scheduled convergence, and injected partial-failure retry tests.
- `packages/backend/src/functions/files/delete-file.ts` - Thin export of the authenticated delete handler.
- `packages/backend/src/functions/files/restore-file.ts` - Thin export of the authenticated restore handler.
- `packages/backend/src/functions/files/purge-trashed-files.ts` - Thin scheduled-worker export.
- `tests/integration/file-trash-lifecycle.test.ts` - Assembled ready/trash/restore/purge/force/quota/storage/download workflow tests. Reuse test patterns, not production persistence code, from the direct-upload integration suite.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Product Requirements Epic](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic)
  - Specific section: MVP upload/download journey and trust guardrail.
  - Why: Bounds user value and prevents lifecycle work from expanding into dashboard/billing scope.
- [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture)
  - Specific sections: File table; File contracts and project isolation; Storage and upload metering; Usage reliability and reconciliation.
  - Why: Canonically selects 14-day application-owned trash, scheduled purge, same permanent-removal path for force, and billing/quota through physical removal.
- [Amazon S3 DeleteObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html)
  - Specific sections: general-purpose bucket behavior, permissions, versioning notes, response semantics.
  - Why: The stage bucket is unversioned; a later versioning change would invalidate the current permanent-delete assumption and require version IDs/permissions.
- [Deleting Amazon S3 objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjects.html)
  - Specific section: delete behavior for unversioned/versioned buckets.
  - Why: Confirms the physical-removal boundary and the versioning gotcha.
- [DynamoDB Query key condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.KeyConditionExpressions.html)
  - Specific sections: equality partition condition, sort-key comparison, pagination/ordering.
  - Why: `PURGE#DUE` plus `purgeAt#project#file` must be queried with `<= now`, not scanned/filtered.
- [DynamoDB condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
  - Specific section: conditional write semantics.
  - Why: Restore/claim races and quota release depend on atomic preconditions.
- [DynamoDB update expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html)
  - Specific section: `SET`/`REMOVE` and upsert behavior.
  - Why: Include state/`attribute_exists` guards so a lifecycle update never recreates a missing file.
- [SST Cron component](https://sst.dev/docs/component/aws/cron/)
  - Specific sections: schedule and function.
  - Why: Mirrors the pinned repository pattern for the purge worker; do not opportunistically migrate existing schedules.
- [EventBridge rule retry policy](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html)
  - Specific sections: retry duration/attempts and DLQ behavior.
  - Why: Scheduled delivery is at least once in practice and can be duplicated; the worker must be idempotent even without RUS-10 operational hardening.
- [AWS Lambda idempotent code best practice](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html#function-code)
  - Specific section: write idempotent code and account for duplicate events.
  - Why: Supports the persisted saga/evidence design.

### Patterns to Follow

**Naming Conventions:**

- Public schema/type names use PascalCase and `Schema` suffix; service/repository operations use verb-first camelCase (`authorizeUpload`, `finalizeReady`, `listDuePending`).
- Persisted index partition constants are uppercase semantic strings. Add a distinct purge partition such as `TRASH#PENDING_PURGE`; do not overload `UPLOAD#PENDING`.
- Public IDs and object keys remain generated/parsed through existing helpers. Lifecycle methods take trusted internal project context and file IDs, never an object key from HTTP.

**State and index invariants:**

```ts
// Existing fail-closed download rule to preserve.
if (!item || item.internalProjectId !== project.internalProjectId || item.status !== "ready") {
  throw fileNotFound();
}
```

- `ready`: no purge GSI/progress fields.
- `trashed`: `trashedAt`, `purgeAt`, and exact purge GSI keys are required; public identity/GSI and object key remain unchanged.
- Claimed removal stays publicly `trashed` but has internal `purgeStartedAt`; restore requires that field to be absent.
- Object-deleted progress additionally requires `objectRemovedAt >= purgeStartedAt`; this stable timestamp is the only permitted `closeStorage.through` value.
- `pending` and `failed` retain current invariants and cannot enter the public lifecycle API.
- Final permanent removal deletes the File row; no `purged` File status or indefinite file tombstone is persisted.

**Conditional repository pattern:**

```ts
// Mirror existing revision/state checks and reread-on-conditional-failure behavior.
ConditionExpression:
  "#status = :trashed AND revision = :revision AND attribute_not_exists(purgeStartedAt)"
```

- Repository methods own DynamoDB expressions and translate named conditional races to `FileStateConflictError`.
- Services own HTTP-safe not-found/state mapping and low, bounded retries only for named concurrency conflicts.
- Every update includes state, identity, and `attribute_exists`/revision guards. DynamoDB `UpdateItem` must never upsert a missing row.

**Permanent-removal ordering:**

```text
project-scoped lookup
  -> claim persisted purgeStartedAt (restore now impossible)
  -> S3 DeleteObject exact server key
  -> persist objectRemovedAt after success
  -> closeStorage(... through = objectRemovedAt)
  -> transaction: delete File row + retained/accounted quota -= verified size
```

- Do not decrement quota or delete metadata before S3 success.
- Do not close storage at `purgeStartedAt`; deletion may fail or be delayed. Persist `objectRemovedAt` after success and reuse it on every retry.
- If S3 succeeds and persisting `objectRemovedAt` fails, retrying S3 delete is safe and produces a conservative later removal observation rather than undercharging.
- If usage closure fails, keep the claimed metadata/GSI and full quota so the API or worker can resume.
- If the final Dynamo transaction fails, storage remains closed and quota remains conservative until retry.
- Use a deterministic Dynamo transaction token derived from file ID plus `purgeStartedAt`; an absent File row after an ambiguous final transaction is an idempotent completion only when the caller began from a validated claimed record.

**REST/error pattern:**

- Proposed ticket-local contract: `DELETE /v1/files/{fileId}` with optional exact string query `force=true|false` (default false), and `POST /v1/files/{fileId}/restore`.
- Do not use `z.coerce.boolean()` for query strings because non-empty `"false"` coerces truthy; parse a strict string enum and transform it.
- Return the shared JSON success envelope. Delete returns a strict `{ fileId, disposition: "trashed" | "purged", purgeAt? }` payload; restore returns `File`.
- `404 FILE_NOT_FOUND` covers missing and wrong-project IDs. `409 FILE_STATE_CONFLICT` covers pending/failed, expired restore, and restore after a purge claim. Malformed `force` is the shared `400 VALIDATION_ERROR`.
- Do not expose object keys, bucket names, internal project IDs, usage subject digests, progress timestamps, conditional failures, or AWS errors.

**Logging Pattern:**

- Continue using `safeLogger` through the shared HTTP boundary and existing structured worker logging foundations. Log IDs/status/operation phase only; never log API keys, authorization headers, full presigned URLs, bucket names, or object keys.

---

## IMPLEMENTATION PLAN

### Phase 1: Public Contracts and Lifecycle State Foundation

Extend the public lifecycle vocabulary and strict persisted state/index invariants before orchestration. Reuse the existing FileLifecycle GSI with a separate purge partition; no infrastructure schema migration is needed.

**Tasks:**

- Add typed delete query/result schemas, `trashed` public state, and optional trash timestamps with strict cross-field validation.
- Add persisted trash, purge claim, and object-removal evidence plus exact key constructors/parsers.
- Extend model/contract tests for legal and corrupt combinations.

### Phase 2: Conditional Repository Transitions

**Depends on:** Phase 1.

Add project-scoped, state-checked repository operations for trash, restore, force/scheduled removal claim, physical-removal evidence, final metadata/quota removal, and paginated due-purge access.

**Tasks:**

- Preserve quota and public/object identity on trash/restore.
- Resolve restore-vs-purge races with conditional writes and `purgeStartedAt`.
- Release quota only in the transaction that removes the fully processed File row.
- Prove query ordering/pagination and idempotent replay at the raw Dynamo-command boundary.

### Phase 3: Shared Lifecycle and Permanent-Removal Services

**Depends on:** Phase 2 and the existing RUS-04 `closeStorage` service.

Create one lifecycle service used by HTTP and the scheduled worker. Keep normal trash/restore metadata-only; route both force and due purge through the same persisted saga.

**Tasks:**

- Implement project-scoped trash/restore and safe error mapping.
- Implement force claim/resume and due-worker claim/resume.
- Delete the exact S3 object, persist removal observation, close storage with stable evidence, then finalize metadata/quota.
- Add a bounded, paginated due-purge loop with retryable failures and no batch-wide silent success.
- Make late duplicate upload completion for a typed trashed record a safe no-op when its completion evidence matches.

### Phase 4: REST, Runtime, Worker, and Infrastructure Integration

**Depends on:** Phase 3.

Register authenticated `/v1` lifecycle routes and a dedicated scheduled purge Lambda. Give only the DELETE function and purge worker S3/usage access; restore remains a file-table operation. Keep the public route unauthenticated and read-only.

**Tasks:**

- Add handler factories and thin Lambda entrypoints.
- Compose the lifecycle service into API and worker runtimes without importing usage persistence internals.
- Extend route-specific API permissions/links for the usage table.
- Add a dedicated purge Cron, exact links/actions, and composition tests.

### Phase 5: Integrated Failure, Security, and Regression Proof

**Depends on:** Phases 1-4.

Prove the complete lifecycle through unit, integration, infrastructure, and full repository checks, including every cross-resource failure window and cross-project denial.

**Tasks:**

- Test ready/trash/restore identity preservation and immediate download denial.
- Test scheduled/force convergence, time boundaries, repeated calls, and pagination.
- Inject S3, removal-evidence, usage-close, and final-transaction failures and prove retry/idempotency/quota ordering.
- Run focused tests, 80% coverage gates, build, and preview-only infrastructure diff when credentials are available.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. UPDATE `packages/contracts/src/files/contract.ts`, `contract.test.ts`, and `packages/contracts/src/index.ts`

- **IMPLEMENT**: Extend `FileStatusSchema` with `trashed`; add `trashedAt`/`purgeAt` to `FileSchema` only for trashed results; add strict `DeleteFileQuerySchema`, `DeleteFileResultSchema`, response schema/type exports, and reuse `FilePathSchema` for restore.
- **PATTERN**: Mirror strict object/super-refinement and success-envelope patterns at `contract.ts:53-91, 139-152`.
- **GOTCHA**: Parse `force` from `"true" | "false"`, default false, and reject all other forms. Do not use broad boolean coercion.
- **GOTCHA**: Internal `purgeStartedAt` and `objectRemovedAt` never enter the public contract.
- **VALIDATE**: `npx vitest run --project node packages/contracts/src/files/contract.test.ts`
- **SATISFIES**: AC1, AC3, AC5, AC7, AC8.

### 2. UPDATE `packages/backend/src/modules/file-management/model.ts` and `model.test.ts`

- **IMPLEMENT**: Add 14-day retention constant, purge lifecycle partition/sort-key constructor, and strict fields `trashedAt`, `purgeAt`, optional `purgeStartedAt`, optional `objectRemovedAt`; accept `trashed` while preserving existing pending/ready/failed invariants.
- **IMPLEMENT**: Require a trashed item to retain exact project/file/public/object identity, the purge GSI keys, completion evidence/ready timestamp needed for size/opened-storage evidence, and monotonic timestamps (`trashedAt <= purgeAt`, `purgeStartedAt` only on trash, `objectRemovedAt >= purgeStartedAt`).
- **PATTERN**: Mirror `pendingUploadSortKey` canonical timestamp + project + file ordering at `model.ts:122-128`.
- **GOTCHA**: Do not remove the public GSI keys on trash; restore must preserve the stable public URL identity.
- **GOTCHA**: Do not create a persisted `purged` File state; final removal deletes active metadata.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/model.test.ts packages/contracts/src/files/contract.test.ts`
- **SATISFIES**: AC1, AC2, AC3, AC4, AC6, AC7.

### 3. UPDATE `packages/backend/src/modules/file-management/repository.ts` and `repository.test.ts`

- **IMPLEMENT**: Extend `FileRepository` with typed `trash`, `restore`, `claimPermanentRemoval`, `recordObjectRemoved`, `finalizePermanentRemoval`, and `listDuePurge` operations/results.
- **IMPLEMENT**: `trash` conditionally changes ready to trashed, sets due index/timestamps, and treats the same existing trashed state as idempotent without any quota write.
- **IMPLEMENT**: `restore` conditionally requires trashed, unexpired, and no purge claim; changes status to ready and removes only trash/purge GSI/progress fields. Treat an already-ready exact-project item as an idempotent no-op; pending/failed remain illegal.
- **IMPLEMENT**: Force claim accepts ready or trashed, sets/retains trash state, moves `purgeAt`/GSI due time to the force request time, and persists `purgeStartedAt`. Scheduled claim requires `purgeAt <= dueThrough`. Both reread and resume an identical existing claim.
- **IMPLEMENT**: `recordObjectRemoved` conditionally persists the first successful S3-removal observation. Replays return the same timestamp; they must not overwrite it with a fresh clock.
- **IMPLEMENT**: `finalizePermanentRemoval` uses a deterministic token and one transaction: conditionally delete the claimed File row and decrement quota `retainedBytes`/`accountedBytes` by the completion size. Require `objectRemovedAt` and never decrement `reservedBytes`.
- **IMPLEMENT**: Query `TRASH#PENDING_PURGE` with `gsi2sk <= now#\uffff`, ascending, bounded limit, and `LastEvaluatedKey` just as `listDuePending` does.
- **PATTERN**: Mirror cancellation-reason classification, revision guards, exact reread, and quota transaction structure at `repository.ts:261-410, 459-596`.
- **GOTCHA**: An `UpdateItem` without an existence/state condition can recreate a purged file. Guard every update.
- **GOTCHA**: A missing row is idempotent completion only in `finalizePermanentRemoval` after the method received a validated claimed record; ordinary API lookup remains 404.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/repository.test.ts packages/backend/src/modules/file-management/model.test.ts`
- **SATISFIES**: AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8.

### 4. CREATE `packages/backend/src/modules/file-management/lifecycle.ts` and `lifecycle.test.ts`

- **IMPLEMENT**: Define injected `repository`, `objectStore`, `usage.closeStorage`, clock, page-size/max-page settings, and a service surface for authenticated delete/restore plus scheduled due processing.
- **IMPLEMENT**: Use only `TrustedProjectContext.internalProjectId` for HTTP lookup. Verify repository results remain in that project and map missing/wrong-project to the same safe 404.
- **IMPLEMENT**: Normal delete computes exactly 14 days from one injected timestamp, calls repository trash, and returns the strict trashed result without S3/usage/quota work.
- **IMPLEMENT**: Restore uses one injected timestamp, rejects at `now >= purgeAt` or after a claim, and returns `toPublicFile` with the same IDs/object-backed metadata.
- **IMPLEMENT**: Force delete claims/resumes permanent removal, then invokes the same internal `permanentlyRemove` operation used by scheduled records.
- **IMPLEMENT**: `permanentlyRemove` performs S3 delete -> persist `objectRemovedAt` -> `closeStorage` with completion-evidence size and persisted removal time -> final metadata/quota transaction. Never calculate a replacement close time on retry.
- **IMPLEMENT**: The due loop pages the purge GSI in bounded batches and processes each item through claim/resume. Let an unexpected item failure fail the invocation for EventBridge retry; do not report success while silently skipping a due item.
- **PATTERN**: Mirror dependency injection and bounded loop style from `completion.ts:100-131, 244-264`.
- **TEST**: Cover exact 14-day calculation, before/at/after retention boundary, idempotent trash/restore, pending/failed conflicts, force from ready/trashed, same-saga convergence, and every injected failure window.
- **GOTCHA**: Storage size comes from verified completion evidence/current ready file, never an HTTP value.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/lifecycle.test.ts packages/backend/src/modules/usage-pricing/service.test.ts`
- **SATISFIES**: AC1-AC8.

### 5. UPDATE `packages/backend/src/modules/file-management/service.ts`, `downloads.ts`, `completion.ts`, and their tests

- **IMPLEMENT**: Extend `toPublicFile` to include trash timestamps only for trashed records. Keep list/inspect project-scoped and allow owners to observe trashed metadata.
- **IMPLEMENT**: Preserve the ready-only checks in both download paths; convert existing future-state fixtures to typed `trashed` records and assert no presigner call.
- **IMPLEMENT**: Treat a late duplicate completion against a trashed record with matching completion evidence as a no-op. Conflicting evidence remains an error; never reopen/charge/finalize it.
- **PATTERN**: Existing `ready` completion replay at `completion.ts:166-169` and download denial at `downloads.ts:55-92`.
- **GOTCHA**: Do not let a completion notification clear trash or re-add retained quota/storage usage.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/service.test.ts packages/backend/src/modules/file-management/downloads.test.ts packages/backend/src/modules/file-management/completion.test.ts`
- **SATISFIES**: AC1, AC2, AC3, AC6, AC7, AC8.

### 6. UPDATE `packages/backend/src/modules/file-management/handlers.ts`, `handlers.test.ts`, and CREATE lifecycle function entrypoints

- **IMPLEMENT**: Add authenticated delete and restore handler factories using `FilePathSchema`, strict delete query schema, lifecycle service, shared response envelopes, and `safeLogger`.
- **IMPLEMENT**: Add one-line `delete-file.ts`, `restore-file.ts`, and `purge-trashed-files.ts` exports following existing function files.
- **TEST**: Exact `force=true`, omitted/`false`, malformed query, response schema, expired/state conflict, cross-project 404, and safe 500 redaction.
- **GOTCHA**: The force query is the explicit irreversible confirmation; no body/object key/project ID is accepted.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/handlers.test.ts packages/backend/src/core/http/handler.test.ts`
- **SATISFIES**: AC1, AC3, AC5, AC7, AC8.

### 7. UPDATE `packages/backend/src/modules/file-management/runtime.ts`, `runtime.test.ts`, and `workers.ts`

- **IMPLEMENT**: Compose one lifecycle service with the existing file repository, exact-key S3 ObjectStore, and `createUsagePricingRuntime` service. Make it available to the DELETE handler and the scheduled worker; restore may share the same service but must receive no additional IAM permissions beyond its route.
- **IMPLEMENT**: Cache lifecycle worker composition separately from upload completion and export `purgeTrashedFiles()`.
- **PATTERN**: Mirror `createFileWorkerRuntime` and `workers.ts:4-24`; do not import Dynamo usage repository/model details into File Management.
- **GOTCHA**: The API Lambda needs `Resource.UsagePricingTable` linked only where force deletion calls usage; route/link assembly must match runtime resource access.
- **VALIDATE**: `npx vitest run --project node packages/backend/src/modules/file-management/runtime.test.ts packages/backend/src/modules/file-management/lifecycle.test.ts`
- **SATISFIES**: AC4, AC5, AC6.

### 8. UPDATE `infra/config/file-management.ts` and its tests

- **IMPLEMENT**: Add route definitions for `DELETE /v1/files/{fileId}` and `POST /v1/files/{fileId}/restore`, a dedicated purge component/schedule, and explicit route fields for usage-table actions.
- **IMPLEMENT**: Give delete the exact file-table/S3 delete/usage-table actions needed by synchronous force; give restore only authentication + file read/update; keep public download with no control/file writes.
- **IMPLEMENT**: Add dedicated purge worker action sets for lifecycle query/update/transact, S3 delete, and usage checkpoint/ledger operations. Avoid wildcard permissions.
- **ASSUMPTION**: Use a new `rate(5 minutes)` purge schedule to match the existing reconciliation cadence and bound overdue trash while preserving a separate worker boundary.
- **GOTCHA**: Reuse the existing `FileLifecycle` GSI fields; adding a second index/table is out of scope.
- **VALIDATE**: `npx vitest run --project node infra/config/file-management.test.ts infra/composition.test.ts`
- **SATISFIES**: AC1, AC3, AC4, AC5, AC8.

### 9. UPDATE `infra/api.ts`, `infra/file-management.ts`, `infra/file-management.test.ts`, and `infra/composition.test.ts`

- **IMPLEMENT**: Extend file-route assembly with per-route UsagePricingTable links/permissions. Link usage only to routes that declare actions; preserve current control/file/bucket least privilege.
- **IMPLEMENT**: Instantiate a dedicated purge `sst.aws.Cron` using the new handler and exact FileTable/FileBucket/UsagePricingTable links/actions. Return it from `createFileManagementResources` for composition tests.
- **PATTERN**: Mirror the existing worker/Cron at `infra/file-management.ts:49-79` and route loop at `infra/api.ts:80-104`.
- **TEST**: Seven routes, expected methods/handlers, exact action/resource groups, two independent Cron resources, no wildcard, public route unchanged, production table/bucket retention unchanged.
- **GOTCHA**: Do not deploy, create credentials, or mutate the shared stage as part of this task without explicit owner authorization.
- **VALIDATE**: `npx vitest run --project node infra/file-management.test.ts infra/composition.test.ts infra/config/file-management.test.ts`
- **SATISFIES**: AC4, AC5, AC6, AC8.

### 10. CREATE `tests/integration/file-trash-lifecycle.test.ts` and UPDATE affected repository fakes

- **IMPLEMENT**: Assemble real file/download/lifecycle/usage services around deterministic in-memory repositories/object store; extend all existing `FileRepository` fakes for the new interface.
- **TEST**: Upload-ready fixture -> trash -> both private/public denial -> list/inspect trash/purgeAt -> restore same IDs/key -> download allowed again.
- **TEST**: Scheduled due purge and force deletion both remove the object, close storage once at stable evidence, remove public metadata, and release quota only in the final step.
- **TEST**: Repeated trash/restore/claim/finalize; just-before/at purge time; force confirmation; cross-project attempts; paginated due items; concurrent restore-vs-claim.
- **TEST**: Inject object-delete, objectRemovedAt persistence, usage-close, and final-transaction failures. After each, assert the next retry converges with no double usage, no early quota release, and no restorable/downloadable claimed file.
- **TEST**: Verify trash time is included in storage byte-milliseconds and that no lifecycle path proxies file bytes through Lambda/API Gateway.
- **VALIDATE**: `npx vitest run --project node tests/integration/file-trash-lifecycle.test.ts tests/integration/direct-upload-file-lifecycle.test.ts tests/integration/usage-pricing-ledger.test.ts`
- **SATISFIES**: AC1-AC8.

### 11. RUN full local validation and preview infrastructure safely

- **IMPLEMENT**: Format only intended files, run the full repository gate, inspect the final diff, and verify no secrets/URLs/object keys appear in fixtures or logs.
- **VALIDATE**: `npm run format`
- **VALIDATE**: `npm run check`
- **VALIDATE**: `git diff --check`
- **VALIDATE**: `git status --short`
- **VALIDATE**: `npm run infra:diff -- --stage dev-rus02` only after the wrapper's exact `ntz-cli` identity preflight succeeds; this is a preview, not deployment authorization.
- **GOTCHA**: Never bypass `tooling/run-sst.mjs`, never use another AWS profile/region, and never deploy or mutate `dev-rus02` without explicit owner authorization.
- **SATISFIES**: All acceptance criteria and repository quality gates.

---

## TESTING STRATEGY

### Unit Tests

- **Contracts/model:** every legal state and every corrupt cross-field/index/progress combination; exact force parsing; internal evidence excluded from public DTOs.
- **Repository:** actual SDK command shapes, state/revision/existence conditions, GSI due comparisons/pagination, public key preservation, no quota write on trash/restore, atomic quota release on final removal, and replay after conditional/ambiguous outcomes.
- **Lifecycle service:** injected clock, exact 14-day boundary, state/error mapping, project isolation, same-saga force/schedule convergence, stable removal timestamp, and bounded page processing.
- **Usage seam:** exact `closeStorage` inputs and duplicate result; retain existing byte-time split and conflict coverage.
- **Handlers/runtime/infra:** strict boundary parsing, safe envelopes/errors, correct resource links/actions, route count, schedule, and no wildcard/public exposure.

### Integration Tests

- Assemble the actual domain services with deterministic in-memory adapters rather than mocking the lifecycle service itself.
- Start with a genuinely ready file whose storage checkpoint is active and quota is retained.
- Prove the whole state/cost/quota/download journey across trash, restore, due purge, and force deletion.
- Exercise cross-resource crash windows by failing once at each adapter/repository boundary, then replaying the same operation.
- Keep the existing RUS-05/06 integration suite green so typed `trashed` does not weaken upload completion or public/private access.

### Edge Cases

- Delete a pending or failed file; reject without touching S3, usage, or quota.
- Trash the same file twice; return the same due state without extending retention.
- Restore the same restored ready file twice; no identity/quota/usage change.
- Restore just before `purgeAt`, exactly at it, after it, and after `purgeStartedAt` exists.
- Force a ready file, already-trashed file, already-claimed file, missing file, and another project's file.
- Scheduled claim races restore; exactly one conditional transition wins and no restored object is subsequently deleted.
- S3 delete fails; storage stays active and quota stays retained.
- S3 delete succeeds but recording `objectRemovedAt` fails; retry delete and persist a conservative later observation.
- Storage close fails after object removal; downloads remain blocked, metadata/quota remain, and retry reuses `objectRemovedAt`.
- Final transaction fails after storage close; retry does not emit duplicate usage and releases quota once.
- Due query spans multiple pages, ends exactly on a timestamp, and preserves deterministic sort ordering.
- A late matching upload completion reaches a trashed record; it does not reopen or double-charge it.
- Public file remains addressable in the public GSI while trashed but the route returns 404/no signer; purge removes the mapping.
- Malformed `force` values (`1`, `TRUE`, empty, repeated/ambiguous input) fail validation.
- Object-store versioning is not enabled. If repository infrastructure later enables it, stop: current `DeleteObject` no longer proves permanent byte removal.

---

## VALIDATION COMMANDS

Execute every applicable command and require zero unexpected failures.

### Level 1: Syntax & Style

```powershell
npm run format:check
npm run lint
npm run typecheck
git diff --check
```

### Level 2: Focused Unit Tests

```powershell
npx vitest run --project node packages/contracts/src/files/contract.test.ts
npx vitest run --project node packages/backend/src/modules/file-management/model.test.ts packages/backend/src/modules/file-management/repository.test.ts
npx vitest run --project node packages/backend/src/modules/file-management/lifecycle.test.ts packages/backend/src/modules/file-management/handlers.test.ts packages/backend/src/modules/file-management/runtime.test.ts
npx vitest run --project node packages/backend/src/modules/file-management/downloads.test.ts packages/backend/src/modules/file-management/completion.test.ts packages/backend/src/modules/usage-pricing/service.test.ts
npx vitest run --project node infra/config/file-management.test.ts infra/file-management.test.ts infra/composition.test.ts
```

### Level 3: Integration and Full Regression

```powershell
npx vitest run --project node tests/integration/file-trash-lifecycle.test.ts tests/integration/direct-upload-file-lifecycle.test.ts tests/integration/usage-pricing-ledger.test.ts
npm test
npm run test:coverage
npm run build
npm run check
```

Coverage must remain at or above the configured 80% statements/branches/functions/lines across the repository.

### Level 4: Manual Validation

Local contract/service validation requires no AWS mutation:

1. Use deterministic fixtures to create a ready private and ready public file with an active storage checkpoint and retained quota.
2. Trash each; confirm metadata exposes `trashed`/`purgeAt`, both download paths return the safe not-found envelope, and quota/storage remain active.
3. Restore; confirm identical file/public/project/object identities and fresh download authorization.
4. Force delete; confirm the exact-key object adapter ran, storage closed at persisted removal evidence, metadata disappeared, and quota released.
5. Advance the clock past `purgeAt`; invoke the worker and confirm the same permanent-removal behavior.
6. Repeat/inject failures and inspect structured logs for operation phase without sensitive values.

For an owner-authorized non-production AWS exercise only:

1. Run `npm run infra:diff -- --stage dev-rus02` through the repository wrapper and confirm the exact account/principal/region preflight.
2. Review that the existing File table/index/bucket are reused and only two routes, one scheduled function, and least-privilege permissions are added.
3. After separate deployment authorization, use disposable files and never print/store project keys or presigned URLs.
4. Verify trash immediately denies private/public downloads, restore preserves IDs, force physically deletes, and scheduled due purge converges.
5. Do not remove `dev-rus02` as routine cleanup.

### Level 5: Codex-Layer Validation

No Codex-layer files are changed by implementation. If instructions/skills/hooks/config are changed incidentally, stop and run:

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC1 — Recoverable trash:** Normal authenticated delete idempotently changes only a ready file to `trashed`, sets stable `trashedAt`/`purgeAt` exactly 14 days apart, and both private/public downloads fail immediately without signing.
- [ ] **AC2 — Retained accounting:** Trash/restore preserve the exact S3 key and all project/file/public identities; retained/accounted quota and the active storage checkpoint remain unchanged throughout trash.
- [ ] **AC3 — Safe restore:** Restore before the deadline returns the same file identity in `ready`; at/after the deadline or after a permanent-removal claim it fails safely, and it cannot win a race that later deletes a restored object.
- [ ] **AC4 — Scheduled purge:** A dedicated EventBridge/SST scheduled worker queries the existing lifecycle GSI by due time with bounded pagination and permanently removes due objects through the shared saga.
- [ ] **AC5 — Explicit force:** `DELETE /v1/files/{fileId}?force=true` is the only immediate permanent-delete confirmation and invokes the same permanent-removal operation as scheduled purge.
- [ ] **AC6 — Cross-resource idempotency:** S3 delete, removal evidence, storage closure, and final metadata/quota transaction can each fail/retry without reopened access, duplicate storage closure, corrupt state, or double quota release.
- [ ] **AC7 — Purged state/evidence:** After successful permanent removal the active File/public-index row is absent and cannot be restored; the closed usage checkpoint/ledger remains according to usage retention policy, with no indefinite active file tombstone.
- [ ] **AC8 — Security and regression proof:** Tests cover legal/illegal transitions, repeated calls/deliveries, purge timing/pagination, strict force confirmation, partial failures, quota release only after physical removal, exact-key behavior, and cross-project denial.
- [ ] Existing RUS-05 upload completion and RUS-06 private/public download suites pass without weakening project isolation or secret/AWS-internal redaction.
- [ ] All focused validation, full coverage, type, lint, format, build, and diff checks pass.
- [ ] Infrastructure preview shows only intended resources/actions; no AWS mutation occurs without explicit owner authorization.

---

## COMPLETION CHECKLIST

- [ ] Issue #7 workflow metadata changed from stale `queued` to the appropriate active/ready state before implementation.
- [ ] All tasks completed in order.
- [ ] Each task validation passed immediately.
- [ ] Public schemas and persisted state invariants agree.
- [ ] Trash/restore do not touch quota, usage, object bytes, or identities.
- [ ] Scheduled purge and force call the same permanent-removal saga.
- [ ] Restore-vs-purge race is conditionally safe.
- [ ] `objectRemovedAt` is persisted after S3 success and reused for every storage-close retry.
- [ ] Quota releases only in the final metadata transaction.
- [ ] Public/private downloads fail closed for trash and claimed removal.
- [ ] Full tests and 80% coverage pass.
- [ ] No secret, object key, bucket name, internal project ID, AWS detail, or full presigned URL appears in public output/logs/fixtures.
- [ ] Infrastructure diff reviewed; deployment, if any, separately authorized.
- [ ] Code reviewed for release-blocking cross-project deletion and irreversible unintended deletion.

---

## OPEN QUESTIONS / ASSUMPTIONS

1. **Workflow metadata (non-code):** Issue #7 is still `queued` although RUS-05 is closed. The owner's explicit `$piv-plan-implementation` request authorized this planning pass, but the issue should be moved to `ready`/active before `$piv-implement` so the tracker remains truthful.
2. **REST route/response assumption:** This plan proposes the architecture-implied `DELETE /v1/files/{fileId}?force=true` and `POST /v1/files/{fileId}/restore`, with JSON envelope results rather than 204 responses because the shared boundary is JSON/schema-based and callers need disposition/`purgeAt`. If the owner wants different public routes or 204 semantics, amend the plan before implementation; do not improvise during execution.
3. **Restore idempotency assumption:** Restore of an already-ready exact-project file is a no-op so repeated restore calls are effect-idempotent. Pending/failed/missing/wrong-project files remain errors.
4. **Removal timestamp policy:** S3 and DynamoDB cannot atomically record the physical deletion instant. This plan deliberately records the first successfully persisted post-delete observation. A crash after S3 success but before persistence can conservatively overcount storage until retry; it never releases quota or stops cost before confirmed deletion. This is an implementation inference from the approved physical-removal boundary, not a claim of cross-service atomic time.
5. **No tombstone assumption:** Successful purge removes active File metadata. HTTP retries after full success receive project-scoped 404, while side effects remain idempotent. Closed usage evidence provides the required retention record. If product policy later requires audit tombstones or stable repeated-delete responses, that needs an explicit retention/security design outside this ticket.
6. **Schedule assumption:** A separate five-minute `sst.aws.Cron` mirrors the established reconciliation cadence. RUS-10 can later add alarms/DLQ/retry observability without changing lifecycle semantics.
7. **Bucket versioning assumption:** The existing stage bucket remains unversioned. Enabling S3 versioning would make an ordinary `DeleteObject` create a delete marker rather than prove physical byte removal and must block implementation until version-aware deletion is designed.

No unresolved question blocks local implementation if these explicit ticket-level assumptions are accepted during plan review.

## NOTES (open canvas)

### Why `purgeStartedAt` and `objectRemovedAt` are separate

One timestamp cannot safely serve both concurrency and accounting. A pre-delete claim timestamp is needed to make restore lose deterministically, but using it as storage close time would undercharge whenever S3 deletion is delayed or fails. A post-delete observation is the earliest durable evidence the usage service can safely consume. Keeping both makes the unavoidable cross-service gap explicit and retryable.

### Why the lifecycle GSI remains sparse

Pending uploads and trashed files are mutually exclusive state classes. Both need a constant partition plus time-ordered sort key, so the existing `gsi2pk/gsi2sk` and `FileLifecycle` index support both access patterns without schema expansion:

```text
UPLOAD#PENDING        | failureEligibleAt#projectId#fileId
TRASH#PENDING_PURGE   | purgeAt#projectId#fileId
```

Ready/failed files have no lifecycle GSI entry. Claimed trash keeps its entry until final removal so a crashed API or worker remains discoverable.

### Why quota finalization comes after usage closure

S3 deletion proves the bytes are gone. Storage closure records the terminal byte-time evidence. Only after both succeed may quota be released and the active file row disappear. Reversing the last two steps could make a transient usage failure invisible because the worker would lose the size/file evidence needed to retry.

### Confidence Score

**9/10** for one-pass implementation. The current repository already contains every critical seam: strict state parsing, a reusable lifecycle GSI, atomic quota transactions, exact-key idempotent object deletion, strict storage-close idempotency, ready-only downloads, scheduled reconciliation, and failure-injection test patterns. The remaining uncertainty is the unavoidable observational gap between S3 deletion and persisted removal time; this plan makes the policy explicit and testable.

## AMENDMENTS

_None at creation._
