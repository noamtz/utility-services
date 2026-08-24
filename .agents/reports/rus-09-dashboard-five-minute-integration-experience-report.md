# Implementation Report — RUS-09 dashboard and five-minute integration experience

**Plan**: `.agents/plans/rus-09-dashboard-five-minute-integration-experience.md`  
**Branch**: `feature/rus-09-dashboard-five-minute-integration`  
**Status**: COMPLETE

## Summary

Implemented the selected-project dashboard experience for project API-key lifecycle, current-month
AWS-equivalent usage, and a copyable server-side File Management walkthrough. Added a narrow
Cognito-owner usage route that resolves ownership before querying the existing usage projection,
plus SST wiring for query-only control/usage access and the public API base URL. The dashboard never
uses a project API key for File Management calls; customer servers request presigned URLs and pass
only those temporary URLs to their clients.

## Tasks completed

- Added the strict current-month response envelope and exports →
  `packages/contracts/src/usage-pricing/contract.ts` (UPDATE)
- Added UTC period/freshness policy, owner isolation service, handler, runtime, and Lambda entrypoint
  → `packages/backend/src/modules/identity-control/usage/` and
  `packages/backend/src/functions/control/get-current-month-usage.ts` (CREATE)
- Added the JWT route, query-only table links, and dashboard `VITE_API_URL` → `infra/api.ts`,
  `infra/config/usage-pricing.ts`, and `infra/dashboard.ts` (UPDATE)
- Extracted reusable Cognito control-request handling and refactored project calls →
  `apps/dashboard/src/api/control-client.ts` and `apps/dashboard/src/projects/api.ts`
  (CREATE/UPDATE)
- Added paginated issue/list/revoke/replace UI with ephemeral one-time secret reveal and clipboard
  feedback → `apps/dashboard/src/credentials/` and `apps/dashboard/src/shared/CopyButton.tsx`
  (CREATE)
- Added current-month total, five-metric breakdown, pricing/freshness evidence, and refresh UI →
  `apps/dashboard/src/usage/` (CREATE)
- Added the complete server-side curl flow for upload authorization/direct PUT, list/inspect,
  private download/direct GET, stable public access, trash, restore, and guarded force delete →
  `apps/dashboard/src/integration/IntegrationGuide.tsx` (CREATE)
- Composed the project experience, settings guidance, responsive styles, public configuration, and
  architecture-boundary documentation → `apps/dashboard/src/`, `README.md` (UPDATE)

## Tests added

- Contract, policy, service, handler, and owner-isolation integration coverage for the usage view.
- Control client, credential adapter/lifecycle panel, clipboard, usage adapter/panel, integration
  guide, and selected-project journey coverage for the dashboard.
- Infrastructure descriptor/composition coverage for the JWT route, public API URL, and unchanged
  narrow control forwarding.
- Full instrumented suite: **91 files, 528 tests passed**.

## Validation results

- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed.
- Focused Node and dashboard suites — passed.
- `npm test` — passed; the final instrumented all-project run passed 528/528 tests.
- `npm run test:coverage` — passed: statements 86.35%, branches 80.08%, functions 91.59%, lines
  89.01%.
- `npm run build` — passed; Vite transformed 710 modules.
- `npm run check` — passed once end to end. A later repeat after a one-line runtime correction hit
  the existing `SignInForm` five-second instrumentation timeout; its immediate full coverage retry
  passed 528/528, and format, lint, typecheck, coverage, and build all passed on the final code.
- `npm run infra:diff -- --stage dev-rus02` — passed after exact identity verification as account
  `162067902192`, principal `arn:aws:iam::162067902192:user/ntz-cli`. Preview showed the intended
  route/function, query-only IAM for the control and usage tables, and `VITE_API_URL`; there were no
  non-asset resource replacements or deletions. No deployment was run.
- `python tooling/validate_codex_layer.py` and codebase-search self-test — passed.
- `git diff --check` — passed.

## Deviations from the plan

- `npm run infra:install -- --stage dev-rus02` twice returned SST's generic unexpected-error result
  because its telemetry hostname could not resolve in the environment. Existing generated provider
  artifacts were usable, and the wrapper-controlled AWS diff completed successfully and regenerated
  the relevant function/dashboard builds. No deployment or AWS mutation was attempted.
- No product, security, API-contract, or architecture scope deviations.

## Issues encountered

- SST telemetry DNS resolution made the optional local provider refresh report failure, as noted
  above.
- The existing Cognito new-password dashboard test intermittently exceeded its five-second timeout
  only during highly parallel coverage instrumentation. Retry passed without implementation changes.

## Ready for the next step

The implementation is complete and locally validated. Next: run `piv-commit`, then `piv-create-pr`,
then `piv-review-pr` when ready.
