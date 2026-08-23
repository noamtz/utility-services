# Reusable Utility Services

Reusable Utility Services is a modular, language-agnostic utility platform. The first MVP utility
will provide invite-only File Management through a React dashboard and `/v1` REST API. The current
implementation includes the TypeScript/SST foundation, RUS-02 owner identity and project control,
RUS-03 project credentials, and the RUS-04 usage/pricing bounded context: an invite-only Cognito
boundary, owner-scoped project and API-key lifecycle operations, reusable project-bearer
authentication, immutable versioned AWS list-price evidence, an append-only idempotent usage
ledger, rebuildable monthly projections, storage checkpoints, and independent metering freshness.
S3/CloudTrail ingestion, File Management routes, dashboard/API usage presentation, and deployment
of RUS-04 remain later or separately authorized work.

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
owner control plane uses one invite-only user pool and secretless client, one control table, seven
JWT-protected project and credential routes, and a no-cache same-origin `v1/control/*` dashboard
behavior; `/v1/health` remains public. Project API keys are server-side bearer secrets, are shown
only by successful issue/replace responses, and must never be placed in browser code, URLs, logs,
repositories, or examples. RUS-04 adds one independent on-demand usage/pricing table with PK/SK,
TTL on retained evidence, and retained immutable price seed items; it adds no route, ingestion
function, bucket, trail, or dashboard behavior. Its local tests cover fixed-point charging,
idempotency, UTC price/month boundaries, projection rebuilds, storage retry semantics, quarantine,
freshness, and project isolation. Infrastructure changes still require the preview and explicit
authorization rules above.

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
