# Implementation Report - RUS-07 Trash, Restore, Scheduled Purge, and Force Deletion

**Plan**: `.agents/plans/rus-07-trash-restore-scheduled-purge-force-deletion.md`
**Branch**: `feature/rus-07-trash-restore-scheduled-purge-force-deletion`
**Status**: COMPLETE, REVIEWED, AND DEPLOYED TO `dev-rus02`

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
- Made transfer resources lazy so metadata-only and restore Lambdas do not read unlinked S3 or usage resources during initialization, preserving route-level least privilege in the deployed runtime.
- Added the exact `dynamodb:DeleteItem` permission required by transactional permanent-finalization deletes to both force-delete and scheduled-worker roles.
- Added unit and assembled integration coverage for identity preservation, download denial/restoration, quota retention/release, byte-time through trash, timing boundaries, pagination, project isolation, and every permanent-removal failure window.

## Validation results

- Syntax/style: `npm run format:check`, `npm run lint`, `npm run typecheck`, and `git diff --check` all PASS.
- Focused review-fix suite: 10 files / 104 tests PASS.
- Fresh-eyes re-review suite: 9 files / 83 tests PASS.
- Full test suite: 71 files / 457 tests PASS.
- Coverage: 86.09% statements, 80.82% branches, 92.03% functions, 88.71% lines; all configured 80% thresholds PASS.
- `npm run build`: PASS.
- `npm run check`: PASS after both review fixes.
- Fresh code-reviewer re-review: PASS with no Critical, High, or Medium findings.
- Fresh `npm run infra:diff -- --stage dev-rus02` previews: PASS through the required wrapper and exact AWS identity preflight. No file/control/usage table, bucket, Cognito, or API replacement was proposed; the final IAM-only preview contained exactly two in-place role updates.
- `npm run infra:deploy -- --stage dev-rus02`: PASS through the required wrapper.
- Deployed lifecycle acceptance: PASS for upload completion, ready private/public access, normal trash, immediate private/public denial, restore with stable identities, force-delete `purge-pending`, real replay of the original presigned PUT returning S3 `412`, retained-object evidence before eligibility, scheduled purge retry convergence, and zero due lifecycle records afterward.
- Fixture cleanup audit: PASS with zero disposable Cognito owners and zero active acceptance API-key records. The shared stage remains deployed for approved reuse.

## Acceptance criteria evidence

- **AC1 / Recoverable trash**: normal delete produces a stable 14-day deadline, preserves the object, and immediately denies both download paths without invoking a presigner.
- **AC2 / Retained accounting**: trash and restore make no quota, usage, or object-store write; assembled tests keep retained bytes and storage byte-time active through trash.
- **AC3 / Safe restore**: repository conditions require unexpired, unclaimed trash and preserve file/public/project/object identity; deadline and claim conflicts fail safely.
- **AC4 / Scheduled purge**: the dedicated purge worker queries the existing lifecycle GSI by due time with bounded pagination and uses the shared removal saga.
- **AC5 / Explicit force**: only the strict `force=true` query selects permanent deletion; malformed and implicit truthy values fail validation. Force claims and denies access immediately, returns `purge-pending` while an issued upload capability could still be valid, and removes bytes only after that capability's expiry plus bounded skew.
- **AC6 / Cross-resource idempotency**: tests inject object-delete, removal-evidence, usage-close, and final-transaction failures and prove retry convergence, stable close evidence, no early quota release, and idempotent finalization.
- **AC7 / Purged state/evidence**: successful finalization deletes the active/public-index File row and releases retained/accounted quota only after object removal and storage closure; no `purged` File state is persisted.
- **AC8 / Security and regression proof**: project isolation, typed corrupt-state rejection, strongly consistent ready-only public authorization, old-upload-capability replay resistance, exact server-derived object keys, internal-evidence exclusion, safe errors, and non-wildcard permissions are covered.

The deployed acceptance exercised AC1, AC3, AC4, AC5, AC6, AC7, and the transfer-capability portions of AC8 against real API Gateway, Lambda, DynamoDB, and S3 resources. AC2's quota and storage ordering is covered by assembled integration and injected-failure tests; the live IAM failure additionally demonstrated that finalization stops without releasing metadata/quota and succeeds on retry after the role correction.

## Deviations and issues encountered

GitHub issue #7 remained in its existing queued tracker state; the user's explicit `$piv-implement` command was treated as authorization to implement the already-approved plan, not as authorization to mutate tracker labels or status.

The plan described force deletion as immediate physical removal. Review identified that deleting the fixed object key before an already-issued presigned PUT expired would allow that capability to recreate untracked bytes. With owner approval, force deletion now means immediate access revocation and an immediate irreversible purge claim, while physical removal is scheduled for the later of the request time or `uploadExpiresAt` plus five minutes. This preserves the approved security and accounting intent without changing to temporary upload keys.

The public GSI remains an eventually consistent lookup mechanism, but it is no longer an authorization source. The primary record is read strongly consistently and revalidated before any public download URL can be minted.

An earlier infrastructure preview could not complete because another workspace's active SST process locked SST's shared Pulumi language executable. That process exited; all required fresh previews and deployments then completed through the repository wrapper.

The first deployed run exposed eager `FileBucket` resolution in metadata-only Lambdas. Runtime composition now injects lazy transfer presigners, and a regression test proves handler composition does not read unlinked bucket or usage resources. The full local gate and redeployment passed afterward.

The deployed purge run then exposed a missing `dynamodb:DeleteItem` action for the transactional file-row delete. The saga had already persisted physical-removal evidence and closed storage, but correctly retained metadata/quota when finalization was denied. The exact action was added to the delete-route and worker roles, policy simulation returned `allowed`, and the next scheduled invocation converged all due records after IAM propagation.

No dashboard UI was added, no file bytes pass through Lambda/API Gateway, and no S3 lifecycle rule or DynamoDB TTL was introduced. The reusable `dev-rus02` stage was updated and intentionally retained.
