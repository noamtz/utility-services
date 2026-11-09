# PR #44 review — explicit installation targets

PR: https://github.com/noamtz/utility-services/pull/44

Head: `feature/multi-installation-targets`

Base: `main`

Commit reviewed: `61b7c41`

## Summary

The PR meets WCU-01's local safety scope. A fresh read-only code review found no material correctness or security issue. The existing Israel app, stage, region, account, and principal bindings remain intact, while every AWS-backed entry point requires an explicit installation and exact identity preflight. The earlier dotenv credential-source finding is resolved before SST initializes its AWS provider.

## Issues by severity

| Critical | High | Medium | Low |
| ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 |

## FYI

- `infra/config/installation-target.ts:96`: The strict SST app guard rejects AWS credential, alternate config-file, and endpoint overrides loaded after wrapper preflight. The run hook uses the later binding check so SST-generated credentials remain valid.
- `tooling/run-sst.mjs:41`: Target and stage selection, controlled child environment, and exact STS check precede SST execution.
- `infra/config/download-metering.ts:6`: Regional metering remains Israel-specific under WCU-01; WCU-02 owns additional region semantics.

## Validation

| Check | Result |
| --- | --- |
| `npm run check` | PASS: format, lint, typecheck, coverage, build |
| Vitest within coverage run | PASS: 663 tests across 112 files |
| Coverage thresholds | PASS: statements 86.85%, branches 80.35%, functions 90.99%, lines 89.67% |
| Diff whitespace check | PASS |
| GitHub checks | None reported on this branch at review time |

No AWS read, infrastructure diff, deployment, or live acceptance execution was performed. This review therefore establishes local behavior and code quality, not deployed behavior.

## What's good

The installation resolver keeps target and stage ownership in one secret-free policy. The wrappers clear ambient AWS settings and pin exact profile, region, and principal checks. The regression test executes the real SST app hook after simulated dotenv loading, while the operator, release, and metering paths have focused boundary tests. Documented deviations from the plan preserve existing Israel stages and defer regional metering to WCU-02.

## Recommendation

**Ready for human review and approval.** The GitHub identity `noamtz` authored this PR, so this agentic verdict is posted as a PR comment rather than a self-approval.
