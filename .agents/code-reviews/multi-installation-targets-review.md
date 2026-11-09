# Code review: explicit installation targets (WCU-01)

Date: 2026-11-09
Branch: `feature/multi-installation-targets`
Scope: all tracked changes against HEAD and all seven untracked implementation, test, plan, and report files. This review report is excluded from the statistics.
Initial decision: **Changes required. One blocking security finding.**
Current status: **R1 fixed and re-reviewed; no remaining findings.** See the resolution below.

## Stats

- Files Modified: 19
- Files Added: 7
- Files Deleted: 0
- New lines: 1256
- Deleted lines: 245

## HUMAN DECIDES

### R1: Reject credential sources reintroduced by SST dotenv loading

```text
severity: critical
file: infra/config/installation-target.ts
line: 82
issue: SST can change credential sources after the wrapper's successful identity preflight.
detail: The configuration boundary checks target, stage, profile name, and regions, but does not reject AWS_CONFIG_FILE or AWS_SHARED_CREDENTIALS_FILE. SST loads dotenv files after the wrapper's STS check. An ignored .env or .env.<stage> can therefore restore these variables and make the same ntz-cli profile name resolve to different credentials. All current environment checks still pass, allowing SST's provider to access another account or principal without checking that identity.
suggestion: Reject reintroduced credential-source and endpoint overrides at the SST app configuration boundary before returning provider configuration. Account for SST's legitimate generated environment separately when validating run(). Add a regression test that simulates dotenv loading after a successful preflight and proves the app boundary fails before provider initialization. Do not merely scrub the wrapper's initial child environment again.
```

Critical classification follows the invoked skill's requirement to flag security issues as critical. This is an operator installation-isolation defect; no actual wrong-account access was performed or observed.

Evidence:

1. `tooling/run-sst.mjs:43` constructs the clean environment, checks identity at line 45, and only then starts SST at line 47. `tooling/run-operator.mjs:50` uses the same sequence before SST shell.
2. The pinned [SST 4.17.1 CLI source](https://github.com/sst/sst/blob/v4.17.1/cmd/sst/cli/cli.go#L29) loads `.env` during CLI initialization and overloads `.env.<stage>` in `Stage` at line 322. This occurs inside the child process, after the wrapper preflight.
3. `sst.config.ts:8` invokes the new guard. `infra/config/installation-target.ts:82` accepts the environment as long as the selector, stage, profile, and two region values match; credential-file overrides are ignored.
4. The [SST AWS provider](https://github.com/sst/sst/blob/v4.17.1/pkg/project/provider/aws.go#L58) resolves credentials through `LoadDefaultConfig` using the profile name. The [AWS SDK environment configuration](https://github.com/aws/aws-sdk-go-v2/blob/main/config/env_config.go) recognizes both credential-file variables. Pinning a profile name therefore does not pin its source file or account.

Local reproduction, using only synthetic paths and a mocked successful STS response:

```javascript
import {
  resolveInstallationTarget,
  resolveInstallationEnvironment,
} from "./infra/config/installation-target.ts";
import { createAwsEnvironment, verifyAwsIdentity } from "./tooling/aws-access.mjs";

const target = resolveInstallationTarget("israel", "dev-rus02");
const environment = createAwsEnvironment(target, {});
verifyAwsIdentity(
  target,
  () => ({
    status: 0,
    stdout: JSON.stringify({ Account: target.accountId, Arn: target.principalArn }),
  }),
  environment,
  process.cwd(),
);
const afterDotenv = {
  ...environment,
  AWS_SHARED_CREDENTIALS_FILE: "C:/synthetic/other-credentials",
};
resolveInstallationEnvironment(target.stage.name, afterDotenv); // Incorrectly succeeds.
```

The same reproduction succeeds with `AWS_CONFIG_FILE`. No actual credential file was created or read. This demonstrates the local guard failure; the downstream account-switch risk follows from the pinned SST credential-loading path above. No live AWS reproduction was attempted.

## Initial validation

- Focused installation-policy, composition, wrapper, and native acceptance CLI suite: **106 tests passed across 10 files**.
- `npm run typecheck`: passed.
- `python tooling/validate_codex_layer.py`: passed, 31 skills and 6 agents.
- `uv run --script tooling/mcp/codebase_search.py --self-test`: passed.
- `git diff --check`: passed.
- Read-only infrastructure and acceptance reviews found no additional material defects.

The earlier implementation report recorded the full quality suite passing; the initial review reran the focused suite and checks listed above, not the entire application suite. At review time, tests mocked the process boundary and missed the credential-file reintroduction case. No implementation changes, AWS calls, deployments, credentials, commits, or remote writes were made during that review.

## R1 resolution — 2026-11-09

The owner authorized the fix after this review. `sst.config.ts:7` now calls the strict `resolveSstAppInstallation` guard after dotenv loading and before returning AWS provider configuration. It rejects every unapproved `AWS_*` variable, all pre-provider `SST_AWS_*` variables, casing aliases, and changes to the two wrapper protection flags. The later `run()` hook retains the existing target binding check so SST-generated credentials remain supported.

`tooling/sst-environment.test.ts:43` executes the actual app hook after a mocked successful STS preflight and simulated dotenv loading. Nine unsafe cases failed before the fix and now pass by rejecting the overrides. A normal application dotenv case preserves Israel's provider binding. `infra/config/installation-target.test.ts:104` also verifies that generated credentials are rejected before provider initialization and accepted by the later binding check.

The follow-up read-only review confirmed R1 is resolved and found no regression. `npm run check` passed formatting, lint, typechecking, coverage, and build, with **663 tests across 112 files**, including the 11 new regression tests. No AWS calls, deployment, or credential changes were needed. The initial finding and reproduction above are retained as historical evidence; the strict app guard is now the entry point that blocks that scenario.
