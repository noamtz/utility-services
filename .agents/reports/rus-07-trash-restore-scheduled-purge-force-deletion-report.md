# Implementation Report - RUS-07 Trash, Restore, Scheduled Purge, and Force Deletion

**Plan**: `.agents/plans/rus-07-trash-restore-scheduled-purge-force-deletion.md`
**Branch**: `feature/rus-07-trash-restore-scheduled-purge-force-deletion`
**Status**: IMPLEMENTATION COMPLETE; INFRASTRUCTURE PREVIEW BLOCKED BY AN UNRELATED ACTIVE SST PROCESS

## Summary

Implemented the recoverable and permanent file-deletion lifecycle. Authenticated projects can trash ready files for exactly 14 days, restore unexpired and unclaimed trash without changing identity or object location, or explicitly force permanent removal. A dedicated bounded scheduled worker processes due trash through the same retryable saga used by force deletion.

Permanent removal now persists a claim before deleting the exact server-derived S3 key, records physical-removal evidence, closes the RUS-04 storage checkpoint at that stable evidence timestamp, and only then atomically removes active metadata and releases retained/accounted quota. Trashed and claimed files remain inaccessible to both private and stable-public download paths.

## Tasks completed

- Added strict public contracts for `trashed` files, lifecycle timestamps, exact `force=true|false` parsing, delete results, response envelopes, and exports.
- Extended the persisted File model with a distinct purge GSI partition, exact due sort keys, 14-day retention, removal progress evidence, and cross-field/timestamp invariants.
- Added conditional DynamoDB operations for trash, restore, force/scheduled claims, physical-removal evidence, final metadata/quota removal, and bounded due-purge queries.
- Added one lifecycle service for normal trash, restore, force deletion, and scheduled purge, with safe project-scoped errors and resumable cross-resource ordering.
- Kept matching late upload-completion notifications against typed trash as no-ops while preserving conflicting-evidence rejection.
- Added authenticated delete/restore handlers, thin Lambda entry points, lazy runtime composition, worker caching, and a dedicated purge entry point.
- Added lifecycle routes and a separate five-minute SST Cron with route-specific links and non-wildcard DynamoDB/S3/usage actions. Restore receives no S3 or usage link.
- Added unit and assembled integration coverage for identity preservation, download denial/restoration, quota retention/release, byte-time through trash, timing boundaries, pagination, project isolation, and every permanent-removal failure window.

## Validation results

- Syntax/style: `npm run format:check`, `npm run lint`, `npm run typecheck`, and `git diff --check` all PASS.
- Focused contract/model/repository/lifecycle/handler/runtime/download/completion/usage/infrastructure suites: 115 tests PASS.
- Focused lifecycle integration suite: 3 files / 8 tests PASS.
- Full test suite: 71 files / 453 tests PASS.
- Coverage: 86.30% statements, 80.60% branches, 92.57% functions, 88.96% lines; all configured 80% thresholds PASS.
- `npm run build`: PASS.
- `npm run check`: PASS after the final contract/model consistency correction.
- `npm run infra:diff -- --stage dev-rus02`: BLOCKED before a preview was produced. The required repository wrapper reached SST, but SST could not replace `C:\Users\ntzur\AppData\Roaming\sst\bin\pulumi-language-nodejs.exe` because an unrelated active SST session from `C:\Users\ntzur\workspace-vscode\cpa-platform` holds the executable open. The process was not interrupted. No deployment or AWS mutation was attempted.

## Acceptance criteria evidence

- **AC1 / Recoverable trash**: normal delete produces a stable 14-day deadline, preserves the object, and immediately denies both download paths without invoking a presigner.
- **AC2 / Retained accounting**: trash and restore make no quota, usage, or object-store write; assembled tests keep retained bytes and storage byte-time active through trash.
- **AC3 / Safe restore**: repository conditions require unexpired, unclaimed trash and preserve file/public/project/object identity; deadline and claim conflicts fail safely.
- **AC4 / Scheduled purge**: the dedicated purge worker queries the existing lifecycle GSI by due time with bounded pagination and uses the shared removal saga.
- **AC5 / Explicit force**: only the strict `force=true` query selects immediate permanent deletion; malformed and implicit truthy values fail validation.
- **AC6 / Cross-resource idempotency**: tests inject object-delete, removal-evidence, usage-close, and final-transaction failures and prove retry convergence, stable close evidence, no early quota release, and idempotent finalization.
- **AC7 / Purged state/evidence**: successful finalization deletes the active/public-index File row and releases retained/accounted quota only after object removal and storage closure; no `purged` File state is persisted.
- **AC8 / Security and regression proof**: project isolation, typed corrupt-state rejection, ready-only download authorization, exact server-derived object keys, internal-evidence exclusion, safe errors, and non-wildcard permissions are covered.

## Deviations and issues encountered

GitHub issue #7 remained in its existing queued tracker state; the user's explicit `$piv-implement` command was treated as authorization to implement the already-approved plan, not as authorization to mutate tracker labels or status.

The public File contract permits `purgeAt === trashedAt` for a force-claimed record. Normal trash still uses exactly 14 days, while equality is required so a failed in-flight force deletion remains safely observable as typed trash rather than causing response-schema failure. Persisted claimed state additionally requires `purgeStartedAt >= purgeAt`.

The plan's infrastructure preview could not complete because another workspace's active SST process locks SST's shared Pulumi language executable. No attempt was made to terminate that unrelated process, bypass the repository wrapper, or deploy. Retry the same preview command after that SST session exits.

No dashboard UI was added, no file bytes pass through Lambda/API Gateway, no S3 lifecycle rule or DynamoDB TTL was introduced, and no AWS resources were changed.
