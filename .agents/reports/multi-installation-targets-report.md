# Implementation Report — Explicit installation targets (WCU-01)

**Issue**: https://github.com/noamtz/utility-services/issues/27
**Plan**: `.agents/plans/multi-installation-targets.md`
**Branch**: `feature/multi-installation-targets`
**Status**: COMPLETE (local implementation and validation; uncommitted)

## Summary

SST, operator, release-readiness, and download-metering wrappers now require one explicit installation target and stage. The frozen registry preserves Israel's existing app/account/region/principal and shared `dev-rus02` stage. Wrappers reject unknown or conflicting selections, clear ambient AWS overrides, and check the exact identity before downstream AWS work. SST provider configuration and Cognito issuer use the resolved installation.

The isolated worktree is `worktrees/multi-installation-targets`, based on `origin/main` at `66919c0`. Dependencies were installed with `npm ci` inside this worktree. The main checkout and the existing WhatsApp worktree were not changed.

## Tasks completed

- Added immutable target/stage resolution and SST environment validation in `infra/config/installation-target.ts`.
- Updated app policy, SST composition, and Cognito issuer; retained app name and production retain/protect behavior.
- Added shared selector parsing in `tooling/installation-arguments.mjs`; both selector syntaxes work, duplicate selectors and profile/region/config overrides fail locally, and the operator's business `--target` remains intact.
- Hardened shared AWS environment and exact account/principal preflight; kept explicit CA bundles and the Windows fallback, pinned AWS executable paths, and suppressed raw authentication error output.
- Updated both acceptance workflows and their execution boundaries; dry runs remain local.
- Updated AGENTS.md and README operational guidance and command examples.
- Completed local tests, coverage, formatting, lint, types, build, Codex validation, codebase-search self-test, and whitespace checks.

## Tests added

Target continuity and deep immutability; missing/unknown target; invalid and foreign stages; synthetic cross-installation collisions; attempted region/profile/stage switches; exact account and principal failures; malformed/process-error identity responses; ambient credential and endpoint stripping; selector parsing and no-spawn failure ordering; provider/issuer propagation; production safety; legacy release outputs; metering preflight failure isolation; and native Node dry-run loading for both acceptance entry points.

The focused policy/composition/wrapper suite passed 104 tests; two additional native CLI tests passed as part of the full suite. All AWS/process interactions in execution-policy tests are mocked; real CLI smoke tests use dry-run mode only.

## Initial validation results

- `npm run check`: PASS (format, lint, typecheck, coverage, and build).
- `npm test`: PASS, 652 tests across 111 files.
- Coverage: statements 86.84%, branches 80.30%, functions 90.97%, lines 89.64%; all repository thresholds passed.
- `python tooling/validate_codex_layer.py`: PASS, 31 skills and 6 custom agents.
- `uv run --script tooling/mcp/codebase_search.py --self-test`: PASS.
- `git diff --check`: PASS.
- Instruction drift review: updated target rules and all active README/AGENTS command examples match the implemented wrapper contract; existing bounded-context and Codex paths remain valid.

No AWS reads, infrastructure diff, deployments, credentials, remote writes, or acceptance execution occurred. This is local evidence; it does not claim deployed validation.

## Deviations from the plan

- Chose exact legacy `dev-plan`, `dev-rus02`, and `production` bindings, new `dev-israel-<slug>` stages, and Israel-owned `pr-<number>` stages. Future installations require disjoint reviewed bindings. No unapproved account/profile values were invented.
- Centralized selector parsing in an extra shared module rather than duplicating it across four wrappers.
- Kept existing Israel metering execution available. Other installations fail closed until WCU-02. Moved the unchanged regional constant from general app policy into metering configuration so this ticket does not change rates or regional ingestion semantics.
- Added the installation name to SST outputs. Legacy outputs without that field are accepted only for existing Israel `dev-rus02`/`dev-plan`, avoiding a deployment solely to preserve acceptance compatibility.
- Copied ignored, declaration-only `sst-env.d.ts` files from the main checkout into the worktree root and backend source directory. They contain types only; no AWS state or credentials were copied.

## Issues encountered

- Fresh checkout typechecking initially lacked the ignored backend SST declarations; copying those local type declarations resolved it.
- A native Node dry run caught a TypeScript import that Vitest's bundler tolerated. Removed that dependency from the acceptance entry point and added native-process regression coverage.
- A separate full test run overlapping coverage hit two pre-existing dashboard tests' five-second timeouts. The coverage run passed; rerunning `npm test` alone passed all 652 tests without changing test timeouts or application code.

## Review R1 fix and final validation

The review found that SST could reload credential-file overrides from dotenv after the wrapper's successful STS preflight. The owner authorized the fix. The app hook now calls `resolveSstAppInstallation`, which rejects unapproved AWS variables and pre-provider SST AWS credentials before returning provider configuration. The later run hook retains its existing binding check and accepts SST-generated credentials.

- Added 10 tests that invoke the actual app hook after a mocked STS preflight and simulated dotenv reload. Nine unsafe cases reproduced the failure before the fix; all now reject before provider configuration. Normal application dotenv values still work.
- Added a regression test for the distinct pre-provider and post-provider credential environments.
- Follow-up read-only review: R1 resolved, no remaining findings.
- `npm run check`: PASS, including **663 tests across 112 files**, formatting, lint, typechecking, coverage, and build.
- Coverage: statements 86.85%, branches 80.35%, functions 90.99%, lines 89.67%; all thresholds passed.

No findings were deferred. No AWS calls, deployment, credentials, commits, or remote writes occurred during the fix. Operational documentation, the plan amendment, and the review resolution record reflect the additional guard.

## Handoff

Changes are ready for review and a subsequent commit/PR. Restart Codex when opening this worktree so it loads the updated AGENTS.md. After the branch is merged, remove the worktree with `git worktree remove worktrees/multi-installation-targets`; this does not remove the shared AWS stage.
