# PR #24 Review â€” Request Changes

## Summary

PR #24 has a strong overall guard architecture and the full local quality suite passes, but it is not ready to merge. Three high-severity issues currently allow unsafe launcher inheritance, incomplete release evidence to be accepted as a pass, or the deployed journey to fail deterministically. Two medium evidence-quality gaps and one low validation-report mismatch should be addressed in the same correction pass.

Issue counts: **0 critical Â· 3 high Â· 2 medium Â· 1 low**.

## AGENT FIXES

1. **High â€” the deployed usage-attribution assertion resolves multiple elements.** `tests/e2e/activation.spec.ts:192` calls `pageA.getByText(projectA, { exact: true })`, but the same selected public project ID is rendered in `apps/dashboard/src/projects/ProjectList.tsx:41` and `apps/dashboard/src/projects/ProjectDetails.tsx:13`. Playwright strict assertions require a unique target, so an otherwise successful live journey will fail near completion. Scope the assertion to `section.project-details` (or another unique semantic owner) and add locator-level coverage where practical.

## HUMAN DECIDES

1. **High â€” Windows case-insensitive environment names bypass the secret-bearing child-process guard.** `tooling/acceptance/release-readiness.mjs:106` normalizes a key only for the secret-word regex, while `AWS_`, `RUS_RELEASE_`, `PLAYWRIGHT_`, `NODE_OPTIONS`, `NODE_PATH`, `PWDEBUG`, and `DEBUG` are compared case-sensitively through line 121. Windows treats environment names case-insensitively; a lowercase `node_options=--require <module>` survives the scrub and is honored by child Node, allowing injected code to access owner credentials or signed URLs. Normalize every reserved-name comparison (or build a minimal OS-variable allowlist) and add mixed-case regression tests in `tooling/acceptance/release-readiness.test.ts:135`.

2. **High â€” the launcher accepts a pass sentinel with an incomplete or duplicate release-case inventory.** `tooling/acceptance/release-readiness.mjs:201` requires only a nonempty array of syntactically valid passing cases, while the required cases are assembled independently in `tests/e2e/activation.spec.ts:58`. A truncated or later-regressed spec can emit one unrelated passing case and still receive `decision: "pass"`. Define one frozen required inventory and require exactly one occurrence of every expected name, rejecting missing, extra, and duplicate cases with focused parser tests.

## HUMAN READS

1. **Medium â€” the deployed public-error leak scan is narrower than the approved security evidence set.** `tests/e2e/support/file-journey.ts:14` catches ARNs, selected internal field names, some key prefixes, stacks, and `X-Amz-*`, but misses bucket-name disclosures, standalone AWS account IDs, generic object-key/prefix wording, credential/token fragments, UUID-style internal IDs, and arbitrary presigned query URLs. An otherwise valid shared envelope can therefore leak implementation evidence and still pass `expectPublicError` at line 52. Expand the scanner to the plan's complete forbidden categories and add deterministic helper tests that prove each category is rejected without reproducing the sensitive value in a thrown message.

## HUMAN TESTS

1. **Medium â€” any HTTP failure is accepted as proof of real presigned-URL expiry.** `tests/e2e/activation.spec.ts:179` marks the expiry case successful for every status `>= 400`; unrelated 4xx responses, a proxy failure, or S3 5xx can satisfy it. Because the same URL succeeds immediately before the wait at line 175, require the expected S3 expiry status (normally exact `403`) and, if response content is inspected, validate only a bounded safe expiry code without logging the raw XML. The authorized deployed run must then confirm this corrected assertion against the one-minute URL.

## FYI

1. **Low â€” the implementation report's diff-check claim is currently false.** `.agents/reports/rus-11-end-to-end-activation-release-readiness-report.md:48` records `git diff --check` as passing, but `git diff --check origin/main...HEAD` reports trailing whitespace at report lines 3 and 4. Those Markdown hard-break spaces were untracked when the earlier check ran. Remove them and rerun the branch-level command before updating the validation record.

## Validation

| Check | Result |
| --- | --- |
| `npm run check` | **PASS** on the final uncontended review run: format, lint, typecheck, 107 files / 588 tests, coverage, and production dashboard build |
| Coverage | **PASS**: 86.78% statements, 80.17% branches, 90.90% functions, 89.59% lines |
| Focused `SignInForm.test.tsx` rerun | **PASS**: 2/2; an earlier heavily parallel coverage attempt timed out mid-typing and did not reproduce in isolation |
| `npm run test:e2e:list` | **PASS**: one `authorized-deployed` test discovered |
| `tooling/acceptance/release-readiness.test.ts` | **PASS**: 7/7 |
| `git diff --check origin/main...HEAD` | **FAIL**: report lines 3â€“4 contain trailing whitespace |
| Authorized deployed Playwright journey | **NOT RUN**, as required pending separate external authorization |

One intermediate coverage attempt also collided with a concurrent review process in `coverage/.tmp`; the final full run was performed alone and passed.

## What's good

- `playwright.config.ts:6` establishes one worker, zero retries, bounded timeouts, and disables trace, screenshot, and video capture for the secret-bearing run.
- `tooling/acceptance/release-readiness.mjs:235` keeps dry-run mode process/network free and uses the repository-local Playwright CLI with no shell for execution.
- `tests/e2e/support/file-journey.ts:23` separates bearer-authenticated API requests from unauthenticated direct-S3 transfer requests, preventing credential forwarding.
- `apps/dashboard/src/projects/ProjectView.tsx:102` fixes stale inspection ordering with focused regression coverage.
- `tests/e2e/activation.spec.ts:184` waits for successful-path force deletions to reach `purged` before clearing cleanup IDs and cannot emit a pass sentinel after failed cleanup.

## Recommendation

**Request changes.** Fix the three high-severity issues before merge, close the medium evidence gaps, correct the report whitespace/claim, then rerun the focused tests, full `npm run check`, Playwright list/dry-run checks, and branch-level `git diff --check`. After the PR is green, a human should review the security-sensitive launcher and evidence assertions before any separately authorized deployed execution.

## Resolution

All six findings were fixed in the PR branch:

- The deployed project-ID locator is scoped to `section.project-details`, with coverage demonstrating why a global exact-text locator is ambiguous.
- Child environment filtering canonicalizes every key before applying Node, AWS, release, Playwright, debug, and secret-bearing exclusions; mixed-case Windows regressions are covered.
- The spec and launcher share one frozen, ordered release-case inventory, and parser tests reject missing, extra, and duplicate evidence.
- Public-error evidence scanning covers the full approved forbidden-category set without echoing rejected values.
- Expired transfer evidence requires exact HTTP 403 and rejects unrelated 4xx/5xx responses.
- Report metadata no longer uses trailing whitespace.

Post-fix validation passed: `npm run check` (108 files / 590 tests), coverage (86.78% statements, 80.17% branches, 90.90% functions, 89.59% lines), `npm run test:e2e:list`, the no-mutation release dry run, both Codex-layer checks, and `git diff --check`. The real one-minute deployed expiry exercise remains intentionally not run pending separate authorization.
