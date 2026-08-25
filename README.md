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
tests/e2e                      Future assembled user journeys
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
