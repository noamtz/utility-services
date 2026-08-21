# PR #12 Review — RUS-01 deployable application foundation plan

## Verdict

**Request changes.** The plan has 2 high-severity and 3 medium-severity findings. In its current form, implementation could be declared complete without a reproducible SST provider setup or successful infrastructure synthesis.

## Findings

### High

1. **[AGENT FIXES] Pin and install the SST AWS provider.**  
   Evidence: `.agents/plans/rus-01-deployable-application-foundation.md:299` pins the JavaScript dependencies, while `:353` configures AWS as the SST home/provider and `:472` only checks the SST CLI version. The plan never pins the AWS provider or runs `sst install`. SST requires `sst install` after adding or updating `home` or providers; without that bootstrap, generated platform types and provider dependencies are absent or can vary between runs. See the [SST config reference](https://sst.dev/docs/reference/config) and [provider installation guidance](https://sst.dev/docs/providers/).  
   Required change: declare an exact AWS provider version in `app.providers`, add a local `sst install` step after creating `sst.config.ts`, define how generated artifacts are handled, and require that setup before typecheck or diff.

2. **[HUMAN DECIDES] Make successful SST composition verification an acceptance gate, or explicitly leave the ticket blocked.**  
   Evidence: `.agents/plans/rus-01-deployable-application-foundation.md:476` marks `sst diff` optional; `:525` and `:542` allow the quality gate to finish without it when AWS state/bootstrap is unavailable. [Issue #1](https://github.com/noamtz/utility-services/issues/1) requires the app to be synthesized for isolated stages. Unit tests and TypeScript checks cannot prove that the provider, route, Lambda handler, and StaticSite compose successfully.  
   Required decision: authorize a non-production, non-deploying synthesis path with the necessary existing read-only state access, or state that synthesis and the final acceptance gate remain unverified until separate owner authorization is provided. The plan must not claim all acceptance criteria passed without this evidence.

### Medium

3. **[AGENT FIXES] Remove the stale Git initialization task.**  
   Evidence: `.agents/plans/rus-01-deployable-application-foundation.md:291` instructs the implementer to confirm `.git` is absent and run `git init -b main`; the same stale assumptions appear at `:19`, `:89-91`, `:237`, and `:541`. This PR is already based on `origin/main` at `2bd72c8` and its body records that the baseline was pushed before the feature branch was created.  
   Required change: replace Git initialization with verification of the existing checkout, origin, baseline, branch, and clean worktree.

4. **[HUMAN DECIDES] Enforce the explicit-stage invariant in executable SST commands.**  
   Evidence: `.agents/plans/rus-01-deployable-application-foundation.md:202` requires every SST command to receive `--stage`, but `:212` defines `dev:sst` as `sst dev` and `:219` defines `infra:diff` as `sst diff --json`. Both accept invocation without a stage; `sst dev` can create/update AWS resources for the selected personal stage.  
   Required decision: use a checked wrapper that rejects missing or invalid stages before invoking SST, with tests for the failure cases, or approve another enforceable mechanism. Documentation that callers should append arguments is insufficient for this safety boundary.

5. **[HUMAN DECIDES] Define a restrictive CORS policy for the shared API foundation.**  
   Evidence: `.agents/plans/rus-01-deployable-application-foundation.md:360` creates `sst.aws.ApiGatewayV2` without a CORS setting. SST documents CORS as enabled by default, with wildcard origins, methods, and headers. See the [ApiGatewayV2 CORS reference](https://sst.dev/docs/component/aws/apigatewayv2#cors).  
   Required decision: set `cors: false` for RUS-01 if the dashboard shell does not call the health route, or define and test the minimum dashboard-origin/method/header allowlist if it does. Do not establish wildcard CORS as the inherited default for later authenticated control routes.

## Validation

| Check | Result |
|---|---|
| Full PR diff and Issue #1 acceptance criteria reviewed | Pass |
| `git diff --check origin/main...HEAD` | Pass |
| `python tooling/validate_codex_layer.py` | Pass — 31 skills, 6 custom agents |
| `uv run --script tooling/mcp/codebase_search.py --self-test` | Pass |
| Plan structure | Pass — 13 tasks, 20 validation entries, 9 acceptance criteria |
| Selected npm versions and TypeScript/ESLint peer compatibility | Pass |
| Application test/typecheck/lint suite | Not applicable — this PR contains only a plan |
| SST infrastructure synthesis | Not run; this omission is Finding 2 |

## What is done well

- The scope preserves the approved modular monolith and correctly defers credentials, file management, metering, and deployment.
- The contract, redaction, request-ID, retention, and test seams are aligned with the architecture’s later security boundaries.
- The proposed package versions are available and the TypeScript 6 / `typescript-eslint` peer range is compatible.
- The plan recognizes that `sst dev` can modify AWS state; the remaining work is to enforce that boundary consistently.

## Recommendation

Address all five findings before using this document as the executable RUS-01 implementation plan.
