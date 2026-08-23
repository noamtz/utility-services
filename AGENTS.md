# Reusable Utility Services

## What this is

This greenfield product provides reusable, language-agnostic utility services to independent applications. The MVP is an invite-only File Management service: an owner creates a project in a React dashboard, issues a server-side API key, integrates through REST, manages private or public files, and sees project-attributable AWS-equivalent usage cost. The approved stack is TypeScript, React/Vite, SST, and managed serverless AWS services in `il-central-1`.

## Sources of truth and repository map

- The GitHub wiki is the canonical documentation and project-management system. Read the relevant wiki pages before planning or implementation work, update them directly when approved product or architecture decisions change, and do not recreate local copies unless the owner changes this policy.
- GitHub operations for this repository must authenticate exclusively as `noamtz`. Verify the active identity before any GitHub write, and never switch to or use `noamtznm`.
- [Product Requirements (Epic)](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) is the source of truth for product intent, MVP scope, and success criteria.
- [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture) is the source of truth for technical choices and boundaries.
- Application code has not been scaffolded. Do not claim application paths, package commands, or library choices that do not yet exist.
- The required logical boundaries are identity/control, project authentication, File Management, direct S3 transfer, usage/pricing, and shared REST/observability foundations. Preserve these boundaries when choosing the physical layout during implementation planning.
- `.agents/skills/` contains repo-scoped workflows; `.agents/references/` contains on-demand engineering guidance.
- `.codex/config.toml`, `.codex/agents/`, and `.codex/hooks.json` define project Codex tooling. `tooling/validate_codex_layer.py` validates it.
- `.agents/archive/` is migration/archive material and is not active instruction context.

## Architecture rules

- Build one modular SST application, not independently deployed microservices. Future utilities reuse project authentication and usage contracts while owning their domain models.
- Use TypeScript across infrastructure, Lambda code, dashboard code, and shared contracts. Validate every external/runtime input with schemas; select the concrete schema library during implementation planning.
- Deploy regional resources to `il-central-1`. Use isolated SST stages for developers, pull requests, and production. Production data resources must be retained if the production stack is removed.
- Host the React/Vite dashboard with `sst.aws.StaticSite` on private S3 assets behind CloudFront. Use API Gateway HTTP API with Node.js Lambda integrations and AWS-generated domains for the MVP.
- Use DynamoDB on-demand tables separated by bounded context for core/control, file metadata, and usage/pricing. Do not couple future utilities to the File Management data model.
- Use one private file bucket per stage. Object keys are server-generated as `projects/{internalProjectId}/files/{fileId}`; callers never choose bucket keys or project prefixes.
- Keep file bytes out of Lambda and API Gateway. Authorize through `/v1` REST operations, then transfer directly with opaque S3 presigned `PUT`/`GET` URLs. File delivery via CloudFront and multipart uploads are deferred.
- Keep public and private product visibility immutable for the MVP. The S3 bucket always remains private with Block Public Access; stable public service URLs validate state and redirect to fresh temporary S3 URLs.

## Security and project isolation

- A project is the authorization, usage, quota, and future billing boundary. Every file and usage event belongs to exactly one project.
- Derive project context only from a verified dashboard identity or project credential. Never authorize from a project ID, file ID, object key, or prefix supplied by the caller.
- Use invite-only Cognito authentication for dashboard owners. Projects are owner-only; public signup, sharing, teams, and roles are deferred.
- Project API keys are server-side bearer credentials. Use a non-secret lookup ID plus high-entropy secret, store only a cryptographic hash, show plaintext once, and support revocation and replacement.
- Never place API keys in browser/mobile code, URLs, repositories, logs, or examples. Browser/mobile delegated authorization is deferred.
- Presigned URLs are always temporary: project-configurable from 1 to 60 minutes, defaulting to 15 minutes for uploads and 5 minutes for downloads. Clients request a fresh URL after expiry.
- Never log secrets or full presigned URLs. Redact sensitive query strings and use least-privilege IAM scoped to the stage resources and project-prefixed operations.
- Enforce 100 MB per file, 5 GB retained storage per project including trash, and 60 control-API requests per project per minute before issuing transfer URLs.

## File lifecycle and usage rules

- Model file and asynchronous state transitions explicitly and idempotently. S3/EventBridge/CloudTrail delivery is at least once; duplicates must not duplicate state or cost.
- Normal deletion moves a file to inaccessible trash for 14 days. Restore preserves the same project/object identity. An explicit `force=true` permanently deletes immediately. A scheduled purge uses `purgeAt`; trashed bytes continue to count toward quota and storage cost until removal.
- Keep pricing versions immutable and usage events append-only. Aggregates are rebuildable projections, not the source of truth.
- Display the current calendar-month value as **AWS-equivalent usage cost**, not as an allocated AWS invoice. Apply versioned published AWS list rates to project-attributable S3 storage, requests, outbound bytes, and CloudTrail data events; exclude free tiers, discounts, credits, taxes, and shared infrastructure.
- Meter successful download bytes asynchronously from CloudTrail `GetObject` data events using `additionalEventData.bytesTransferredOut`; attribute from the enforced object prefix and deduplicate by CloudTrail `eventID`.
- Quarantine failed, ambiguous, or incomplete metering events instead of charging them. Surface the metering watermark/freshness in the dashboard.
- Retain compressed raw CloudTrail logs and deduplication records for 90 days, compact usage-ledger detail for 14 months, and monthly aggregates indefinitely.

## API, errors, and integration

- Version public REST routes under `/v1`; keep dashboard/control routes and project utility routes logically separate even if initially deployed through one gateway.
- Use consistent validated request, response, and error envelopes across utilities. Do not expose AWS implementation details, bucket names, object keys, stack traces, or authorization internals to clients.
- Return complete transfer URLs and require consumers to treat them as opaque.
- Maintain copyable `curl` examples as the canonical language-agnostic integration path. Warn prominently that project API keys are server-side secrets.
- Preserve the five-minute activation target when changing authentication, API shape, or integration instructions.

## Validation and code review rules

- Every behavior change needs proportionate automated validation at its owning boundary. Cross-project authorization, key lifecycle, private/public access, idempotency, trash/restore/force-delete, quotas, and usage calculations require explicit tests.
- Before enabling non-zero download cost, pass the architecture acceptance exercise for full, range, cancelled, repeated, expired/failed, and unused presigned downloads; verify bytes, attribution, deduplication, quarantine, and replay.
- Treat cross-project access, private-file exposure, credential leakage, irreversible unintended deletion, double-counting, and silent metering loss as release-blocking defects.
- For review or diagnosis requests, inspect and report with concrete file evidence; do not implement unless the user asks for changes.
- For build, fix, or migration requests, make only in-scope changes, preserve unrelated work, and run the relevant validation before reporting completion.
- Ask before choices that materially change architecture, security, cost attribution, public contracts, or external systems. Make reversible local assumptions when they preserve approved intent and state them when consequential.
- Do not deploy, modify AWS resources, create credentials, or perform destructive/external actions without explicit authorization.

## Commands

Install and run the fully local dashboard:

```powershell
npm ci
npm run dev
```

Run the verified application quality gates:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run check
```

Generate ignored SST provider artifacts locally and preview a required explicit non-production stage:

```powershell
npm run infra:install -- --stage dev-<slug>
npm run infra:diff -- --stage dev-<slug>
```

`infra:diff` requires valid AWS credentials and is preview-only. After explicit owner authorization and a successful preview, deploy the same non-production stage with `npm run infra:deploy -- --stage dev-<slug>`. Production deployment is intentionally rejected by the RUS-01 wrapper. Never bypass the wrapper or run `sst dev`, deploy, modify AWS resources, or create credentials without explicit authorization.

Validate the Codex layer after changing instructions, skills, agents, hooks, or MCP configuration:

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

When installed, inspect optional integrations with `codex mcp list` and validate optional workflows with `archon validate workflows`.

## Subagent routing

Delegate only when the user requests it or the work divides into independent, useful lanes. Give every agent a bounded scope and specify whether it may edit.

- `codebase-analyst`: read-only mapping of an implemented subsystem before planning or risky changes.
- `research-agent`: read-only current AWS/SST official-documentation research or bounded code exploration.
- `code-reviewer`: read-only findings-first review after implementation.
- `system-reviewer`: read-only comparison of an execution report with its plan.
- `meta-agent`: edits only project custom-agent definitions under `.codex/agents/`.

## On-demand context

- Use `$piv-plan-implementation` to turn the approved PRD and architecture into an implementation plan.
- Use `$piv-implement` only after a completed implementation plan exists.
- Use `$piv-validate` for the repository's full validation suite once application commands have been established.
- Use `$rules-check-drift` after scaffolding or structural changes to keep these rules truthful.
- Restart Codex after changing `AGENTS.md`, project configuration, custom agents, or trusted hooks so a new session rebuilds the instruction chain.
