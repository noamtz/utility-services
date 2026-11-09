# WCU-03 — Configurable File Management policy per project

## Metadata

- **Issue:** [#29](https://github.com/noamtz/utility-services/issues/29) — WCU-03: Configure File Management quota and trash duration per project
- **Status at planning:** ready. The issue is open and has no native `blockedBy` relationship; it blocks #30 and #32.
- **Scope owner:** File Management and identity/control integration. This plan creates no AWS resources and makes no deployment.
- **Related work:** WCU-02 / #27 is independent regional-instance planning. #30 consumes these settings for optional deletion protection; it must not be folded into this ticket.
- **Sources:** [WhatsApp Communication Utility PRD](https://github.com/noamtz/utility-services/wiki/WhatsApp-Communication-Utility-PRD), [architecture](https://github.com/noamtz/utility-services/wiki/WhatsApp-Communication-Utility-Architecture), and the ticket breakdown linked from #29.

## Outcome

An owner can create a project with, inspect, and subsequently update a File Management policy containing:

- retained-storage quota (default **5 GiB**), and
- trash retention period (default **14 days**).

The policy is part of the trusted project context used by server-side API-key authentication. New upload reservations enforce that project’s quota against `accountedBytes` (pending reservations + retained bytes, including trash). A normal delete snapshots the effective retention on the file and records `purgeAt` once; changing the project policy never moves existing files’ purge deadline. Restore, force delete, scheduled purge, storage metering, and cross-project isolation retain their existing behavior.

## User story and problem

As a project owner, I need to configure a generous enough storage and trash policy for my app so the shared File Management project can hold both ordinary application files and WhatsApp-derived media without a second file store. As the platform, we must reject a lower quota that is already consumed and must never silently extend or shorten a file’s promised trash window after it has been deleted.

The current system exposes only URL-lifetime settings. It hard-codes `FILE_STORAGE_QUOTA_BYTES` and `TRASH_RETENTION_MILLISECONDS` in File Management, even though the trusted project context already carries `fileManagement` settings. The control record and quota record live in separate DynamoDB tables, so a safe policy reduction needs an atomic, cross-table conditional transaction rather than a read-then-write check.

## Explicitly out of scope

- Deletion protection, any default protection decision, and protected-file deletion behavior (#30).
- WhatsApp/Green API ingestion, retention rules chosen for CPA, and per-message classification (#31 onward).
- Changing the 100 MB per-file limit, transfer URL lifetime behavior, usage-price calculation, bucket lifecycle configuration, or a file’s public/private visibility.
- Automatic migration/backfill of every historical file or project. Compatibility must be read-time / write-forward unless a later operational migration is separately approved.
- Billing tiers or project sharing/roles.

## Preconditions and owner decisions

The PRD and architecture deliberately preserve 5 GiB / 14 days as defaults but do **not** approve the allowable range. Before implementation, the owner must choose and document these API-contract and cost bounds:

1. `storageQuotaBytes` minimum and maximum (and whether a quota may exceed a stage/account operating guardrail). A high maximum is a direct retained-S3-cost commitment.
2. `trashRetentionDays` minimum and maximum. Longer values retain bytes and cost; a zero-day option would materially change the restore promise and should be an explicit decision, not an accidental schema minimum.
3. Whether the dashboard should allow policy changes immediately, as this plan assumes, or only an operator-controlled endpoint. Issue acceptance says settings can change and quota lowering must be safe, so the default plan is an owner-only dashboard + `PATCH` operation.

Use named, exported contract constants for the approved limits; do not encode CPA-specific values or arbitrary UI-only limits. Defaults remain backward compatible: `5 * 2 ** 30` bytes and `14` whole days. Document bounds in integration copy once selected.

## Current implementation map

| Concern | Existing path and pattern | Planned extension |
| --- | --- | --- |
| Public settings contract | `packages/contracts/src/projects/contract.ts:5-36,70-84` | Add defaults and validated quota/retention fields plus a strict update request/response schema. |
| Trusted project context | `packages/contracts/src/auth/project-context.ts:10-18` | Inherits the expanded settings automatically; retain strict parsing. |
| Project utility persistence | `packages/backend/src/modules/identity-control/projects/model.ts:50-61,110-148` | Persist both fields on `UTILITY#file-management`; tolerate pre-WCU-03 records by applying contract defaults while reading. |
| Owner control path | `projects/{handlers,service,repository,runtime}.ts`; routes in `infra/config/control.ts:34-77` | Add authenticated owner-only policy update and a function entry point/route. |
| Quota reservation | `file-management/service.ts:65-107`; transaction in `repository.ts:285-333` | Use `project.fileManagement.storageQuotaBytes`, never a module-global quota. |
| Trash lifecycle | `lifecycle.ts:90-130`; file invariants `model.ts:222-252`; write `repository.ts:622-665` | Snapshot retention when trashed and preserve stored `purgeAt` through config changes/retries. |
| Dashboard | `apps/dashboard/src/projects/{api,CreateProjectForm,ProjectDetails,ProjectView}.tsx` | Create/show/edit safe policy values with client-side schema validation and a clear warning about quota/trash cost. |

## Design decisions to implement

### Contract and data shape

1. Extend `FileManagementSettingsSchema` with `storageQuotaBytes` and `trashRetentionDays`; represent quota in bytes as a safe positive integer that can convert losslessly to `bigint`, and retention as a whole-day integer. Keep `strict()` and defaults so an existing create request that supplies only URL lifetimes remains valid.
2. Add a strict `UpdateFileManagementPolicyRequestSchema` containing only mutable policy fields. Do not use the creation request or accept project identity, owner identity, URL lifetimes, or unknown fields in PATCH. Return the normal `ProjectSchema` envelope after update.
3. Extend `EnabledUtilityItemSchema`, `toEnabledUtilityItem`, and `assembleProject` with the two fields. For stored records created before #29, parse a legacy shape that lacks the new attributes and feed `{}` through `FileManagementSettingsSchema` defaults before assembling. New writes always materialize the defaults. This avoids treating healthy old projects as corrupt.
4. Add an optional, immutable `trashRetentionDaysAtDeletion` (or equivalently named retention snapshot) to the file item. New normal deletes set it; files already in trash without it are interpreted as the historical 14-day default. `parseFileItem` must validate `purgeAt - trashedAt` against that snapshot only when no purge has started. It must no longer compare every trashed item to a mutable global policy.
5. Remove the generic runtime `quotaLimitBytes` override and `FILE_STORAGE_QUOTA_BYTES` enforcement seam from production service behavior. Test fixtures may retain an explicit injected project context. `MAX_FILE_SIZE_BYTES` remains independent.

### Safe owner update

1. Add `PATCH /v1/control/projects/{projectId}/file-management-policy` (or the exact documented singular route selected during implementation) rather than overload `POST` creation. It takes the public project ID only in the path and derives owner identity from the verified Cognito context.
2. The service first resolves the project by public ID and verifies its owner, returning the existing indistinguishable `NOT_FOUND` response for a missing or foreign project.
3. Add a monotonically increasing `fileManagementPolicyVersion` to the enabled-utility record, `InternalProject`, and `TrustedProjectContext` (as a sibling to `fileManagement`, **not** a public `FileManagementSettingsSchema` field). Creation starts at `1`; every policy update increments it. It is an internal concurrency value, not a dashboard-editable setting, public project response field, or a value accepted from API callers.
4. The repository performs one `TransactWriteItems` across ControlTable and FileTable:
   - `ConditionCheck` the FileTable `PROJECT#{internalProjectId} / QUOTA` record such that it is absent (zero usage) or is a valid `file-quota` record for that internal project with `accountedBytes <= :newQuota`.
   - `Update` the ControlTable `UTILITY#file-management` record only when its project/utility identity is correct, atomically setting the approved fields, incrementing `fileManagementPolicyVersion`, and setting `updatedAt`.
   - Return a domain conflict mapped to a safe `409 STORAGE_QUOTA_BELOW_ACCOUNTED` when the quota condition fails; do not expose byte counts unless the public contract is explicitly extended to do so.
5. Give only this Lambda link access to both tables and grant the minimal `dynamodb:TransactWriteItems` action against both table ARNs. The current generic control-loop in `infra/api.ts:62-84` only links ControlTable; extend its route description deliberately (for example a `linkedTables` / per-table-action structure) rather than granting broad permissions to all control routes. Update infrastructure route and composition tests.
6. Do not condition the update on a stale client-provided revision unless the API deliberately exposes an optimistic concurrency token. The transaction’s quota condition closes the safety race with a *fresh* reservation; the policy version condition below closes the stale-authentication race. Concurrent policy writes can remain last-successful-write-wins unless the owner selects a revision contract.

### File behavior

1. At upload authorization, use the authenticated `TrustedProjectContext.fileManagement.storageQuotaBytes` and `fileManagementPolicyVersion`, but treat both as a **candidate** rather than authority. Extend `FileRepository.reservePending` and its existing `TransactWriteItems` at `repository.ts:285-333` with a `ConditionCheck` against the ControlTable `UTILITY#file-management` item: correct project/utility identity, current `fileManagementPolicyVersion = :authenticatedVersion`, and `storageQuotaBytes = :authenticatedQuota`. Keep the FileTable quota update and pending-file put in the same transaction. A request authenticated before a policy reduction therefore cannot reserve with its stale higher limit: its transaction cancels, the handler returns a retryable safe conflict such as `409 PROJECT_POLICY_CHANGED`, and the caller must retry with a freshly authenticated context.
2. Give every upload-authorize Lambda that already links ControlTable/FileTable (`infra/config/file-management.ts:55-63`) `dynamodb:TransactWriteItems` against **both** table ARNs. Its current FileTable-only transaction permission is insufficient for the new ControlTable condition check; update SST route-link plumbing and infrastructure tests to assert this least-privilege grant.
3. Define normal deletion as request-time policy semantics: a request authenticated before a retention-policy update may complete using the trusted retention it authenticated under, because its successful state transition persists an immutable `purgeAt` and deletion-time snapshot. The delete service must never re-read current policy or recalculate an existing deadline. Record the authenticated policy version with the snapshot for auditability. If stricter current-at-write retention is later required, add the same ControlTable condition check to the trash transaction as a separately approved contract change.
4. The repository persists deadline, retention snapshot, and policy-version snapshot in the same conditional update that changes status/GSI. A repeated delete returns the stored `purgeAt` and never recalculates it. Restore removes these snapshots with its existing lifecycle attributes. Force deletion keeps its current earliest-safe-removal timing based on presigned-upload expiry; it must not use configurable retention. Scheduled purge queries stored GSI deadlines only.
5. Ensure all test factories and secondary consumers construct complete settings (or use contract defaults); project authentication must continue carrying settings from its DynamoDB snapshot, never from a client request.

## Ordered implementation plan

### Phase 1 — contracts and compatibility

1. In `packages/contracts/src/projects/contract.ts`, introduce exported defaults and the owner-approved range constants. Extend the settings schema and add PATCH request/response types; export them through `packages/contracts/src/index.ts`.
2. Update `contract.test.ts` and `auth/project-context.test.ts` for default expansion, each lower/upper boundary, fractional/unsafe quota values, negative/zero retention according to final bounds, strict unknown-key rejection, and legacy creation requests receiving defaults.
3. Update all typed fixture helpers across backend/dashboard to include defaults via a shared test factory where practical. Do not loosen TypeScript types or cast incomplete policies.

### Phase 2 — durable project policy and owner API

1. In `projects/model.ts`, add the persisted attributes and internal policy version, plus a compatibility parser for missing attributes. Legacy utility records resolve to defaults and version `1`; strict validation remains for newly malformed records. Test old items assemble correctly and new utility items round-trip all settings/version fields.
2. Add a FileTable-aware policy update method to `projects/repository.ts` (or a tightly scoped policy repository beside it). Validate path/project identity, increment the policy version, and construct the cross-table transaction described above. Map cancellation reasons deterministically: quota condition -> quota-below-accounted conflict, utility/project condition -> state/corruption conflict, unknown failures -> propagate to the handler boundary.
3. Extend `projects/service.ts`, `handlers.ts`, `runtime.ts`, and `packages/backend/src/functions/control/` with the owner-authorized update operation. Use existing `createHttpHandler` request/response/error envelopes. Add route configuration, SST linking/IAM shape, and tests in `infra/config/control.test.ts`, `infra/composition.test.ts`, and the relevant runtime tests.
4. Add repository/service/handler tests for: owner success; missing/foreign project returns 404 without exposing ownership; raising quota; lowering to exactly `accountedBytes`; lowering below pending/retained/trashed accounted bytes returns 409 and leaves settings unchanged; absent quota item treated as zero; malformed policy rejected before DynamoDB. Add a targeted stale-auth concurrency test: authenticate/read version N at a higher quota, atomically lower to version N+1, then attempt `reservePending` using version N; assert its ControlTable condition cancels, no pending item or quota increment is committed, and a freshly authenticated N+1 request uses the lower limit. Cover the inverse ordering too: a reservation that succeeds first raises `accountedBytes`, then an unsafe lower policy update rejects.

### Phase 3 — enforce policy at upload and preserve deletion deadlines

1. In `file-management/service.ts`, source quota and policy version exclusively from authenticated project context, then pass both as expected values into the repository’s authoritative transaction. Remove global quota use from normal runtime wiring, and test that two otherwise identical projects receive different reservation limits without callers controlling the limit.
2. In `file-management/model.ts`, replace the fixed-trash-duration invariant with the optional legacy-compatible snapshot invariant. Update `FileItem` schemas and parser tests for new snapshots, historical no-snapshot 14-day records, bad deadline/snapshot mismatch, and no retention fields on ready/pending/failed records.
3. Change the `FileRepository.trash` contract and DynamoDB update at `repository.ts:622-665` to accept/write the snapshot and to return the persisted item idempotently. Extend restore’s `REMOVE` expression to remove it. Preserve force/purge paths, which must neither infer nor change normal retention.
4. Change `lifecycle.ts` to calculate future normal-delete deadlines from the authenticated `project.fileManagement.trashRetentionDays`, and persist retention/version snapshots. Update lifecycle/repository tests for non-default duration, idempotent repeat delete, a retention-policy change after authentication but before delete (documented request-time snapshot wins), setting change after trash, restore before deadline, force deletion, and due purge based on persisted `purgeAt`.
5. Update completion/download/worker fixtures that currently manufacture trash records with `TRASH_RETENTION_MILLISECONDS`; those fixtures must supply the snapshot or deliberately exercise the legacy path. Confirm accounting remains closed only upon actual permanent object removal.

### Phase 4 — dashboard and integration guidance

1. Update `apps/dashboard/src/projects/api.ts` with `updateFileManagementPolicy`, strict request parsing, `PATCH`, and response parsing. Cover success, safe error mapping, path encoding, and rejected malformed client input.
2. Extend `CreateProjectForm.tsx` to collect quota and retention with default values and contract-approved min/max attributes. Explain that retained trash counts against storage quota and may affect cost. Keep URL lifetime controls unchanged.
3. Add an owner-visible policy editor in `ProjectDetails.tsx` (or a focused sibling component) and wire optimistic state refresh through `ProjectView.tsx`. Prevent duplicate submit, render server 409 safely, and never show internal IDs, DynamoDB keys, or raw error payloads.
4. Update component tests for displayed defaults/non-default policy, bounds validation, successful change refresh, and a quota-below-accounted error that leaves displayed current policy authoritative. Update integration-guide copy only if it lists fixed 5 GiB/14-day behavior.

## Validation

Run targeted tests during each phase, then the repository gates:

```powershell
npm test -- --run packages/contracts/src/projects/contract.test.ts
npm test -- --run packages/backend/src/modules/identity-control/projects
npm test -- --run packages/backend/src/modules/file-management
npm test -- --run apps/dashboard/src/projects
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

No deployment or AWS mutation is part of this issue. If an implementation later previews infrastructure, use the approved SST wrapper and an explicit non-production stage only after owner authorization.

## Acceptance checklist

- [ ] Contract accepts backward-compatible defaults and validates owner-approved quota/retention bounds.
- [ ] New and old project records resolve complete trusted settings without corrupting legacy data.
- [ ] Owner-only PATCH safely persists settings; foreign owners cannot observe or mutate another project.
- [ ] Lowering below all accounted bytes (including pending and trash) fails atomically and does not change policy.
- [ ] Upload reservation uses the authenticated project’s configured quota and policy version in an authoritative cross-table transaction; a stale higher quota cannot reserve bytes after an owner lowers it.
- [ ] New normal trash uses configured retention; existing trash’s `purgeAt` is immutable through later policy changes and retries.
- [ ] Restore, force delete, scheduled purge, and usage close-out stay correct under non-default settings.
- [ ] Dashboard shows/configures policy using safe bounds and cost/retention wording, with no CPA-specific defaults.
- [ ] Targeted and full validation pass; no secrets, object keys, or internal project IDs reach public UI/API responses.

## Implementation risks and references

The main correctness risk is a time-of-check/time-of-use gap between a quota reduction and an upload reservation. The transaction must condition the FileTable quota record and update ControlTable together; DynamoDB `TransactWriteItems` is atomic across tables in the same account/Region and supports client-token idempotency, while ordinary condition expressions guard a write against the identified item. See AWS documentation on [transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) and [conditional updates](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html).

The other release-blocking risk is retroactively changing retention by using the latest project policy in a purge worker. The persisted per-file deadline and deletion-time snapshot are the source of truth; workers must never look up current settings to decide whether a file is due.
