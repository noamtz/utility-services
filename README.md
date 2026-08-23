# Reusable Utility Services

Reusable Utility Services is a modular, language-agnostic utility platform. The first MVP utility
will provide invite-only File Management through a React dashboard and `/v1` REST API. RUS-01
establishes the deployable TypeScript/SST foundation, shared runtime contracts, a public health
route, and an accessible dashboard shell; identity, project credentials, file behavior, and usage
metering belong to later tickets.

The [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic),
[Architecture](https://github.com/noamtz/utility-services/wiki/Architecture), and
[MVP Ticket Breakdown](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown) in the
GitHub wiki are canonical.

## Repository layout

```text
apps/dashboard                 React/Vite dashboard composition and UI behavior
packages/contracts             Browser/Node-compatible Zod runtime contracts
packages/backend/src/core      Universal Lambda HTTP and observability foundations
packages/backend/src/functions Thin deployed function entry points
packages/backend/src/modules   Future cohesive bounded-context slices
infra                          One SST application and stage/resource composition
tests/integration              Future behavior crossing packages or slices
tests/e2e                      Future assembled user journeys
```

## Local quick start

Prerequisites are Node.js 24 and npm 11. Install exactly from the committed lockfile, then start the
fully local Vite dashboard:

```powershell
npm ci
npm run dev
```

The dashboard command does not evaluate SST configuration or access AWS. Run the local quality
suite with:

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
`infra:diff` is the RUS-01 infrastructure-composition gate and never substitutes for a deployment.

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
