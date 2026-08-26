# Reusable Utility Services

Reusable Utility Services is a modular, language-agnostic utility platform. The first MVP utility
will provide invite-only File Management through a React dashboard and `/v1` REST API. The current
implementation includes the TypeScript/SST foundation, owner identity and project control, project
credentials, direct File Management transfers, and the usage/pricing bounded context. Download
metering now has a source-controlled, evidence-first CloudTrail ingestion and reconciliation path;
its initial `evidence-only` gate intentionally records no download cost. A separately authorized
non-production deployment and real transfer-semantics exercise remain required before any reviewed
switch to priced download metering. The dashboard now includes project credential management,
current-month usage presentation, and a copyable server-side File Management integration guide.

The [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic),
[Architecture](https://github.com/noamtz/utility-services/wiki/Architecture), and
[MVP Ticket Breakdown](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown) in the
GitHub wiki are canonical.

## Repository layout

```text
apps/dashboard                 React/Vite invite-only auth and project-control UI
packages/contracts             Browser/Node-compatible HTTP, control, auth, and usage/pricing contracts
packages/backend/src/core      Universal Lambda HTTP and observability foundations
packages/backend/src/functions Thin deployed function entry points
packages/backend/src/modules   Identity/control, project-authentication, and usage/pricing slices
infra                          SST identity/control, independent usage table/seeds, API, and dashboard
tests/integration              Behavior crossing packages or slices
tests/e2e                      Guarded deployed release-readiness journey and support helpers
```

## Local quick start

Prerequisites are Node.js 24 and npm 11. Install exactly from the committed lockfile. For a local UI
preview, provide syntactically valid public Cognito identifiers in an untracked `.env.local`, then
start Vite:

```dotenv
VITE_COGNITO_USER_POOL_ID=il-central-1_LocalPreview
VITE_COGNITO_USER_POOL_CLIENT_ID=0123456789abcdefghijklmnop
VITE_API_URL=https://api.example.com
```

```powershell
npm ci
npm run dev
```

The local preview does not evaluate SST configuration or create AWS resources. Placeholder IDs let
the signed-out UI render, but authentication cannot succeed. Live sign-in requires a separately
authorized deployed non-production stage and an administrator-created Cognito user. Public
self-registration is disabled; invitation creation is an external operator action and is not
automated by this repository. Run the local quality suite with:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run check
```

## SST stages and previews

Every config-evaluating SST command goes through `tooling/run-sst.mjs` and requires exactly one
explicit stage:

- `production`
- `pr-<positive-integer>`, such as `pr-12`
- `dev-<lowercase-slug>`, such as `dev-noam`

Networked SST commands are pinned to AWS CLI profile `ntz-cli`, account `162067902192`, and region
`il-central-1`. On Windows the wrapper also supplies the installed AWS CLI CA bundle, then verifies
the exact `ntz-cli` caller identity before `diff`, `dev`, or `deploy`; it will not fall back to
another local profile. Credential values remain only in the local AWS shared credentials file.

Generate the ignored local provider declarations after installation or a provider change:

```powershell
npm run infra:install -- --stage dev-noam
```

Preview a non-production stage without deploying:

```powershell
npm run infra:diff -- --stage dev-noam
```

After explicit owner authorization and a successful preview, deploy that same non-production stage:

```powershell
npm run infra:deploy -- --stage dev-noam
```

> [!WARNING]
> `infra:diff` requires valid AWS credentials and is preview-only. If SST requests remote bootstrap
> or another external write, stop and obtain owner authorization. `infra:deploy`, `sst dev`, AWS
> resource changes, credential creation, and remote Git/GitHub changes require explicit owner
> authorization. Production deployment is intentionally rejected by the RUS-01 wrapper. Do not
> bypass the stage wrapper.

The provider installation regenerates `.sst/platform` locally from pinned `sst@4.17.1` and
`@pulumi/aws@7.43.0`; generated SST files are intentionally ignored. A successful non-production
`infra:diff` is the infrastructure-composition gate and never substitutes for a deployment. The
owner control plane uses one invite-only user pool and secretless client, one control table, eight
JWT-protected project, credential, and usage routes, and a no-cache same-origin `v1/control/*` dashboard
behavior; `/v1/health` remains public. Project API keys are server-side bearer secrets, are shown
only by successful issue/replace responses, and must never be placed in browser code, URLs, logs,
repositories, or examples. The independent usage/pricing table retains immutable price evidence,
append-only usage events, rebuildable monthly projections, quarantine, and freshness state.
Infrastructure changes still require the preview and explicit authorization rules above.

## Service protection and operator controls

Every authenticated File Management control operation shares one fixed-window quota per project:
60 requests per UTC minute across all six private `/v1/files` routes and across every active key for
that project. A rejected 61st request returns `429 RATE_LIMIT_EXCEEDED` with `Retry-After`; another
project has an independent counter. Invalid credentials and the stable-public redirect route do not
consume project quota.

Project and individual-key suspension are operator-only controls; there is no public suspension
API. Both operator workflows resolve linked resources through the pinned SST shell and are dry-run
by default. They still require the exact AWS identity preflight, an explicit stage, and separate
authorization before applying a mutation:

```powershell
npm run ops:suspension -- --stage dev-rus02 --target project --project-id <project-id> --action suspend
npm run ops:suspension -- --stage dev-rus02 --target project --project-id <project-id> --action suspend --apply --confirm APPLY:dev-rus02:project:suspend

npm run ops:backfill-watermarks -- --stage dev-rus02
npm run ops:backfill-watermarks -- --stage dev-rus02 --apply --confirm APPLY:dev-rus02:watermark-index
```

Never run either apply form without explicit owner authorization. Suspension blocks fresh private
authorization and stable-public redirects, but cannot revoke a presigned S3 URL that was already
issued; that URL remains usable until its short expiry. An authorization already in flight can race
the suspension transition. Resuming a project does not silently reactivate a separately suspended,
revoked, or replaced key.

Structured logging performs final-boundary recursive redaction of bearer material, signatures,
credentials, and presigned query parameters. Operational metrics use only stage, operation, and
outcome dimensions. File upload completion has two Lambda retries and a shared encrypted 14-day
file-operations DLQ; reconciliation and purge use the same queue after two EventBridge attempts.
Download metering retains its encrypted queue, five receives, 360-second visibility, batch size one,
and encrypted 14-day DLQ. Poison evidence is quarantined and acknowledged, while transient failures
are rethrown for retry.

Production alone creates the encrypted alert topic and CloudWatch alarms for authentication,
limiting, API/Lambda failures, unexpected API volume, worker failures, quarantine, queue age, both
DLQs, and stale/incomplete/failed freshness checks. The repository intentionally creates no SNS
subscription: an operator must add and verify a destination after deployment before alerts can be
delivered. Non-production stages still emit logs and metrics without alert resources.

The usage table's sparse watermark index supports scan-free five-minute freshness checks at the
existing 24-hour threshold. Legacy watermark rows are invisible to that index until the guarded
backfill is explicitly authorized and applied; its dry-run reports aggregate source counts only.
Do not trust production freshness alarms for historical rows until that prerequisite is completed.

## Download metering and reconciliation

Successful direct S3 downloads are observed asynchronously. A narrow regional CloudTrail selector
captures only in-scope `GetObject` data events. Compressed logs enter a separate private bucket,
whose filtered notifications pass through an encrypted SQS queue and bounded processor; exhausted
transient failures remain recoverable in a 14-day dead-letter queue. The processor validates each
record independently, derives project/file identity from the canonical object key, validates actual
transferred bytes, and stores deterministic evidence or quarantine without logging raw records,
keys, URLs, or secrets.

Raw CloudTrail logs and processed/quarantine evidence are retained for 90 days. Usage-ledger detail
is retained for 14 months, while monthly aggregates remain indefinitely. Delivery is at least once
and eventually consistent: exact retained log keys can be replayed idempotently, affected monthly
projections are rebuilt from immutable events, and unresolved known-project quarantine keeps
metering freshness incomplete.

The source-controlled gate defaults to `evidence-only`; accepted download evidence is deduplicated
but creates no priced ledger entries and does not advance priced freshness. Non-zero pricing is
eligible only after an explicitly authorized non-production deployment passes the full, range,
cancelled, repeated, expired-or-failed, and unused transfer matrix, exact-key replay, queue/DLQ, and
deduplication checks. Failure leaves the gate unchanged and raises the documented CloudFront
fallback for an owner decision. A pass still requires a separate reviewed source change, preview,
and deployment authorization; the harness never flips the gate.

The operator harness is dry-run by default and requires explicit non-production resource inputs.
Supply the disposable server-side project key only through the environment when execution has been
authorized:

```powershell
$env:DOWNLOAD_METERING_PROJECT_KEY = '<disposable-server-side-key>'
npm run acceptance:download-metering -- --stage dev-rus02 --api-url <https-api-url> --file-id <file-id> --log-bucket <log-bucket> --processor-function <processor-function> --main-queue-url <https-main-queue-url> --dlq-url <https-dlq-url>
```

Add `--execute` only for the authorized transfer exercise. After inspecting and correcting a
terminal failure, redrive additionally requires `--redrive --redrive-authorized --dlq-arn
<dead-letter-queue-arn>`. The harness performs the exact AWS identity preflight and emits only a
redacted, machine-readable decision summary.

The eventual dashboard value is **AWS-equivalent usage cost**: published list-rate attribution for
project activity, excluding free tiers, discounts, credits, taxes, and shared infrastructure. It is
not an allocation of the AWS invoice.

## Release-readiness acceptance

The RUS-11 Playwright journey is separate from Vitest and targets only an explicitly authorized,
already-deployed non-production stage. Test discovery is local and performs no network request:

```powershell
npm exec -- playwright install chromium
npm run test:e2e:list
```

The operator harness is also dry-run by default. It validates the stage and HTTPS origins, reports
the intended cases, and neither checks AWS identity nor launches a browser without `--execute`:

```powershell
npm run acceptance:release -- --stage dev-rus11-e2e --dashboard-url https://dashboard.example.com --api-url https://api.example.com
```

Execute mode additionally requires the ignored `.sst/outputs.json` produced by the successful
deployment of that exact stage. Its `stage`, `dashboardUrl`, and `apiUrl` values must exactly match
the confirmed command; a stale stage or manually mistyped endpoint is rejected before AWS
preflight or browser startup. Never copy this generated output into source control or substitute
another stage's endpoints.

Live execution is destructive test work and requires separate owner authorization, a deployed
stage with no concurrent run, and two distinct invited Cognito owners. Put credentials only in the
following process environment variables; never add their values to argv, repository files, issue
comments, screenshots, traces, or reports:

```powershell
$env:RUS_RELEASE_OWNER_A_EMAIL = '<owner-a-email>'
$env:RUS_RELEASE_OWNER_A_PASSWORD = '<owner-a-password>'
$env:RUS_RELEASE_OWNER_B_EMAIL = '<owner-b-email>'
$env:RUS_RELEASE_OWNER_B_PASSWORD = '<owner-b-password>'

npm run acceptance:release -- --stage dev-rus11-e2e --dashboard-url https://dashboard.example.com --api-url https://api.example.com --execute --confirm-stage dev-rus11-e2e
```

For an owner's first Cognito login, set the matching optional
`RUS_RELEASE_OWNER_A_NEW_PASSWORD` or `RUS_RELEASE_OWNER_B_NEW_PASSWORD`; doing so changes that
account's password. The harness verifies the exact approved AWS identity through the trusted
absolute AWS CLI path using an environment that contains no owner credentials. Only the validated
Playwright child receives those credentials. The journey disables retries and all Playwright
screenshots/video/traces, keeps API keys and presigned URLs in memory only, and emits a
bounded secret-free result containing only the decision, sanitized stage, timestamp, activation
seconds, case names/status counts, project-residue flag, and pending external gate names. It
waits until disposable files are purged or absent and revokes issued keys, but project records
remain because project deletion is out of scope. A passing journey proves the assembled
dashboard/API/direct-S3 path and activation time under five minutes; it does not prove the separate
CloudTrail transfer matrix, production alert delivery, or two-human product experiment.

The default expiry timeout is seven minutes. This covers the disposable project's one-minute
upload capability plus the five-minute deletion safety skew; lowering it can make a valid
`purge-pending` response outlive the acceptance bound.

For the separately observed human experiment, start a monotonic timer when the one-time key is
available and stop only after the first upload has completed and the downloaded bytes have been
received. The canonical guide's curl calls can expose duration without exposing response material
by adding `--output <local-disposable-path> --write-out 'time_total=%{time_total}\n'`; never paste
the command after substituting a real key or signed URL. The combined activation interval, not only
curl's transfer duration, must remain under five minutes.

The acceptance runner and deployed Playwright spec are intentionally outside the global Vitest
coverage denominator, matching the existing download-metering acceptance executable. Their guard,
redaction, result-validation, and failure behavior are covered by deterministic Vitest policy
tests; the application and infrastructure coverage threshold remains 80% in every category.

## Dashboard integration boundary

Cognito authenticates an invited owner to the dashboard, where the owner can see only owned
projects, manage project API keys, and read the selected project's current-month usage. Project API
keys authenticate the consuming application's server—not dashboard or end-client code—and establish
the project boundary for authorization, quotas, and usage attribution. A newly issued key is shown
once and should be moved immediately to the server's secret manager.

The selected-project guide provides the canonical `curl` sequence. The application server requests
upload and download authorizations from `/v1/files`, then gives clients only the complete opaque,
temporary presigned URLs. File bytes transfer directly with S3 and never pass through the dashboard,
API Gateway, or Lambda. Presigning authorizes S3 access but does not bypass browser CORS; browser
cross-origin transfers require a separately approved bucket-origin policy. Current download
metering remains evidence-only until its acceptance gate is passed, so the dashboard surfaces the
projection's freshness state rather than implying that all evidence is already priced.

## Codex project setup

The repository retains its project-scoped Codex setup: `AGENTS.md`, repo skills, custom agents,
hooks, a read-only codebase-search MCP server, and optional Archon workflows.

1. Open the repository as a trusted project in Codex.
2. Restart Codex so it discovers `AGENTS.md`, `.agents/skills`, `.codex/config.toml`, and
   `.codex/agents`.
3. Open `/hooks`, review the project hook definitions, and trust them if their scripts match your
   policy.
4. Run `codex mcp list` and confirm `codebase-search` is enabled. It requires `uv` and installs its
   script dependencies on first launch.
5. Validate the AI layer:

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

Skills are invoked with `$skill-name`, for example `$prime-codebase` or
`$piv-plan-implementation`. The `posthog-analyst` agent requires a separately configured PostHog
MCP server and credential environment; that credential configuration is intentionally not
committed. Validate optional Archon workflows with `archon validate workflows` when Archon is
installed.
