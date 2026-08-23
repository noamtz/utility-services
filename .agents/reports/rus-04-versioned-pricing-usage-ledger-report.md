# Implementation Report — RUS-04 Versioned Pricing and Usage Ledger

**Plan**: `.agents/plans/rus-04-versioned-pricing-usage-ledger.md`
**Branch**: `feature/rus-04-versioned-pricing-usage-ledger`
**Status**: COMPLETE LOCALLY — SHARED-STAGE PREVIEW GATE OPEN

## Summary

Implemented the independent usage/pricing bounded context: strict shared contracts, exact bigint fixed-point charging, occurrence-time immutable price selection, append-only/idempotent usage evidence, rebuildable monthly aggregates, deterministic byte-time storage checkpoints, safe quarantine, and independent metering freshness. SST composition now defines one retained on-demand usage/pricing table and one immutable versioned price seed without adding an API route, Lambda ingestion function, bucket, trail, dashboard behavior, or deployment.

The complete local validation suite passes. The mandatory `dev-rus02` preview also ran successfully through the pinned identity wrapper, but the stage is behind the repository: its diff includes already-merged RUS-03 API-key routes and routine existing asset refreshes in addition to the RUS-04 table/seed. Therefore the plan's narrow-preview acceptance condition is not satisfied against current shared-stage state, and deployment remains unauthorized.

## Tasks completed

- Strict public metric, price, projection, exclusions, and freshness contracts → `packages/contracts/src/usage-pricing/` and `packages/contracts/src/index.ts` (CREATE/UPDATE)
- Atto-USD fixed-point parsing, arithmetic, rounding, formatting, DynamoDB 38-digit guard, and SDK bigint conversion → `packages/backend/src/modules/usage-pricing/fixed-point.ts` (CREATE)
- Inclusive occurrence-time price selection and exact request, event, transfer, and storage calculation → `packages/backend/src/modules/usage-pricing/pricing.ts` (CREATE)
- Current provenance-rich `il-central-1` price snapshot, append-only validation, and DynamoDB seed conversion → `infra/config/usage-pricing.ts` (CREATE)
- Neutral one-time query-only Dynamo link configuration → `infra/dynamo-link.ts`, `infra/control.ts` (CREATE/UPDATE)
- Retained/PITR/on-demand table composition, TTL, production protection, and immutable provider seed → `infra/usage-pricing.ts`, `infra/sst-globals.d.ts`, `sst.config.ts`, `infra/composition.test.ts` (CREATE/UPDATE)
- Strict stored-item families, canonical keys/hashes/fingerprints, and calendar retention → `packages/backend/src/modules/usage-pricing/model.ts` (CREATE)
- Strong effective-price/event/projection/checkpoint/watermark reads and transactional idempotency/rebuild semantics → `packages/backend/src/modules/usage-pricing/repository.ts` (CREATE)
- Deterministic half-open storage interval splitting across UTC month and price boundaries → `packages/backend/src/modules/usage-pricing/storage.ts` (CREATE)
- Trusted internal recording, checkpoint orchestration, projection/rebuild, quarantine, and freshness services → `packages/backend/src/modules/usage-pricing/service.ts` (CREATE)
- Assembled project-isolated ledger/rebuild/storage/quarantine proof → `tests/integration/usage-pricing-ledger.test.ts` (CREATE)
- Truthful repository/architecture status → `README.md`, `AGENTS.md` (UPDATE)

## Price evidence

The current official public bulk offers were re-read on 2026-08-23 and captured with publication/effective times, SKU, rate code, unit/range, exact decimal price, URL, version, and SHA-256 content digest:

- Amazon S3 publication `2026-08-18T18:11:13Z`, offer version `20260818181113`, SHA-256 `db4d624b864898103444dfbed7af76beb33087195d6814331f1ece6e58a97b32`: Standard storage `$0.025/GB-Mo`, upload requests `$0.0055/1000`, and download requests `$0.0044/10000` in the first applicable `il-central-1` ranges.
- AWS Data Transfer publication `2026-07-20T18:46:45Z`, offer version `20260720184645`, SHA-256 `31d6c55839cd94cab241375e6fea959bdfe393e642232de46f8d796c4159e9f4`: Israel outbound transfer `$0.110/GB` in the first 10 TB range.
- AWS CloudTrail publication `2026-07-16T21:50:01Z`, offer version `20260716215001`, SHA-256 `5851b806e3e44358a2a676e678e905b51dd85a9bc872d41e253fb75604a9b488`: data events `$0.10/100000` in `il-central-1`.

The immutable configured version is `aws-il-central-1-2026-08-01`. Service pricing pages independently agreed with the selected dimensions. No historical price version existed to edit or remove.

## Tests added

- Added contract, fixed-point, pricing, configuration, infrastructure, model, repository, storage, service, and assembled integration tests.
- Full regression: 51 files and 311 tests passed.
- Coverage: 87.31% statements, 81.48% branches, 92.62% functions, and 89.91% lines; every global 80% threshold passed.
- Direct assertions cover durable duplicates/divergent sources, occurrence-time price boundaries, fractional normalization and half-up rounding, overflow, UTC month/rate splitting, checkpoint crash/retry, aggregate rebuild/races, TTL lag, quarantine/freshness precedence, project isolation, and public-projection leak resistance.

## Validation results

- All plan-targeted unit and assembled integration commands — PASS
- `npm run format:check` — PASS
- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm test` — PASS, 311/311 tests
- `npm run test:coverage` — PASS, all thresholds above 80%
- `npm run build` — PASS, dashboard production build completed
- `npm run check` — PASS after provider artifact regeneration
- `python tooling/validate_codex_layer.py` — PASS, 31 skills and 6 custom agents
- `uv run --script tooling/mcp/codebase_search.py --self-test` — PASS
- `git diff --check` — PASS
- `npm run infra:install -- --stage dev-rus02` — PASS
- `npm run infra:diff -- --stage dev-rus02` — EXECUTED/PREVIEW-ONLY through `tooling/run-sst.mjs`; the wrapper accepted only the required `ntz-cli` identity, account `162067902192`, principal ARN, `il-central-1`, and Windows CA configuration.

## Infrastructure preview evidence

The physical RUS-04 additions are exactly one `aws:dynamodb/table:Table` and one retained `aws:dynamodb/tableItem:TableItem`. The table preview has `pk`/`sk`, PAY_PER_REQUEST, PITR, TTL on `expiresAt`, no GSI, and `il-central-1`; the item is the one configured immutable price version.

The complete shared-stage preview is broader because `dev-rus02` predates other already-merged repository work:

- Four RUS-03 API-key lifecycle routes propose their expected Lambda/IAM/log-group/API integration resources.
- Four existing Lambdas and dashboard assets propose ordinary code/static refreshes.
- Delete-replaced operations are limited to eight retained SST deployment code/sourcemap objects and the local dashboard builder command.
- No DynamoDB table, Cognito resource, API resource, Lambda function, or project data proposes replacement/deletion.

This preview evidence is not deployment approval. No deploy, table/item write, credential creation, synthetic live event, or other AWS mutation was performed.

## Deviations from the plan

- AWS owns the Israel outbound transfer dimension in the `AWSDataTransfer` public offer rather than the `AmazonS3` offer. The implementation records that authoritative service code/source instead of misattributing the SKU while retaining the approved S3 outbound-bytes metric.
- Task 17's narrow shared-stage diff expectation could not pass because `dev-rus02` is behind the merged RUS-03/application baseline. The RUS-04-only composition remains isolated in code and tests, but an owner-approved baseline synchronization or separately reviewed combined deployment is required before deployment can be considered.
- No GitHub wiki/issue write was made because no approved product or architecture decision changed and external writes were outside this implementation request.

## Issues encountered

- The first full-coverage attempt saw two existing dashboard form timeouts under parallel test load. The focused form suite passed, and two subsequent exact `npm run check` executions completed with all 311 tests passing.
- SST's raw JSON preview contains logical component duplicates and full asset state. It was reduced in memory to a secret-free provider operation summary; no preview output or temporary summarizer remains in the worktree.
- `AGENTS.md` changed as planned. Restart Codex before the next session so the updated instruction chain is rebuilt.
