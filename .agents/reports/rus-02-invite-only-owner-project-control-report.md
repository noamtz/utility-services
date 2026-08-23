# Implementation Report — RUS-02 Invite-Only Owner Identity and Project Control

**Plan**: `.agents/plans/rus-02-invite-only-owner-project-control.md`  
**Branch**: `feature/rus-02-owner-project-control`  
**Status**: COMPLETE

## Summary

Implemented the RUS-02 identity/control vertical slice: invite-only Cognito composition, JWT-protected owner project routes, an owner-scoped DynamoDB model and repository, strict shared contracts, and an authenticated React project dashboard. Automated security coverage proves access-token claim enforcement, public-response secrecy, caller-override rejection, pagination, and indistinguishable missing/wrong-owner inspection. All local, Codex-layer, generated-provider, authenticated preview, deployment, and unauthenticated live-boundary gates pass under the repository's exact AWS account/principal guard.

## Tasks completed

- Added exact Amplify, AWS SDK, and SST runtime dependencies and regenerated `package-lock.json`.
- Created strict project contracts and exports in `packages/contracts/src/projects/contract.ts` and `packages/contracts/src/index.ts`.
- Extended the shared handler with derived authorization context and configurable successful status codes in `packages/backend/src/core/http/handler.ts`.
- Created Cognito owner extraction under `packages/backend/src/modules/identity-control/auth`.
- Created project IDs, cursor, model, DynamoDB repository, service, handlers, runtime, and thin function entries under `packages/backend/src/modules/identity-control/projects` and `packages/backend/src/functions/control`.
- Created invite-only Cognito, control-table, JWT authorizer, protected route, least-privilege link, and same-origin no-cache CloudFront composition in `infra/control.ts`, `infra/api.ts`, `infra/dashboard.ts`, and `sst.config.ts`.
- Created dashboard configuration, Amplify auth adapter/provider, sign-in/new-password flow, project API adapter, and create/list/inspect UI under `apps/dashboard/src`.
- Added cross-boundary owner isolation coverage in `tests/integration/owner-project-control.test.ts` and enabled root test discovery/type-checking.
- Updated `README.md` and `AGENTS.md` to reflect the implemented structure and separately authorized live-auth workflow.
- Added durable AWS account/profile/CA-bundle continuity rules to `AGENTS.md` and an exact STS identity preflight to `tooling/run-sst.mjs`; the reactive analysis is preserved in `.agents/reports/opportunity-scan-rus-02-aws-continuity.html`.
- Disabled SST's default hosted-UI OAuth flows and placeholder callback URL on the secretless Cognito SPA client after inspecting the generated preview.

## Tests added

- Added contract tests for strictness, defaults, bounds, identifiers, cursors, and public shapes.
- Added HTTP/auth tests for trusted authorization derivation, access-token-only subjects, safe errors, and log secrecy.
- Added project model, ID, cursor, repository, service, and handler tests for transactional creation, owner-index queries, consistent inspection, collision handling, corrupt records, and wrong-owner denial.
- Added infrastructure policy/composition tests for invite-only Cognito, secretless client, on-demand/protected data, route authorization, public health, and the narrow no-cache dashboard behavior.
- Added 10 dashboard test files covering configuration, session restoration, sign-in, required-new-password, sign-out, API token injection, strict response parsing, project form bounds, pagination, selection, and public-only details.
- Added an assembled two-owner integration test covering repeated creates, defaults, 1/60 lifetime edges, pagination, trusted-claim precedence, cross-owner inspection, malformed inputs/cursors, missing auth, ID-token rejection, and serialized secrecy.
- Results after review remediation and deployment hardening: 29 test files and 170 tests pass. Coverage is 88.66% statements, 85.91% branches, 89.39% functions, and 89.91% lines.

## Validation results

- `npm run format:check` — PASS
- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm test -- --project node` — PASS, 136 tests
- `npm test -- --project dashboard` — PASS, 29 tests
- `npm run test:coverage` — PASS, all global 80% thresholds exceeded
- `npm test -- --project node tests/integration/owner-project-control.test.ts` — PASS, 2 tests
- `npm run build` — PASS
- `npm run check` — PASS
- `python tooling/validate_codex_layer.py` — PASS, 31 skills and 6 custom agents
- `uv run --script tooling/mcp/codebase_search.py --self-test` — PASS
- `npm run infra:install -- --stage dev-rus02` — PASS
- `npm run infra:diff -- --stage dev-rus02` — PASS under `arn:aws:iam::162067902192:user/ntz-cli`; preview contains the invite-only pool, secretless non-OAuth client, PAY_PER_REQUEST control table, one JWT authorizer, three protected control-route components, public health route, and dashboard composition
- `npm run infra:deploy -- --stage dev-rus02` — PASS under `arn:aws:iam::162067902192:user/ntz-cli`
- Live API health and dashboard availability — PASS, both return HTTP 200
- Live unauthenticated control-route checks — PASS, API Gateway and the CloudFront same-origin route both return HTTP 401
- Live invited-user Cognito and two-owner isolation checks — NOT RUN; no users or credentials were created

## Deviations from the plan

- The plan relied on ambient AWS authentication. The wrapper now pins the previously established `ntz-cli` profile, `il-central-1`, and Windows AWS CLI CA bundle, and verifies the exact account and principal before every networked SST operation. This prevents session-to-session context loss and wrong-account fallback.
- SST's client component defaulted to hosted-UI OAuth flows and `https://example.com` callback metadata. The client transform now explicitly disables OAuth and removes callbacks/scopes, matching the plan's SRP-only, no-hosted-UI boundary.
- A Windows `npm ci` cleanup hit repeated `EBUSY` locks. The stale pre-install `node_modules` tree was moved outside the repository to `C:\tmp\utility-services-node-modules-stale-20260823`, after which clean lockfile installation succeeded. Repository dependency state and validations use the newly installed tree.
- Deployment and unauthenticated smoke validation were completed only after the owner explicitly expanded authorization. Cognito user creation and credential-backed live validation remain outside the granted scope.

## Issues encountered

- The first preview used an expired unrelated `default` profile. Historical run evidence showed the correct profile also requires the AWS CLI CA bundle; applying that established configuration restored `ntz-cli` access and the wrapper now enforces it.
- A fresh preview exposed an incorrect `$aws` runtime global; the composition now uses SST's generated `aws` provider global and has direct composition coverage.
- The first two deployment attempts exposed CloudFront service constraints that preview did not reject: disabled caching cannot also forward values in the cache policy, and forwarding `POST` requires CloudFront's full seven-method set. The final design uses a zero-TTL cache policy, a narrow origin request policy, and only the three explicit API Gateway application routes.
- The out-of-repository stale dependency directory remains because automated cleanup was blocked by command policy; it is not used by the workspace and may be removed manually after confirming no process needs it.

## Ready for the next step

PR #14 contains the implementation, review remediation, and deployment hardening. The remaining live acceptance step is separately authorized disposable invited-user validation of the new-password flow and two-owner isolation.

## Deployment follow-up — 2026-08-23

- Stage: `dev-rus02` in account `162067902192`, region `il-central-1`
- API: `https://ua7h10a114.execute-api.il-central-1.amazonaws.com`
- Dashboard: `https://d3pun221ouy8ce.cloudfront.net`
- Public health: HTTP 200 with the expected safe health envelope
- Dashboard root: HTTP 200
- Protected project list without a token: HTTP 401 directly and through CloudFront
- Production was not changed, and no Cognito users or credentials were created.
