# PR #20 Review - RUS-07 File Trash and Permanent Purge

**Original recommendation: REQUEST CHANGES**

**Resolution: FIXED, RE-REVIEWED, AND DEPLOYED**

Both High findings were fixed in this PR. A fresh code-reviewer re-review found no Critical, High, or Medium findings. Deployed acceptance on `dev-rus02` passed, including a real replay of a presigned upload capability against S3 and scheduled-worker retry convergence.

## Summary

The implementation has strong project scoping, explicit lifecycle state, conditional restore/purge transitions, persisted physical-removal evidence, and conservative usage/quota ordering. However, two high-severity capability-revocation gaps can expose or recreate file bytes after lifecycle state says they are inaccessible or gone. These findings block deployment and merge until the design is corrected and covered by regression tests.

## HUMAN DECIDES — High severity

- **High — Public download revocation is not fail-closed during GSI propagation** (`packages/backend/src/modules/file-management/repository.ts:225`, `packages/backend/src/modules/file-management/downloads.ts:74`, `infra/config/file-management.ts:118`). `getPublic` returns the eventually consistent `PublicFiles` GSI record directly, and the public-download service signs it whenever that stale projection still says `ready`. Immediately after trash or final deletion, the stable public route can therefore mint a fresh S3 GET URL from a stale ready record. Fix by using the GSI only to resolve primary identity, then perform a strongly consistent primary-key `GetItem` and revalidate the exact public pair and ready state before signing; grant the public route the required file-table `GetItem` action and add a stale-GSI regression test.

- **High — An unexpired upload capability can recreate an orphan after permanent deletion** (`packages/backend/src/modules/file-management/presigning.ts:60`, `packages/backend/src/modules/file-management/presigning.ts:66`, `packages/backend/src/modules/file-management/lifecycle.ts:75`, `packages/backend/src/modules/file-management/lifecycle.ts:87`). Upload URLs remain valid for up to 60 minutes and target the final fixed key with `If-None-Match: *`. After force deletion removes that key and finalization removes metadata/releases quota, replaying the still-valid PUT succeeds and recreates untracked, unbilled bytes. Select a fail-closed mitigation before merge: minimally keep the claimed record/object until `uploadExpiresAt` plus a documented clock-skew allowance, or adopt temporary upload keys with server-controlled promotion; then test capability replay and ensure quota/storage evidence cannot finalize early.

## AGENT FIXES

None. Both findings affect access control, irreversible deletion, and accounting policy, so the owner must approve the mitigation direction before implementation.

## HUMAN READS

- **Permanent-removal ordering** (`packages/backend/src/modules/file-management/lifecycle.ts:75`): verify the chosen upload-capability mitigation still preserves S3 removal → stable removal evidence → storage closure → metadata/quota finalization.
- **DynamoDB lifecycle conditions** (`packages/backend/src/modules/file-management/repository.ts:614`): verify existence, revision, state, and identity guards remain intact across trash, restore, claim, evidence, and finalization writes.
- **Public authorization boundary** (`packages/backend/src/modules/file-management/downloads.ts:74`): verify the final signing decision is based on a strongly consistent primary record rather than solely on a GSI projection.

## HUMAN TESTS

- **Deployed lifecycle acceptance** (`tests/integration/file-trash-lifecycle.test.ts:262`): after both high findings are fixed and local validation is green, test trash/restore/force behavior on `dev-rus02`, including immediate public denial and replay of an upload URL issued before deletion.

## FYI

- **Positive evidence** (`packages/backend/src/modules/file-management/lifecycle.test.ts:104`): the tests thoroughly cover object-delete, removal-evidence, usage-close, and final-transaction retry windows with stable closure evidence and conservative quota release.
- **Initial validation flake** (`apps/dashboard/src/projects/ProjectView.test.tsx:40`): the first fresh `npm run check` timed out waiting for an unrelated project-list button while the component remained loading. The untouched test passed immediately in isolation, and a complete second `npm run check` passed all 71 files / 453 tests.

## Validation

| Check | Result |
| --- | --- |
| Formatting | PASS |
| Lint | PASS |
| TypeScript | PASS |
| Full tests and coverage | PASS on complete rerun — 71 files / 453 tests |
| Coverage thresholds | PASS — 86.30% statements, 80.60% branches, 92.57% functions, 88.96% lines |
| Build | PASS |
| GitHub checks | No checks configured/reported |
| `dev-rus02` deployment | NOT RUN — blocked by review findings |

## What's good

The PR correctly derives ownership from trusted project context, keeps private download authorization ready-only, makes restore lose to a persisted purge claim, retains public/object identity through trash, and closes storage before releasing quota. The use of `objectRemovedAt` as stable retry evidence is especially sound, and the route/worker permissions avoid wildcard access.

## Recommendation

Request changes. Resolve both high findings, rerun the full local gate and this review, then perform the guarded `dev-rus02` preview/deployment and deployed acceptance test before merge.

## Resolution evidence

- The public GSI is now only a locator. `getPublic` follows it with a strongly consistent primary-table read and revalidates the exact public identity before the download service can sign a URL (`packages/backend/src/modules/file-management/repository.ts:226`). The public route has the required primary-table `GetItem` permission (`infra/config/file-management.ts:118`), and stale-index regressions are covered (`packages/backend/src/modules/file-management/repository.test.ts:246`).
- Force deletion now revokes access and claims the file immediately while deferring physical removal until `max(now, uploadExpiresAt + 5 minutes)` (`packages/backend/src/modules/file-management/repository.ts:724`). The API returns `purge-pending` while waiting, and the same removal saga resumes only when the claim is due (`packages/backend/src/modules/file-management/lifecycle.ts:95`). Early physical-removal evidence is rejected by both repository conditions and model invariants.
- Post-fix `npm run check` passed 71 test files / 457 tests. Coverage passed at 86.39% statements, 80.82% branches, 92.57% functions, and 89.04% lines. A fresh-eyes re-review found no Critical, High, or Medium findings.
- Deployed acceptance passed for trash, denial, restore, force-pending, real presigned-PUT replay (`412`), retained bytes before eligibility, scheduled purge, and a zero-due lifecycle audit. The live run also found and fixed eager unlinked-resource resolution plus the missing transactional `DeleteItem` permission; the final full gate passed at 86.09% statements, 80.82% branches, 92.03% functions, and 88.71% lines.
