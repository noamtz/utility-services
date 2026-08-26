# PR #23 Re-review — Service Protection and Production Observability

**Recommendation:** APPROVE

## Summary

The updated PR satisfies the RUS-10 intent and repository standards. The previous production alarm defect is resolved: deployed SST stage discovery, emitted custom-metric dimensions, and CloudWatch alarm filters now use the same stage value. The full repository gate passes, and the fresh-eyes review found no remaining high-confidence correctness, security, isolation, data-integrity, or operability issues.

## Issue counts

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

## Issues

None.

## Prior finding resolution

- **FYI:** `packages/backend/src/core/observability/metrics.ts:32-42` now derives deployed stage identity from validated `SST_RESOURCE_App.stage`, with local `SST_STAGE` precedence and no physical Lambda-name substitution. The emitted `Stage` dimension at `packages/backend/src/core/observability/metrics.ts:96` matches the production alarm filter at `infra/observability.ts:57-62`.
- **FYI:** `packages/backend/src/core/observability/metrics.test.ts:15-33` covers the deployed environment, precedence, local fallback, and malformed input. `infra/observability.test.ts:69-75` independently asserts that all custom alarms filter on `production`.

## Validation

| Check | Result |
| --- | --- |
| `npm run format:check` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:coverage` | PASS — 106 files, 578 tests |
| Coverage | PASS — 86.70% statements, 80.03% branches, 90.76% functions, 89.47% lines |
| `npm run build` | PASS |
| `python tooling/validate_codex_layer.py` | PASS — 31 skills, 6 custom agents |
| `uv run --script tooling/mcp/codebase_search.py --self-test` | PASS |
| `git diff --check origin/main...HEAD` | PASS |

No deployment, operator apply, watermark backfill, credential creation, or AWS mutation was performed during re-review.

## What’s good

- **HUMAN READS:** `packages/backend/src/modules/project-authentication/service.ts:76-99` fails closed on key/project state and invokes the shared limiter only after verified project context is assembled.
- **HUMAN READS:** `packages/backend/src/modules/project-authentication/rate-limit/repository.ts:30-54` enforces the project/minute quota through one conditional DynamoDB update, avoiding read/write races across keys and functions.
- **HUMAN READS:** `packages/backend/src/modules/usage-pricing/repository.ts:822-912` maintains the sparse freshness index monotonically and exposes bounded GSI-only queries without widening runtime IAM.
- **FYI:** `packages/backend/src/modules/file-management/downloads.ts:75-92` denies suspended stable-public access before file lookup or presigning, preserving the generic not-found contract.
- **FYI:** `tooling/run-operator.mjs:61-88` keeps mutations allowlisted, exact-identity-preflighted, explicit-stage, and dry-run-first.

## Recommendation

Approve. The automated gate is green, the prior blocking finding is fixed with regression coverage, and no Critical, High, Medium, or Low findings remain. A human should now review the load-bearing paths above and make the final merge decision.
