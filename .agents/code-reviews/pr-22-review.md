# PR #22 Review - RUS-09 Dashboard and Five-Minute Integration

**Original recommendation: REQUEST CHANGES**

**Resolution: FIXED AND VALIDATED**

## Summary

The backend owner-usage boundary, strict response contract, query-only infrastructure wiring, and server-side integration guide are sound. The dashboard does not yet preserve the selected-project boundary across asynchronous work, however: an older credential operation can reveal a plaintext key after another project is selected, and an older usage request can display one project's cost under another. Credential replacement and revocation also execute without the approved confirmation step.

This review found 1 High, 2 Medium, and 2 Low issues. The full application gate passed, but the required `git diff --check` gate failed.

## AGENT FIXES

- **High - stale credential operations can reveal one project's plaintext key while another project is selected** (`apps/dashboard/src/credentials/ApiKeyPanel.tsx:29`, `apps/dashboard/src/credentials/ApiKeyPanel.tsx:40`, `apps/dashboard/src/projects/ProjectView.tsx:126`). `ApiKeyPanel` remains mounted when `projectId` changes, and clearing state in the effect does not invalidate already-running issue, replace, list, revoke, or pagination work. If project A's issue/replace request resolves after the owner selects project B, `setIssued(result)` renders A's plaintext key in B's panel; the following reload can also restore A metadata under B. Key the panel by project ID and add an abort or request-generation guard that prevents every stale operation from committing state. Add delayed-promise regression tests for switching during issue, replace, and list.

- **Medium - stale usage responses can attribute a prior project's cost to the newly selected project** (`apps/dashboard/src/usage/UsagePanel.tsx:21`, `apps/dashboard/src/usage/UsagePanel.tsx:25`, `apps/dashboard/src/projects/ProjectView.tsx:127`). Usage is neither cleared nor guarded when `projectId` changes. An A request that resolves after B can overwrite B's response, and the previous project's values remain visible while B loads. Reset the projection on project change and use an abort or request-generation guard for initial loads and refreshes. Add an out-of-order A-to-B response test.

- **Medium - revoke and replace mutate active credentials without confirmation** (`apps/dashboard/src/credentials/ApiKeyPanel.tsx:107`, `apps/dashboard/src/credentials/ApiKeyPanel.tsx:115`). One click immediately invalidates the selected server credential and can interrupt a production integration. Add an accessible confirmation state that names the affected key, explains the impact and bounded lifetime of existing presigned URLs, and covers both cancel and confirm paths in tests.

- **Low - the usage panel omits the projection's UTC period** (`apps/dashboard/src/usage/UsagePanel.tsx:54`). The response contains `usage.period`, but the rendered projection never shows it, so the approved requirement to identify the exact UTC month is not met. Display the period with explicit UTC wording and add an assertion.

- **Low - diff safety fails while the implementation report says it passed** (`.agents/reports/rus-09-dashboard-five-minute-integration-experience-report.md:66`, `.agents/plans/rus-09-dashboard-five-minute-integration-experience.md:46`). `git diff --check origin/main...HEAD` reports trailing whitespace in the plan and report, including report metadata lines 3-4. Remove or replace the Markdown hard-break whitespace, rerun the gate, and correct the report's validation claim.

## HUMAN DECIDES

None. The approved plan already determines the required project-isolation and confirmation behavior.

## HUMAN READS

- **Owner usage authorization boundary** (`packages/backend/src/modules/identity-control/usage/service.ts:36`): verify the final implementation continues resolving the public project through owner control before passing only its internal ID to usage pricing.
- **One-time secret lifecycle** (`apps/dashboard/src/credentials/ApiKeyPanel.tsx:35`): verify all completion paths are tied to the initiating project and a superseded request can never restore a secret.
- **Same-origin dashboard authentication** (`apps/dashboard/src/api/control-client.ts:26`): verify dashboard control calls remain relative and obtain a fresh Cognito access token for every request.
- **Server/client transfer boundary** (`apps/dashboard/src/integration/IntegrationGuide.tsx:1`): verify examples continue using placeholders and pass only opaque temporary transfer URLs to end clients.

## HUMAN TESTS

- **Rapid project switching** (`apps/dashboard/src/projects/ProjectExperience.test.tsx:20`): after fixes, manually start issue/replace and usage refresh operations for project A, immediately select project B, and confirm that no A key, metadata, cost, error, or completion state appears in B.
- **Credential confirmation UX** (`apps/dashboard/src/credentials/ApiKeyPanel.tsx:101`): confirm cancel performs no mutation and confirmation clearly communicates the effect on server integrations and already-issued presigned URLs.

## FYI

- **Positive - owner isolation is enforced before usage lookup** (`packages/backend/src/modules/identity-control/usage/service.ts:36`). Missing and foreign projects use the same safe not-found result, and usage receives the internal identity only after authorization.
- **Positive - least-privilege route composition** (`infra/api.ts:81`). The new JWT-protected route links only the control and usage tables, using their established query-only link permissions.
- **Positive - the integration guide preserves the intended trust boundary** (`apps/dashboard/src/integration/IntegrationGuide.tsx:1`). The project API key remains a server-side placeholder, presigned URLs are treated as opaque, and browser CORS is correctly described as separate from presigning.

## Validation

| Check | Result |
| --- | --- |
| Formatting | PASS |
| Lint | PASS with zero warnings |
| TypeScript | PASS |
| Full tests and coverage | PASS - 91 files / 528 tests |
| Coverage thresholds | PASS - 86.35% statements, 80.08% branches, 91.59% functions, 89.01% lines |
| Production dashboard build | PASS - 710 modules transformed |
| Codex-layer validation | PASS - 31 skills / 6 custom agents |
| Codebase-search self-test | PASS |
| `git diff --check origin/main...HEAD` | FAIL - trailing whitespace in the plan and report |
| Infrastructure preview | NOT RERUN during review; implementation report records a successful read-only `dev-rus02` diff and no deployment |

## What's good

The owner usage route is deliberately narrow, chooses the UTC month server-side, returns the existing strict projection, and avoids duplicating pricing logic. The dashboard's API adapters keep Cognito owner calls separate from project-key File Management calls. The integration instructions clearly teach the intended flow: the customer's server authenticates with the project key, receives an opaque presigned URL, and gives only that temporary URL to its client.

## Recommendation

Request changes. Fix the stale secret and usage races, add explicit credential confirmations, restore diff-safety truthfulness, then rerun the full gate and review before merge.

## Resolution evidence

- Credential work now uses request generations and project-keyed panel remounts; delayed issue,
  replacement, and list tests prove project A cannot restore plaintext or metadata after selecting
  project B (`apps/dashboard/src/credentials/ApiKeyPanel.test.tsx:90`).
- Usage work now clears on project changes and ignores superseded responses; an out-of-order
  projection test proves project A cannot overwrite project B (`apps/dashboard/src/usage/UsagePanel.test.tsx:106`).
- Revoke and replace now require an explicit accessible confirmation with cancel and confirm paths
  (`apps/dashboard/src/credentials/ApiKeyPanel.tsx:114`).
- The usage panel renders its exact `YYYY-MM UTC` period (`apps/dashboard/src/usage/UsagePanel.tsx:76`).
- Trailing whitespace was removed from the plan/report, and the working-tree diff safety check
  against `origin/main` passed.
- Post-fix `npm run check` passed 91 test files / 532 tests. Coverage passed at 86.30% statements,
  80.02% branches, 91.64% functions, and 89.02% lines; the production dashboard build passed.

## Final re-review after deployed human test

**Recommendation: REQUEST CHANGES — one Medium UX blocker remains**

### AGENT FIXES

- **Medium — evidence-only download behavior is presented as an ordinary asynchronous delay**
  (`apps/dashboard/src/usage/UsagePanel.tsx:70`). The panel renders only “Metering: not yet
  metered.” In the deployed evidence-only mode, completed downloads remain excluded from download
  requests, bytes, and cost until a separately authorized priced-mode release; waiting and refreshing
  cannot make them appear. Add a prominent conditional notice such as “Download metering is in
  validation mode; download requests, bytes, and costs are not included yet,” and cover it with a
  dashboard regression test. The later priced-gate change must update or remove the notice.

### HUMAN READS

- **Usage truthfulness** (`apps/dashboard/src/usage/UsagePanel.tsx:70`): verify the final text clearly
  distinguishes evidence-only validation from normal CloudTrail processing delay.
- **Gate source of truth** (`infra/config/download-metering.ts:17`): verify the UI notice remains
  accurate while `DOWNLOAD_PRICING_MODE` is `evidence-only`.
- **Repository explanation** (`README.md:130`): keep the dashboard wording consistent with the
  documented rule that observed evidence creates no priced ledger entries or freshness advance.

### HUMAN TESTS

- **Completed-download refresh** (`apps/dashboard/src/usage/UsagePanel.test.tsx:76`): after a real
  download and dashboard refresh, verify the validation-mode notice explains why download metrics
  remain zero and does not tell the owner merely to wait.

### FYI

- **Prior findings remain resolved** (`apps/dashboard/src/credentials/ApiKeyPanel.tsx:14`): the final
  re-review confirmed stale key/usage isolation, confirmation flows, UTC-period display, and diff
  safety; no other material findings remain.

### Final validation

- **Full gate passed** (`package.json:27`): `npm run check` passed 91 files / 532 tests with 86.30%
  statements, 80.02% branches, 91.64% functions, and 89.02% lines; the production build passed.

### Final resolution

- **Evidence-only notice added** (`apps/dashboard/src/usage/UsagePanel.tsx:75`): the dashboard now
  states prominently that download requests, bytes, and costs are excluded during validation and
  that refreshing cannot add them before the separately authorized pricing-mode change.
- **Regression coverage added** (`apps/dashboard/src/usage/UsagePanel.test.tsx:72`): the usage panel
  test requires the complete validation-mode explanation.
- **Targeted re-review passed** (`apps/dashboard/src/styles.css:290`): the notice is semantically and
  visually distinct, exposes no sensitive implementation detail, and resolves the final Medium
  finding. No material blockers remain; PR #22 is safe to merge after commit, push, and deployment.
