# PR #14 Review — Invite-only owner project control

## Verdict

**Approve with follow-up.** Fresh validation passes, and the review found 0 critical, 0 high, 2 medium, and 0 low findings. The two medium findings affect dashboard consistency and fail-closed handling of already-corrupt DynamoDB records; neither exposes another owner's data or compromises the current trusted write path.

The active GitHub identity is also the PR author, so GitHub cannot record a formal self-approval. This report should be posted as a review comment for the independent human approver.

## Findings

### Critical

None.

### High

None.

### Medium

1. **[AGENT FIXES] Serialize or supersede overlapping project-list requests.**
   - Evidence: `apps/dashboard/src/projects/ProjectView.tsx:36` permits the initial load, load-more requests, and the post-create refresh at `:63` to overlap while every completion writes the shared project list and cursor. A slow older request can overwrite a newer refresh, and two load-more actions using the same cursor can append the same page twice at `:42`.
   - Impact: the persisted data remains correct, but the owner dashboard can display stale or duplicate projects until another refresh.
   - Required fix: serialize/cancel list requests or ignore superseded generations, prevent reuse of an in-flight cursor, and add deferred-promise tests for out-of-order completion and repeated load-more activation.

2. **[AGENT FIXES] Enforce canonical relationships between Dynamo keys and embedded project fields.**
   - Evidence: `packages/backend/src/modules/identity-control/projects/model.ts:30` validates key prefixes, while `assembleProject` at `:112` checks only that metadata and utility partition keys match. `packages/backend/src/modules/identity-control/projects/repository.ts:159` can therefore return a structurally valid record queried under project P1 whose embedded `publicProjectId` is P2; list records can likewise carry a noncanonical owner sort key and generate an unusable cursor.
   - Impact: pre-existing corruption or a future miswriter can surface an internally inconsistent project identity instead of satisfying the stated corrupt-record fail-closed contract. The current trusted writer and owner comparison prevent this from becoming cross-owner access.
   - Required fix: verify `pk === projectPartitionKey(publicProjectId)`, `gsi1pk === ownerPartitionKey(ownerId)`, `gsi1sk === ownerProjectSortKey(createdAt, publicProjectId)`, and the utility partition against the canonical project key; map mismatches to `CorruptProjectRecordError` and add valid-format/inconsistent-value tests.

### Low

None.

## Review routing

### HUMAN DECIDES

- `.agents/plans/rus-02-invite-only-owner-project-control.md:664` — confirm the material same-origin CloudFront control-route decision received explicit owner approval outside the committed artifacts. If it did not, pause merge and resolve that architecture/security gate; this is an approval-provenance check, not an observed implementation defect.

### HUMAN READS

- `infra/control.ts:28` — verify invite-only Cognito client composition, Dynamo retention behavior, and the least-privilege table link.
- `infra/api.ts:20` — verify the Cognito JWT authorizer and that all three control routes, but not health, use it.
- `infra/dashboard.ts:22` — verify the narrow same-origin control proxy, forwarded values, and zero-TTL cache policy.
- `packages/backend/src/modules/identity-control/auth/owner-context.ts:32` — verify only a validated access-token subject becomes owner context.
- `packages/backend/src/modules/identity-control/projects/repository.ts:130` — verify owner-index pagination, transaction boundaries, and consistent project-partition reads.

### HUMAN TESTS

- `.agents/plans/rus-02-invite-only-owner-project-control.md:603` — after separately authorizing deployment and disposable invited users, exercise the new-password flow, two-owner isolation including guessed IDs, missing/ID/expired tokens, and CloudFront authorization forwarding/no-cache behavior.

### FYI

- `packages/backend/src/modules/identity-control/projects/repository.ts:56` — every `TransactionCanceledException` is currently treated as an identifier collision. This can cause up to three unnecessary attempts for a non-conditional cancellation, but the transaction remains atomic and the handler still fails closed with a safe 500; refine cancellation-reason handling as operational hardening.
- `.agents/reports/rus-02-invite-only-owner-project-control-report.md:3` — `git diff --check` reports only the intentional two-space Markdown hard breaks on the plan and branch metadata lines.

## Validation

| Check | Result |
|---|---|
| `npm run check` | Pass — format, lint, type-check, coverage tests, and production dashboard build |
| Vitest coverage run | Pass — 29 files, 165 tests; 87.93% statements, 84.03% branches, 88.54% functions, 89.29% lines |
| `python tooling/validate_codex_layer.py` | Pass — 31 skills, 6 custom agents |
| `uv run --script tooling/mcp/codebase_search.py --self-test` | Pass |
| `git diff --check origin/main...HEAD` | Note — only intentional Markdown hard-break whitespace in the implementation report |
| SST install and `dev-rus02` infrastructure preview | Not rerun in review; implementation report records both as pass under the required principal |
| Live Cognito/API Gateway/CloudFront validation | Not run — still requires separately authorized deployment and user creation |

## What is done well

- Authorization is layered correctly from API Gateway JWT validation through access-token semantic checks to owner-scoped service and repository operations.
- Wrong-owner inspection is indistinguishable from missing, and strict public schemas exclude owner IDs, internal IDs, Dynamo keys, tokens, and AWS details.
- Project creation uses an atomic conditional transaction, while list access uses the owner GSI rather than a scan.
- Contracts, handler behavior, secrecy assertions, infrastructure policies, and cross-boundary owner-isolation tests are thorough and readable.
- The implementation report clearly documents the AWS identity guard, SST OAuth-default correction, validation evidence, and the boundary around deployment/user creation.

## Recommendation

Approve PR #14 for human review and merge consideration. Track both medium findings for prompt correction with regression tests, and complete the separately authorized live boundary exercise before treating the deployed behavior as accepted.

## Remediation status — 2026-08-23

- `apps/dashboard/src/projects/ProjectView.tsx:40` — fixed overlapping list-request handling with request generations and per-cursor in-flight tracking; regression coverage now exercises stale response completion and repeated load-more activation.
- `packages/backend/src/modules/identity-control/projects/model.ts:76` — fixed canonical Dynamo metadata key validation and reused it for list/inspect reads; regression coverage now rejects valid-format but inconsistent partition and owner-index keys.
- `packages/backend/src/modules/identity-control/projects/repository.ts:56` — deferred precise non-conditional transaction cancellation handling to [GitHub issue #15](https://github.com/noamtz/utility-services/issues/15).
- `.agents/plans/rus-02-invite-only-owner-project-control.md:603` — live AWS validation remains a manual post-deployment gate.
