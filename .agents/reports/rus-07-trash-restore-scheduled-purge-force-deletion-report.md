# Implementation Report - RUS-07 Trash, Restore, Scheduled Purge, and Force Deletion

**Plan**: `.agents/plans/rus-07-trash-restore-scheduled-purge-force-deletion.md`
**Branch**: `feature/rus-07-trash-restore-scheduled-purge-force-deletion`
**Status**: IMPLEMENTATION AND REVIEW FIXES COMPLETE; DEPLOYED ACCEPTANCE PENDING

## Summary

Implemented the recoverable and permanent file-deletion lifecycle. Authenticated projects can trash ready files for exactly 14 days, restore unexpired and unclaimed trash without changing identity or object location, or explicitly force permanent removal. A dedicated bounded scheduled worker processes due trash through the same retryable saga used by force deletion.

Permanent removal now persists a claim before deleting the exact server-derived S3 key, records physical-removal evidence, closes the RUS-04 storage checkpoint at that stable evidence timestamp, and only then atomically removes active metadata and releases retained/accounted quota. Force deletion revokes access immediately but defers physical removal until the original upload capability has expired plus a five-minute clock-skew allowance, preventing an old presigned PUT from recreating an orphan. Trashed and claimed files remain inaccessible to both private and stable-public download paths, and public lookups make a strongly consistent primary-table authorization read after locating the file through the eventually consistent public index.

## Tasks completed

- Added strict public contracts for `trashed` files, lifecycle timestamps, exact `force=true|false` parsing, delete results, response envelopes, and exports.
- Extended the persisted File model with a distinct purge GSI partition, exact due sort keys, 14-day retention, removal progress evidence, and cross-field/timestamp invariants.
- Added conditional DynamoDB operations for trash, restore, force/scheduled claims, physical-removal evidence, final metadata/quota removal, and bounded due-purge queries.
- Made public-file lookup fail closed during GSI propagation by treating the public index as a locator and authorizing only from a strongly consistent primary-table record.
- Added one lifecycle service for normal trash, restore, force deletion, and scheduled purge, with safe project-scoped errors and resumable cross-resource ordering.
- Added truthful `purge-pending` force-delete responses and deferred byte removal through `uploadExpiresAt` plus a bounded five-minute skew allowance while retaining immediate access revocation.
- Kept matching late upload-completion notifications against typed trash as no-ops while preserving conflicting-evidence rejection.
- Added authenticated delete/restore handlers, thin Lambda entry points, lazy runtime composition, worker caching, and a dedicated purge entry point.
- Added lifecycle routes and a separate five-minute SST Cron with route-specific links and non-wildcard DynamoDB/S3/usage actions. Restore receives no S3 or usage link.
- Added unit and assembled integration coverage for identity preservation, download denial/restoration, quota retention/release, byte-time through trash, timing boundaries, pagination, project isolation, and every permanent-removal failure window.

## Validation results

- Syntax/style: `npm run format:check`, `npm run lint`, `npm run typecheck`, and `git diff --check` all PASS.
- Focused review-fix suite: 10 files / 104 tests PASS.
- Fresh-eyes re-review suite: 9 files / 83 tests PASS.
- Full test suite: 71 files / 457 tests PASS.
- Coverage: 86.39% statements, 80.82% branches, 92.57% functions, 89.04% lines; all configured 80% thresholds PASS.
- `npm run build`: PASS.
- `npm run check`: PASS after both review fixes.
- Fresh code-reviewer re-review: PASS with no Critical, High, or Medium findings.
- `npm run infra:diff -- --stage dev-rus02`: pending after the prior unrelated SST executable lock cleared; no deployment or AWS mutation has occurred yet.

## Acceptance criteria evidence

- **AC1 / Recoverable trash**: normal delete produces a stable 14-day deadline, preserves the object, and immediately denies both download paths without invoking a presigner.
- **AC2 / Retained accounting**: trash and restore make no quota, usage, or object-store write; assembled tests keep retained bytes and storage byte-time active through trash.
- **AC3 / Safe restore**: repository conditions require unexpired, unclaimed trash and preserve file/public/project/object identity; deadline and claim conflicts fail safely.
- **AC4 / Scheduled purge**: the dedicated purge worker queries the existing lifecycle GSI by due time with bounded pagination and uses the shared removal saga.
- **AC5 / Explicit force**: only the strict `force=true` query selects permanent deletion; malformed and implicit truthy values fail validation. Force claims and denies access immediately, returns `purge-pending` while an issued upload capability could still be valid, and removes bytes only after that capability's expiry plus bounded skew.
- **AC6 / Cross-resource idempotency**: tests inject object-delete, removal-evidence, usage-close, and final-transaction failures and prove retry convergence, stable close evidence, no early quota release, and idempotent finalization.
- **AC7 / Purged state/evidence**: successful finalization deletes the active/public-index File row and releases retained/accounted quota only after object removal and storage closure; no `purged` File state is persisted.
- **AC8 / Security and regression proof**: project isolation, typed corrupt-state rejection, strongly consistent ready-only public authorization, old-upload-capability replay resistance, exact server-derived object keys, internal-evidence exclusion, safe errors, and non-wildcard permissions are covered.

## Deviations and issues encountered

GitHub issue #7 remained in its existing queued tracker state; the user's explicit `$piv-implement` command was treated as authorization to implement the already-approved plan, not as authorization to mutate tracker labels or status.

The plan described force deletion as immediate physical removal. Review identified that deleting the fixed object key before an already-issued presigned PUT expired would allow that capability to recreate untracked bytes. With owner approval, force deletion now means immediate access revocation and an immediate irreversible purge claim, while physical removal is scheduled for the later of the request time or `uploadExpiresAt` plus five minutes. This preserves the approved security and accounting intent without changing to temporary upload keys.

The public GSI remains an eventually consistent lookup mechanism, but it is no longer an authorization source. The primary record is read strongly consistently and revalidated before any public download URL can be minted.

An earlier infrastructure preview could not complete because another workspace's active SST process locked SST's shared Pulumi language executable. That process has since exited. The required fresh preview, deployment, and deployed acceptance remain the final release gate.

No dashboard UI was added, no file bytes pass through Lambda/API Gateway, no S3 lifecycle rule or DynamoDB TTL was introduced, and no AWS resources were changed.
