# Feature: Explicit multi-installation deployment targets (WCU-01)

Validate the current code and docs before implementing. This is a safety-only infrastructure change: do not read AWS, deploy, create credentials, or change `dev-rus02` without separate authorization.

## Feature Description

Replace the hard-coded Israel AWS target with a reviewed, secret-free installation-target registry. A local command selects a named target and stage; wrappers resolve only that entry, pin its profile/region, verify the exact AWS account and principal, and give SST the selected target. The Israel installation stays the same SST app and `dev-rus02` stage in account `162067902192`, `il-central-1`, under `arn:aws:iam::162067902192:user/ntz-cli`.

This enables independent account/region installations for WhatsApp without shared data or an in-place region migration. WCU-02, which this ticket blocks, makes pricing/metering regional.

## User Story

As a Utility Services operator, I want to select an approved account/region installation before any SST or AWS-backed action, so wrong credentials, region, or default profile cannot affect another installation.

## Problem Statement

`infra/config/app.ts` and `tooling/aws-access.mjs` encode one account, full caller ARN, profile, and `il-central-1`; `infra/api.ts` uses the same global region in the Cognito issuer. Stage selection has no installation binding. `run-operator`, release-readiness, and download-metering also reach AWS through the singleton guard or their own Israel constants. SST documents app/stage names as namespaces and says moving an app/stage to another region requires removing old-region resources.

## Solution Statement

Add one typed, frozen registry with target name, account ID, region, expected full ARN, profile alias, and allowed stage binding—no credentials. A pure resolver validates target + stage together. All wrappers require an explicit target, set a private target marker for `sst.config.ts`, pin its child environment, remove ambient credential-source variables, and preflight STS before AWS/SST access. SST provider region and Cognito issuer consume the same resolved target. Keep app name, `dev-rus02`, and production retain/protect behavior unchanged.

## Out of Scope / Non-Goals

- No AWS read/deploy, Frankfurt/CPA account creation, credential creation, or target migration.
- No cross-region control plane, replication, shared data, File Management changes, WhatsApp integration, or CPA rules.
- No regional prices, CloudTrail prefix/metering changes, or rate changes: WCU-02 owns those semantics.
- Do not rename the app or the Israel stage; do not weaken production retention/protection or external authorization requirements.

## Feature Metadata

**Feature Type**: Enhancement / safety refactor
**Complexity**: High
**Affected systems**: SST policy/composition, AWS CLI wrappers, operator/acceptance entry points, AGENTS.md
**Dependencies**: SST 4.17.1, AWS CLI/STS; no new runtime library

## Related Work

**Implements**: [WCU-01 / #27](https://github.com/noamtz/utility-services/issues/27)
**Architecture**: [WhatsApp Communication Utility Architecture](https://github.com/noamtz/utility-services/wiki/WhatsApp-Communication-Utility-Architecture)
**Blocks**: [WCU-02 / #28](https://github.com/noamtz/utility-services/issues/28), which consumes target account/region for metering/rates.
**Independent of**: WCU-03 / #29 (project quota/trash configuration).

---

## CONTEXT REFERENCES

### Relevant Codebase Files — read before implementing

- `sst.config.ts:4-18` — obtains `createAppPolicy(input.stage)` and sets SST provider region; pass a validated target without altering the legacy namespace.
- `infra/config/app.ts:1-37` and `infra/config/app.test.ts:1-41` — current pure single-region policy and tests; refactor around a resolved target while retaining production behavior.
- `infra/config/stage.ts:1-46` — canonical stage grammar/classification; compose with it, never duplicate it.
- `infra/api.ts:1-61` — Cognito issuer imports global region; accept an explicit resolved region from composition.
- `infra/composition.test.ts:26-44` — SST composition/source assertion style.
- `tooling/aws-access.mjs:1-84` and `tooling/aws-access.test.ts:1-47` — target profile/region construction and exact STS account/ARN seam.
- `tooling/run-sst.mjs:10-79` and `tooling/run-sst.test.ts:11-121` — exact `--stage`, allowlist, preflight-before-spawn, pinned executable, and injected spawn test pattern.
- `tooling/run-operator.mjs:21-88` and `tooling/run-operator.test.ts:11-53` — AWS-backed operator launcher; preserve its business `--target` option while adding the distinct wrapper selector `--installation-target`.
- `tooling/acceptance/release-readiness.mjs:86-148,195-217,303-358` — separate preflight and child environment needing target propagation.
- `tooling/acceptance/download-metering.mjs:20-24,123-140,288-290,357-370` — duplicate Israel identity/region; make access use the shared guard or fail closed until WCU-02 regionalizes it.
- `AGENTS.md:20-30,34-36,103-110` — stale single-target rules and command examples to update.
- `package.json:15-33` — launcher and validation scripts.

### New Files to Create

- `infra/config/installation-target.ts` — frozen secret-free registry, target/stage resolver, exported types/errors.
- `infra/config/installation-target.test.ts` — resolver/continuity unit tests.

### Relevant Documentation

- [SST Basics: app, stage, and region](https://sst.dev/docs/basics#app) — app/stage namespaces and no in-place region switch.
- [SST config: AppInput and removal policy](https://sst.dev/docs/reference/config#appinput) — verify current SST configuration semantics.
- [SST AWS accounts](https://sst.dev/docs/aws-accounts) — `AWS_PROFILE` precedence over config.
- [AWS CLI environment variables](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html) — command/environment/profile precedence and `AWS_PROFILE`/`AWS_REGION` behavior.
- [AWS STS get-caller-identity](https://docs.aws.amazon.com/cli/latest/reference/sts/get-caller-identity.html) — returned account and caller ARN used for exact preflight.

### Patterns to Follow

- **Pure policy**: retain deterministic construction style from `createAppPolicy` (`infra/config/app.ts:22-37`); target selection must be an explicit argument, never environment inference.
- **Strict parse**: mirror exact `--stage` collection in `parseSstInvocation` (`tooling/run-sst.mjs:16-43`) for exactly one installation selector in `--installation-target value` / `--installation-target=value` form, then remove the wrapper-only flag before SST.
- **Preflight ordering**: retain `parse → controlled environment → STS → SST` from `runSst` (`:62-73`); a failed check must not spawn SST.
- **Production safety**: retain `stage.kind === "production"` → `{ removal: "retain", protect: true }` (`infra/config/app.ts:22-37`).
- **Local tests**: injected `vi.fn()` spawns in `tooling/run-sst.test.ts:42-103`; assert argv, environment, call order, and no network access.

---

## IMPLEMENTATION PLAN

### Phase 1: Immutable target policy

Create the one source of truth first. Define the existing Israel target with exact current non-secret values and an explicit binding for `dev-rus02`. Use a narrow stage policy: exact persistent stages plus deliberate allowed ephemeral stage patterns. Unknown target, missing target, target/region override, and a valid-looking stage bound to another target must fail locally.

### Phase 2: Target-aware SST and auth composition

Require a wrapper-set target marker in `sst.config.ts`, resolve it with `input.stage`, and fail if absent/incompatible. Provider region and API Cognito issuer come from that same policy. Preserve the app name and Israel stage to avoid a new SST namespace; preserve production retention/protection.

### Phase 3: Harden all AWS entry points

Parameterize environment/STS helpers by resolved target. Overwrite profile/regions; scrub `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, and web-identity credential variables from children; preserve explicit CA bundle or use the established Windows fallback. Thread target through SST, operator, release readiness, and metering. Dry local paths may validate target/stage but must not call STS.

### Phase 4: Documentation and local validation

Replace AGENTS.md's one-account language with reviewed target rules and target-qualified examples. Retain `dev-rus02` continuity and explicit authorization requirements. Run only local tests/checks.

---

## STEP-BY-STEP TASKS

### 1. CREATE `infra/config/installation-target.ts`

- **IMPLEMENT**: Export frozen `INSTALLATION_TARGETS`, target/stage types, a validation error, and `resolveInstallationTarget(targetName, stageName)`. The legacy entry includes target key, account ID, region, expected full ARN, profile alias, and stage policy; output includes `classifyStage` result.
- **PATTERN**: `infra/config/stage.ts:14-46`; immutable constants in `infra/config/app.ts:3-20`.
- **GOTCHA**: Never commit credentials or read target/profile/region from environment. Preserve existing values exactly. Do not invent a Frankfurt profile, ARN, or account.
- **VALIDATE**: `npm test -- --run infra/config/installation-target.test.ts`
- **SATISFIES**: AC 1, 3, 6.

### 2. CREATE `infra/config/installation-target.test.ts`

- **IMPLEMENT**: Test `israel` + `dev-rus02` exact continuity/frozen output; missing/unknown target; invalid stage; stage collision; attempted alternate region; and immunity to `AWS_REGION`, `AWS_PROFILE`, and `SST_STAGE` environment values.
- **PATTERN**: Vitest table/deep-object assertions from `infra/config/app.test.ts:12-41` and `infra/config/stage.test.ts`.
- **GOTCHA**: Region-switch coverage is pure local policy testing, never AWS.
- **VALIDATE**: `npm test -- --run infra/config/installation-target.test.ts`
- **SATISFIES**: AC 1, 3, 6.

### 3. UPDATE `infra/config/app.ts` and `infra/config/app.test.ts`

- **IMPLEMENT**: Replace `AWS_REGION` singleton with `installation: ResolvedInstallationTarget` in `AppPolicy`; make `provider.region` derive from it. Accept target/stage explicitly (or a resolved target) and retain app name, provider version, and exact production removal/protect logic.
- **PATTERN**: Return-object shape in `infra/config/app.ts:22-37`.
- **GOTCHA**: Do not derive app names from target or alter pricing/metering constants; SST treats app-name changes as new resources and WCU-02 owns regional metering.
- **VALIDATE**: `npm test -- --run infra/config/app.test.ts infra/config/installation-target.test.ts`
- **SATISFIES**: AC 2, 4, 6.

### 4. UPDATE `sst.config.ts`, `infra/api.ts`, and `infra/composition.test.ts`

- **IMPLEMENT**: Read the dedicated marker in `app(input)`, resolve it with `input.stage`, and configure the provider from that policy. Ensure `run()` receives the identical context. Make `createApi` take `region` and use it for the Cognito issuer rather than importing a global constant.
- **PATTERN**: `sst.config.ts:4-18`; issuer interpolation in `infra/api.ts:53-61`.
- **GOTCHA**: Missing/unknown marker must fail SST configuration. Do not use `SST_STAGE` as target config or permit two divergent target resolutions.
- **VALIDATE**: `npm test -- --run infra/config/app.test.ts infra/composition.test.ts`
- **SATISFIES**: AC 2, 4, 6.

### 5. UPDATE `tooling/aws-access.mjs` and `tooling/aws-access.test.ts`

- **IMPLEMENT**: Replace singleton policy with `createAwsEnvironment(target, environment, platform)` and `verifyAwsIdentity(target, spawn, environment, cwd, cliPath?)`. Pin profile/regions/marker, scrub ambient credentials, preserve supplied CA or add Windows fallback, call `sts get-caller-identity --profile <profile> --region <region> --output json`, then compare exact account and full ARN.
- **PATTERN**: absolute CLI resolver `:11-14`; parsing/error order `:37-83`.
- **GOTCHA**: STS confirms identity, not resource-region existence; target/stage validation plus pinned region is the region control. Never log child environment or secrets.
- **VALIDATE**: `npm test -- --run tooling/aws-access.test.ts`
- **SATISFIES**: AC 1, 3, 4, 6.

### 6. UPDATE `tooling/run-sst.mjs` and `tooling/run-sst.test.ts`

- **IMPLEMENT**: Require exactly one `--installation-target`, resolve it with stage, return sanitized `sstArgs`, and preserve command/production restrictions. `diff`/`dev`/`deploy` preflight before spawn; `install` validates locally but skips STS. Send only target marker/control environment to SST.
- **PATTERN**: `NETWORKED_COMMANDS` and spawning behavior at `tooling/run-sst.mjs:10-79`.
- **GOTCHA**: `--installation-target` must never reach SST; no default profile/region or environment target fallback. Tests cover both installation-selector syntaxes, prove zero spawn on parse failure, and only one STS spawn on identity failure.
- **VALIDATE**: `npm test -- --run tooling/run-sst.test.ts tooling/aws-access.test.ts`
- **SATISFIES**: AC 2, 3, 4, 6.

### 7. UPDATE `tooling/run-operator.mjs`, `tooling/run-operator.test.ts`, `tooling/acceptance/release-readiness.mjs`, and relevant tests

- **IMPLEMENT**: Give operator and release invocations an exact `--installation-target`/stage resolver before their STS/shell/Playwright action; propagate only controlled environment. Add `--installation-target` to release arguments and execution boundary, while passing the operator's business `--target` unchanged to its operation script.
- **PATTERN**: operator preflight/spawn `tooling/run-operator.mjs:60-87`; release boundary `tooling/acceptance/release-readiness.mjs:195-217`.
- **GOTCHA**: Operator already uses `--target` for a suspension business option (`tooling/run-operator.test.ts:14-18`). The wrapper contract is therefore **always** `--installation-target`; consume it before spawning SST, and preserve business `--target` in `toolArgs`. Do not rename or reinterpret the business option.
- **VALIDATE**: `npm test -- --run tooling/run-operator.test.ts tooling/acceptance/release-readiness.test.ts`
- **SATISFIES**: AC 3, 4, 6.

### 8. UPDATE `tooling/acceptance/download-metering.mjs` and its tests

- **IMPLEMENT**: Remove its direct `EXPECTED_ACCOUNT`/`EXPECTED_ARN`/profile/region authority. Require `--installation-target` and the resolved shared preflight before its S3/SQS/CloudTrail reads/redrive. If WCU-02-owned regional prefix logic cannot yet be safely threaded, fail execution with a clear WCU-02 prerequisite rather than falling back to Israel constants; retain local dry-run planning.
- **PATTERN**: existing non-production and explicit execute/redrive gates at `:67-140,357-370`.
- **GOTCHA**: Do not rewrite the download matrix or prices in WCU-01.
- **VALIDATE**: `npm test -- --run tooling/acceptance/download-metering.test.ts`
- **SATISFIES**: AC 3, 6.

### 9. UPDATE `AGENTS.md`

- **IMPLEMENT**: Replace the one-account policy at `:20-30` and commands at `:103-110`: reviewed secret-free target registry, explicit target+stage, profile/region pinning, exact STS preflight, no ambient/default fallback, Windows CA behavior, and `dev-rus02` Israel continuity. Add target-qualified examples.
- **GOTCHA**: Do not publish future account/profile values or relax deployment/credential authorization. State `infra:diff` is an AWS read.
- **VALIDATE**: `python tooling/validate_codex_layer.py`
- **SATISFIES**: AC 4, 5.

### 10. RUN local verification only

- **IMPLEMENT**: Execute focused tests, full quality gates, Codex validation, and `git diff --check`; exclude generated SST state, credentials, and unrelated files.
- **GOTCHA**: Do not run direct AWS, `infra:diff`, deploy, `sst dev`, or acceptance `--execute` absent explicit authorization.
- **VALIDATE**: commands below.
- **SATISFIES**: AC 1-6.

---

## TESTING STRATEGY

### Unit Tests

- Registry: legacy continuity, immutable return, missing/unknown target, invalid/duplicate stage, target-stage collision, region override, no environment selection.
- App/composition: provider and Cognito issuer share target region; Israel `dev-rus02` retains current region and production retain/protect stays immutable.
- AWS access: controlled profile/region/CA, stripped ambient static/web identity credentials, absolute CLI argv, malformed/nonzero STS, wrong account, wrong ARN, and no secret logging.
- SST/operator/release: both `--installation-target` syntaxes; duplicate/missing selector; selector excluded from SST args; preflight ordering; zero downstream calls on failure; local install skips STS; operator business `--target` is preserved by regression coverage.
- Metering: AWS execution requires shared target context; local dry run makes no AWS call; no hard-coded Israel fallback.

### Edge Cases

- `dev-rus02` selected with an alternate target/region.
- Ambient `AWS_PROFILE=default`, `AWS_REGION`, `SST_STAGE`, static key variables, or web-identity variables.
- Exact account but wrong ARN, correct ARN but wrong account, unreadable STS JSON.
- Explicit CA bundle versus Windows fallback.
- Production target/stage safety and direct `deploy production`/`dev production` prohibition.

## VALIDATION COMMANDS

```powershell
npm test -- --run infra/config/installation-target.test.ts infra/config/app.test.ts infra/composition.test.ts
npm test -- --run tooling/aws-access.test.ts tooling/run-sst.test.ts tooling/run-operator.test.ts
npm test -- --run tooling/acceptance/download-metering.test.ts tooling/acceptance/release-readiness.test.ts
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run check
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
git diff --check
```

Do not run this without separate owner authorization because it reads AWS:

```powershell
npm run infra:diff -- --installation-target israel --stage dev-rus02
```

## ACCEPTANCE CRITERIA

- [x] Secret-free target registry binds name, account, region, full expected ARN, profile alias, and allowed stages.
- [x] Existing Israel `dev-rus02` keeps its exact app/stage/account/region and Cognito issuer region; it is neither migrated nor deployed.
- [x] Provider and issuer derive from one validated target/stage policy.
- [x] Every AWS-capable entry point requires explicit target/stage, pins profile/region, rejects ambient credential fallback, and completes exact STS preflight first.
- [x] Missing/unknown/duplicate target, wrong account/principal/region, or stage collision fails before AWS/SST work.
- [x] Production retention/protection and external authorization remain intact; AGENTS documents the new safe operation.
- [x] Focused/full local checks pass, with no AWS action in ticket validation.

## OPEN QUESTIONS / ASSUMPTIONS

1. **Target key/stage grammar (resolved for WCU-01):** `israel` binds `dev-rus02`, `dev-plan`, `production`, `dev-israel-<slug>`, and `pr-<number>`. Additional installations must receive disjoint reviewed stage bindings; no Frankfurt target is added.
2. **Future account details:** profile aliases are non-secret, but no Frankfurt account ID/full principal ARN/local alias has been approved. Do not create placeholders.
3. **Wrapper CLI contract (resolved):** every AWS/SST wrapper accepts exactly one `--installation-target <approved-name>` (or `--installation-target=<approved-name>`) plus exactly one `--stage`. `--installation-target` is consumed by the wrapper and never forwarded to SST. The operator's existing business `--target` remains unchanged and is forwarded only to its operation script.
4. **Metering boundary (resolved):** WCU-01 wires the selector and shared identity policy into the existing Israel harness. Execution for any other target fails closed pending WCU-02. Actual regional CloudTrail/rate behavior remains WCU-02 scope.
5. **CI/OIDC:** if CI uses assumed-role session ARNs instead of the current IAM user, define an approved exact role-session matching rule; do not weaken preflight to account-only.

## NOTES

AWS/SST credential precedence makes a merged ambient environment unsafe: environment credentials and `AWS_PROFILE` can override SST config. The wrapper should inherit normal process settings only after deleting auth-source variables, then set the selected profile/region itself. A profile alias is not a credential; keys/tokens remain in local shared credentials or an approved CI identity.

SST states that changing app name, stage, or region creates a new resource namespace/installation. Therefore target identity must be selected deliberately; the existing Israel `dev-rus02` binding is a continuity assertion, not an authorization to inspect or deploy it.

## AMENDMENTS

- Implementation uses `israel` with exact existing `dev-rus02`, `dev-plan`, and `production` bindings, new `dev-israel-<slug>` stages, and Israel-owned `pr-<number>` stages. No future account or principal is fabricated.
- Shared selector parsing lives in `tooling/installation-arguments.mjs` so all wrappers reject duplicate selectors and profile/region/config overrides consistently.
- Existing metering execution remains available for Israel with the shared identity policy; other installations fail closed pending WCU-02. The existing regional constant moves to metering-owned configuration, preserving its value and behavior.
- Release execution now checks the installation in SST outputs. Old outputs without that field are accepted only for existing Israel `dev-rus02` and `dev-plan` stages, preserving continuity without deployment.
- Fresh worktree validation needs the ignored, declaration-only `sst-env.d.ts` files (root and backend/src) copied from the main checkout. No SST state or credentials are copied.
- Review R1 added a strict pre-provider app guard because SST reloads dotenv after wrapper preflight. The guard rejects credential/config-file and endpoint overrides while the later run binding check permits SST-generated credentials. A local test invokes the real app hook after a mocked preflight and simulated dotenv reload.
