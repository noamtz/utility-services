# PR #23 Review — Service Protection and Production Observability

**Recommendation:** REQUEST CHANGES

## Summary

The project-scoped quota, suspension controls, worker hardening, freshness indexing, and guarded operator tooling are cohesive and well tested. The full repository validation suite passes. One production-blocking observability defect remains: deployed functions and custom alarms use different values for the `Stage` metric dimension, so none of the new custom alarms can observe their corresponding metrics.

## Issue counts

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 0 |

## Issues

### High — Production custom alarms never match emitted metrics

**Routing:** AGENT FIXES

**Evidence:** `packages/backend/src/core/observability/metrics.ts:49` derives `Stage` from `SST_STAGE`, then falls back to `AWS_LAMBDA_FUNCTION_NAME`. Deployed SST Functions expose their stage in `SST_RESOURCE_App`; `SST_STAGE` is only set for SST dev mode. The generated deployed Lambda environment likewise contains `SST_RESOURCE_App` but no `SST_STAGE`. Consequently, production metrics use each physical Lambda function name for `Stage`. Every custom alarm filters on the actual application stage through `infra/observability.ts:57-62`, including authentication, rate-limit, HTTP, worker, quarantine, and freshness alarms.

**Impact:** In production the custom metrics are emitted, but every new custom alarm queries a different metric identity. Authentication abuse, project throttling, caught HTTP failures, async worker failures, quarantine, and stale/incomplete freshness conditions therefore remain silent despite the PR claiming actionable production alerting.

**Fix:** Explicitly inject `SST_STAGE: $app.stage` into every metric-emitting Lambda, or derive and validate the stage from `SST_RESOURCE_App` before the Lambda-name fallback. Add a deployed-environment regression test and a synthesis-level assertion that the emitted `Stage` dimension exactly matches the alarm dimension. The existing unit test at `packages/backend/src/core/observability/metrics.test.ts:16-24` passes `production` directly and does not exercise deployed environment discovery.

## Validation

| Check | Result |
| --- | --- |
| `npm run format:check` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:coverage` | PASS — 106 files, 577 tests |
| Coverage | PASS — 86.66% statements, 80.01% branches, 90.75% functions, 89.45% lines |
| `npm run build` | PASS |
| `python tooling/validate_codex_layer.py` | PASS — 31 skills, 6 custom agents |
| `uv run --script tooling/mcp/codebase_search.py --self-test` | PASS |
| `git diff --check origin/main...HEAD` | PASS |

No deployment, operator apply, watermark backfill, credential creation, or AWS mutation was performed during review.

## What’s good

- **HUMAN READS:** `packages/backend/src/modules/project-authentication/service.ts:76-99` fails closed on key/project state and admits quota only after verified context is assembled.
- **HUMAN READS:** `packages/backend/src/modules/project-authentication/rate-limit/repository.ts:30-54` implements the shared project/minute limit with one conditional DynamoDB update rather than a read/write race.
- **HUMAN READS:** `tooling/run-operator.mjs:61-88` and `tooling/operations/set-suspension.mjs:69-128` keep operator mutations allowlisted, identity-preflighted, explicit-stage, and dry-run-first.
- Redaction, bounded worker summaries, retry/DLQ controls, exact object-prefix IAM, GSI-only freshness queries, and transactional credential-state updates are thoughtfully implemented and covered by focused tests.
- The documented deviations are intentional, reflected in the implementation, and do not create additional findings.

## Recommendation

Request changes until the emitted stage dimension and alarm stage dimension are guaranteed to match in deployed environments. Re-run the full validation and review gate after the regression coverage is added.

## Resolution

- **Fixed now:** `packages/backend/src/core/observability/metrics.ts:26-42` now resolves the deployed stage from the validated `SST_RESOURCE_App` payload, honors explicit `SST_STAGE` in local SST development, and never substitutes a physical Lambda name for the stage dimension.
- **Regression proof:** `packages/backend/src/core/observability/metrics.test.ts:15-35` covers the deployed SST environment, precedence, safe local fallback, and malformed resource input. `infra/observability.test.ts:64-71` independently verifies that every synthesized custom alarm filters on the production stage, preserving the backend/infra TypeScript project boundary.
- **Deferred/logged:** none.
- **Manual look/test:** none required; the fix is deterministic environment parsing plus an infrastructure contract assertion.
