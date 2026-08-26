# Implementation Report â€” RUS-11 End-to-End Activation and Release Readiness

- **Plan**: `.agents/plans/rus-11-end-to-end-activation-release-readiness.md`
- **Branches**: `feature/rus-11-end-to-end-activation-release-readiness` (original), `fix/rus-11-eventbridge-retry-age` (Task 9 correction)
- **Status**: PARTIAL — AUTOMATED RELEASE GATES PASS; PRODUCTION ALERT AND HUMAN EXPERIMENT PENDING

## Summary

Implemented and exercised the RUS-11 release-readiness foundation against the isolated `dev-rus11-e2e` stage. The exact-pinned, guarded Playwright journey passed all 11 cases, and the separate CloudTrail transfer/pricing gate passed all six transfer cases with clean queues and deduplicated replay. Production alert delivery and the real two-human/three-day product experiment remain external gates, so the issue is not release-complete.

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
- `tests/e2e/activation.spec.ts`: one deployed Playwright test; the corrected authorized run passed all 11 safe-result cases against `dev-rus11-e2e`.
- `tests/e2e/support/file-journey.test.ts`: public-error evidence scanning, exact expired-transfer status, and purge-complete fallback cleanup coverage.
- Final local suite: 108 test files and 595 tests passed.

## Validation results

- `npm run check` â€” PASS after one formatting correction; includes format, lint, typecheck, coverage, and production dashboard build.
- `npm test` â€” PASS: 108 files, 595 tests.
- Coverage — PASS: 86.79% statements, 80.17% branches, 90.90% functions, and 89.59% lines.
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
- Post-run CloudWatch scan — PASS: 1,513 recent messages across seven stage log groups contained zero `X-Amz-`, project-key, bearer, or password matches.
- Post-run residue scan — PASS: zero file lifecycle records and zero generated Playwright artifact files. Seven file-table support/quota records and retained owner/project/control records remain because project deletion is intentionally out of scope.

## Deviations from the plan

- A real dashboard defect was fixed in `ProjectView.tsx` because trustworthy two-project proof depends on the latest selection winning. The appended plan amendment records this bounded production change.
- The plan's `npm test -- --list` command is incompatible with installed Vitest 4 (`Unknown option --list`). The supported read-only equivalent, `npm exec -- vitest list`, passed and is recorded in a second plan amendment.
- The new acceptance executable remains outside the global V8 application denominator, matching the existing RUS-08 executable. Its policy boundary is covered by deterministic Vitest tests, and the unchanged 80% global gates passed without reduction.
- The listed backend release-matrix behaviors already had explicit owning-boundary coverage. Those suites were verified rather than mechanically modified or copied into a new mega-fixture.

## External work still pending

- Task 11 still requires an approved production alert-delivery path and real recipient. The repository intentionally rejects production deploys through the current wrapper, and non-production stages intentionally create no alarm topic, so this cannot be inferred from `dev-rus11-e2e`.
- Task 11 also requires two actual people to connect real projects and record observations over three days. Automated disposable Cognito owners prove system composition but cannot satisfy or falsify that product experiment.
- Download pricing remains `evidence-only`. The passing matrix supports a later, separate reviewed source change and deployment; it does not authorize or perform the gate flip.
- The isolated stage retains disposable owner/project/quota records because project deletion is out of scope. Files were purged and keys revoked; the stage itself remains available until the owner separately decides to remove it.

RUS-11 cannot be called release-complete until the production alert and human-product gates produce reviewed evidence. All currently executable automated gates are complete.

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

## Task 9 deployment continuation

- Moved issue #11 from `Todo` to `In Progress` after verifying the active GitHub identity was exactly `noamtz`.
- Installed SST providers and reviewed a fresh `dev-rus11-e2e` preview: 216 creates, no AWS replacement/deletion, private buckets with Block Public Access, CORS disabled, no wildcard IAM actions, no non-production alarms/topic, and download pricing still `evidence-only`.
- The first deployment exposed an EventBridge target retry-policy defect: the omitted maximum event age was serialized as `0` and rejected by AWS. Added an explicit 3,600-second bound for the two file-operation schedules, updated infrastructure typings and regression tests, and validated the focused fix.
- A fresh recovery preview showed the corrected 3,600-second event age and two retries for both scheduled targets; the only replacement was SST's local dashboard build command. The same-stage recovery deployment completed successfully.
- Deployed checks passed: API health `200`, dashboard `200`, unauthenticated control request `401`, pinned Chromium installation, and the release harness dry run returned `decision: not-run` with `externalMutation: false`.
- Direct read-back verified both deployed file-operation EventBridge targets use a 3,600-second maximum event age, two retries, and a configured dead-letter queue.
- After explicit authorization, two suppressed-delivery disposable owners were created with generated in-memory-only temporary/permanent passwords and the guarded journey was launched exactly once.
- The run stopped at the first owner's `NEW_PASSWORD_REQUIRED` screen because `getByLabel("New password")` matched both the challenge region and its input under Playwright strict mode. No safe result sentinel was produced and the run was not retried.
- Read-only diagnosis confirmed both owners remain in `FORCE_CHANGE_PASSWORD`, the control/file tables remain empty, and no project/key/file state was created. The failure artifact contained no owner identifier, generated-password shape, or signed query and was removed after diagnosis.
- The helper now scopes the exact password input and submit button to the password region. A second deployed run and new disposable credentials require fresh authorization.
- The next run reached the first cross-project 404 and exposed an acceptance-only false positive: the forbidden-evidence regex scanned the entire shared envelope and rejected the valid UUID-shaped public `requestId`. The helper now scans only caller-facing error fields, with regression coverage that still rejects UUIDs in public messages.
- A later run reached force deletion after proving real URL expiry but exposed a second acceptance-only mismatch: the 90-second default could not cover the one-minute upload capability plus the deliberate five-minute deletion skew. The launcher and child now share a seven-minute default, with a deterministic policy assertion and README explanation.
- After residue and artifact inspection, the corrected journey passed all 11 cases. Activation from key availability through the first successful private upload/download measured 5.338 seconds. All disposable files were purged and active keys revoked; only documented owner/project/quota residue remains.
- Failure and success artifacts were scanned before removal. No owner identifiers, passwords, API keys, actual signed URLs, or signed-query credential values were found.

## Task 10 CloudTrail transfer/pricing gate

- Preflight confirmed the exact AWS identity, an active stage CloudTrail trail, and zero messages in both the main metering queue and DLQ.
- A disposable 64 MiB private file was uploaded through the real API/direct-S3 path so cancellation could be observed rather than racing a tiny object.
- The guarded matrix passed full download (67,108,864 bytes), range download (10 bytes), cancellation, two repeated requests, real expired-URL denial, and unused authorization.
- Four retained CloudTrail log objects were found. Exact replay accepted 13 events, recorded no duplicate charges, classified all 13 as duplicates, quarantined zero, and left both queues at depth zero.
- The safe decision was `pass` with `eligible-for-separate-reviewed-priced-deploy`. No source/configuration gate changed, no priced deployment occurred, and no redrive was needed.
- The disposable file was purged and its active key revoked. The project/quota record remains by documented design.
