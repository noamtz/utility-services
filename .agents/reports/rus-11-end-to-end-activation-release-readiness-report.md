# Implementation Report â€” RUS-11 End-to-End Activation and Release Readiness

- **Plan**: `.agents/plans/rus-11-end-to-end-activation-release-readiness.md`
- **Branch**: `feature/rus-11-end-to-end-activation-release-readiness`
- **Status**: LOCAL IMPLEMENTATION COMPLETE; EXTERNAL RELEASE GATES PENDING

## Summary

Implemented the local RUS-11 release-readiness foundation without deploying or mutating AWS. The repository now has an exact-pinned, isolated Playwright project; a dry-run-by-default acceptance launcher with exact stage/AWS identity/process guards; a serial two-owner deployed journey covering the supported dashboard, REST, direct-S3, isolation, lifecycle, key, expiry, cleanup, usage, and activation-time paths; and operator documentation that separates local evidence from deployed, CloudTrail, alert-delivery, and human-product evidence.

Release-matrix work exposed one production correctness defect: a slower project-inspection response could replace a newer selection. `ProjectView` now applies request-generation ordering to inspection and invalidates pending inspections after creation, with focused regression coverage.

## Tasks completed

- Added exact `@playwright/test@1.62.1`, isolated test discovery, one serial Chromium project, zero retries, and disabled trace/screenshot/video/storage-state artifacts.
- Added strict shared release configuration for explicit non-production stages, exact HTTPS origins, bounded waits, two distinct invited owners, optional first-login password changes, and a repeated in-spec execution marker.
- Added `tooling/acceptance/release-readiness.mjs`, which is no-network in dry-run mode and, only in explicitly confirmed execute mode, sanitizes inherited environment values, applies the repository AWS policy, performs exact identity preflight, and launches the repository-local Playwright CLI without a shell.
- Added strict bounded result-sentinel validation and safe child-failure classification without forwarding arbitrary stdout, stderr, credentials, or URLs.
- Verified the existing owner/project, credential, direct upload, trash/purge, quota/rate-limit, usage, download-metering, quarantine, replay, and redaction integration suites; they already covered the backend portions of the release matrix, so no duplicate backend fixture was added.
- Extended dashboard tests for the Cognito new-password journey, stale project-inspection ordering, usage error recovery/incomplete freshness, and the complete copyable curl walkthrough.
- Added deployed-journey helpers that keep bearer keys and signed URLs in memory, use independent browser/API/transfer contexts, validate shared public schemas, prevent bearer forwarding to S3, poll eventual completion within bounds, and perform best-effort file/key cleanup.
- Added one non-retriable two-owner Playwright journey with unique retained project names, under-five-minute activation measurement, cross-project/guessed-ID denials, public/private transfers, trash/restore/force-delete, replacement/revocation, residual URL behavior, real one-minute expiry, and truthful usage freshness.
- Documented discovery, Chromium installation, dry-run/live commands, secret environment names, timing procedure, result shape, cleanup residue, and all separately authorized pending gates.

## Tests added or extended

- `tooling/acceptance/release-readiness.test.ts`: 9 policy tests for dry-run isolation, invalid input refusal, owner/marker confirmation, inherited-environment sanitization, stage-bound endpoint verification, direct-invocation refusal, secret-free exact identity/no-shell launch, timeout/failure safety, and strict result parsing.
- `apps/dashboard/src/App.test.tsx`: complete first-login `NEW_PASSWORD_REQUIRED` flow.
- `apps/dashboard/src/projects/ProjectView.test.tsx`: stale project-inspection response regression.
- `apps/dashboard/src/usage/UsagePanel.test.tsx`: safe error recovery into an incomplete projection.
- `apps/dashboard/src/integration/IntegrationGuide.test.tsx`: all five copyable curl blocks, routes, placeholders, required upload headers, lifecycle operations, and signed-query exclusion.
- `tests/e2e/activation.spec.ts`: one listed deployed Playwright test; it was intentionally not executed locally.
- `tests/e2e/support/file-journey.test.ts`: public-error evidence scanning, exact expired-transfer status, and purge-complete fallback cleanup coverage.
- Final local suite: 108 test files and 595 tests passed.

## Validation results

- `npm run check` â€” PASS after one formatting correction; includes format, lint, typecheck, coverage, and production dashboard build.
- `npm test` â€” PASS: 108 files, 595 tests.
- Coverage â€” PASS: 86.78% statements, 80.17% branches, 90.90% functions, and 89.59% lines.
- Focused backend release matrix â€” PASS: 8 files, 18 tests.
- Focused dashboard journey â€” PASS: 5 files, 15 tests.
- Release launcher policy â€” PASS: 9 tests.
- `npm run test:e2e:list` â€” PASS: exactly one `authorized-deployed` test; no secret or network requirement.
- Release dry run against `.invalid` origins â€” PASS with `decision: not-run` and `externalMutation: false`; no AWS/browser execution.
- `python tooling/validate_codex_layer.py` â€” PASS: 31 skills and 6 custom agents.
- `uv run --script tooling/mcp/codebase_search.py --self-test` â€” PASS.
- `npm exec -- vitest list` â€” PASS: 595 tests discovered.
- `git diff --check` â€” PASS.
- Static sensitive-term/IAM/object-key scan â€” reviewed; matches are policy checks, environment-variable names, synthetic test placeholders, fixed repository identity constants, or documentation warnings. No real credentials, signed queries, internal object identifiers, or generated Playwright artifact directories were found.

## Deviations from the plan

- A real dashboard defect was fixed in `ProjectView.tsx` because trustworthy two-project proof depends on the latest selection winning. The appended plan amendment records this bounded production change.
- The plan's `npm test -- --list` command is incompatible with installed Vitest 4 (`Unknown option --list`). The supported read-only equivalent, `npm exec -- vitest list`, passed and is recorded in a second plan amendment.
- The new acceptance executable remains outside the global V8 application denominator, matching the existing RUS-08 executable. Its policy boundary is covered by deterministic Vitest tests, and the unchanged 80% global gates passed without reduction.
- The listed backend release-matrix behaviors already had explicit owning-boundary coverage. Those suites were verified rather than mechanically modified or copied into a new mega-fixture.

## External work intentionally not performed

- No `infra:install`, `infra:diff`, deployment, Cognito user/password operation, credential creation, file/data mutation, Playwright execution, RUS-08 transfer exercise, operator apply/redrive, alert subscription, AWS read, or GitHub/Wiki write was performed.
- Task 9 still requires an owner-selected isolated non-production stage, two distinct invited accounts, no concurrent use, explicit preview/deploy/data-mutation authorization, installed pinned Chromium, and one authorized execution.
- Task 10 still requires separate authorization for the RUS-08 CloudTrail transfer/pricing-gate and any redrive or operator mutation. Download pricing remains `evidence-only`.
- Task 11 still requires an approved production alert-delivery path/recipient and the real two-user, three-day product experiment, followed by separately authorized GitHub writes authenticated exactly as `noamtz`.

RUS-11 cannot be called release-complete until those external gates produce reviewed evidence; this report marks only the local implementation and validation scope complete.

## PR #24 review remediation

- Scoped the deployed project-attribution locator to the selected project-details region and added a dashboard assertion proving the public project ID is rendered in multiple regions.
- Made reserved environment-name filtering case-insensitive for Windows and covered mixed-case Node, AWS, release, Playwright, and debug variables.
- Defined one shared frozen release-case inventory and made the launcher reject missing, extra, duplicate, reordered, or otherwise incomplete result evidence.
- Expanded public-error evidence scanning across bucket, account, object-key/prefix, credential/token, UUID, signed-query URL, and exception disclosures with deterministic helper tests.
- Tightened presigned-expiry evidence to exact HTTP 403; the real one-minute deployed assertion remains pending the separately authorized journey.
- Removed report trailing whitespace and reran the local diff check successfully.
- Bound execute-mode dashboard/API origins to the exact stage recorded by the ignored SST deployment outputs before AWS preflight or browser startup.
- Changed AWS identity preflight to an absolute trusted CLI path and a sanitized environment that excludes all owner credentials; only the validated Playwright child receives them.
- Made fallback cleanup poll `purge-pending` files until they are confirmed purged or absent, with invalid evidence reported as incomplete cleanup.
- Reused the same stage-output and secret-free AWS boundary inside the Playwright spec before it creates browser or API contexts, so direct Playwright invocation cannot bypass the launcher.
