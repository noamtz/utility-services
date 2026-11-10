# Implementation Report — WCU-02 installation-regional pricing and download metering

**Plan**: `.agents/plans/wcu-02-installation-regional-pricing.md`
**Branch**: `feature/wcu-02-regional-pricing`
**Status**: COMPLETE

## Summary

Pricing seed selection now derives from the resolved installation region and fails before resource creation when that region has no complete published rate history. Download metering receives the resolved installation directly, so its CloudTrail trail ARN, log prefix, S3/SQS conditions, Lambda configuration, and read permission use the selected account and region. The public price-version contract now permits a validated AWS-region identifier while retaining strict rate completeness.

## What changed

- UPDATE `packages/contracts/src/usage-pricing/contract.ts` — regional public price-version validation.
- UPDATE `infra/config/usage-pricing.ts` and `infra/usage-pricing.ts` — immutable regional histories and fail-closed selection.
- UPDATE `infra/config/download-metering.ts`, `infra/download-metering.ts`, and `sst.config.ts` — resolved installation identity through metering and pricing resource factories.
- UPDATE focused tests — Israel continuity, Frankfurt fixture rates/logs, wrong-region rejection, and target-derived resource configuration.

## Tests added

- `infra/config/usage-pricing.test.ts` verifies Israel and Frankfurt histories and rejects an unconfigured region.
- `infra/config/download-metering.test.ts` verifies the regional CloudTrail prefix for both account/region fixtures.
- `packages/contracts/src/usage-pricing/contract.test.ts` verifies a Frankfurt public price version.
- `packages/backend/src/modules/usage-pricing/cloudtrail-log.test.ts` verifies Frankfurt event acceptance and Israel event quarantine under the Frankfurt target.

## Validation results

- Focused usage-pricing and metering suite: PASS — 6 files, 35 tests.
- Full test suite: PASS — 114 files, 690 tests.
- Changed-file Prettier check: PASS.
- Changed-file ESLint: PASS.
- Full typecheck: constrained by missing generated SST `Resource` declarations in the fresh worktree; failures are pre-existing references in File Management, identity/control, and metering runtime. No WCU-02 type error was reported.
- Full lint: constrained because the preserved local incomplete dependency directory caused ESLint to traverse nonproject files. The changed-file lint command passed. The directory is local-only and excluded from the commit.

## Deviations from the plan

- The temporary local dependency directory from interrupted installs was retained as a hidden, ignored path so it could not be staged. This affected full repository traversal only; no tracked project source changed as a result.
- No `infra:diff`, AWS read, deployment, target registry change, or download-pricing-mode change was performed.

## Issues encountered

- Fresh worktree dependencies needed a serial reinstall after concurrent `npm ci` attempts left a locked partial directory.
