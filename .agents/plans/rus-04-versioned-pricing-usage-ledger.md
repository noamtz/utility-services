# Feature: RUS-04 Versioned Pricing and Usage Ledger

The following plan is complete, but implementation must revalidate official documentation, installed SST/Pulumi types, repository state, current published rates, and task sanity before changing files. Pay particular attention to immutable pricing identities, fixed-point arithmetic, DynamoDB transaction cancellation reasons, UTC month boundaries, and the separation between trusted internal project identity and public/caller-controlled identifiers.

## Feature Description

Establish the reusable usage/pricing bounded context for Utility Services. The module records project-attributable usage exactly once, selects an immutable published AWS price version according to the usage occurrence time, stores the resulting charge as append-only ledger evidence, incrementally projects project/month totals, rebuilds those projections from the ledger, models byte-time storage checkpoints across UTC month and price boundaries, and reports metering freshness independently of cost.

This ticket creates the table, deployment-managed price snapshots, domain contracts, calculations, repositories, services, and automated boundary tests needed by later File Management workflows. It does not yet ingest S3 or CloudTrail events, display dashboard usage, or expose a new HTTP route.

## User Story

As an invited application builder
I want my project's attributable usage calculated consistently against known AWS list prices
So that I can understand the current calendar month's AWS-equivalent cost without mistaking it for an allocated AWS invoice.

## Problem Statement

RUS-02 established projects and RUS-03 established trusted project authentication, but no independent usage/pricing model exists. Later upload, download, trash, and metering workflows need one common contract that prevents duplicate asynchronous deliveries from duplicating cost, prevents a later price change from rewriting historical amounts, supports storage accrued over time, and gives the dashboard a fast but rebuildable current-month view. Implementing those rules separately inside file workflows would couple pricing to File Management and make correctness, replay, and future utility reuse difficult.

## Solution Statement

Add one on-demand usage/pricing DynamoDB table and a cohesive `packages/backend/src/modules/usage-pricing` slice. Seed immutable pricing versions from append-only deployment configuration into the table. Normalize each accepted source movement into a strict internal usage input, select the latest pricing version whose `effectiveAt` is less than or equal to the event's UTC occurrence time, calculate exact fixed-point quantities and USD charges, and transactionally write:

- one 90-day deduplication record;
- one 14-calendar-month append-only usage event;
- one metric aggregate and one total aggregate for the project/UTC month.

The durable event key remains a second idempotency guard after the shorter-lived dedupe item expires. Monthly aggregates use DynamoDB integer `ADD` operations over fixed-scale quantity/cost atoms so concurrent accepted events remain atomic; public/query contracts render canonical decimal strings. Strongly consistent event queries and aggregate revision conditions support safe bounded-retry rebuilds. Separate watermark and quarantine records make `fresh`, `stale`, `incomplete`, and `not-yet-metered` states observable without changing the cost itself.

Storage uses explicit `[startAt, endAt)` byte-millisecond intervals. A deterministic splitter cuts intervals at the next UTC calendar-month boundary and the next pricing-version boundary, emits idempotently named usage segments, then conditionally advances or closes the checkpoint only after every segment is recorded.

## Out of Scope / Non-Goals

- Not included: S3 buckets, file metadata, presigned uploads/downloads, upload completion handling, retained-storage quota enforcement, or file lifecycle operations (RUS-05 and RUS-07).
- Not included: CloudTrail trail/log bucket creation, `GetObject` ingestion, download-byte semantics acceptance exercise, replay worker, or enabling non-zero download metering in a live stage (RUS-08).
- Not included: dashboard usage UI, owner-facing usage HTTP routes, API Gateway routes, public curl documentation, or end-to-end usage display (RUS-09).
- Not included: pricing-management UI, automated price refresh, mutable prices, retroactive repricing, invoices, billing collection, credits, refunds, taxes, free tiers, discounts, Savings Plans, or AWS invoice reconciliation.
- Not included: shared dashboard/API/Lambda/DynamoDB infrastructure allocation or account-level tier allocation.
- Not included: compressed raw CloudTrail-log retention; RUS-08 owns the private log bucket and its 90-day lifecycle. RUS-04 owns table-level dedupe/quarantine/event retention only.
- Not included: deployment, AWS resource mutation, table seeding in a live stage, data creation, or production activity without separate owner authorization. A wrapper-controlled `infra:diff` is preview-only.
- Not changing: the core/control table, project credential model, project-authentication module, `/v1` routes, dashboard, Node.js 24, `il-central-1`, private file-transfer architecture, or shared REST envelopes.

## Feature Metadata

**Feature Type**: New Capability  
**Estimated Complexity**: High  
**Primary Systems Affected**: SST infrastructure, usage/pricing DynamoDB model, shared contracts, backend usage/pricing module, integration-boundary tests, repository status documentation  
**Dependencies**: Implemented RUS-02 project boundary; current RUS-03 baseline; existing Zod 4.4.3, AWS SDK v3.1116.0, SST 4.17.1, TypeScript 6.0.3, Vitest 4.1.10; AWS Price List/S3/CloudTrail published pricing sources

## Related Work

**Implements**: [RUS-04 / GitHub issue #4](https://github.com/noamtz/utility-services/issues/4) · **Epic**: [Product Requirements](https://github.com/noamtz/utility-services/wiki/Product-Requirements-Epic) · **Architecture**: [Architecture](https://github.com/noamtz/utility-services/wiki/Architecture)

**Back-references**:

- `.agents/plans/rus-01-deployable-application-foundation.md` - Establishes the TypeScript workspaces, SST composition, Zod/contracts, test/coverage commands, and no-unapproved-AWS boundary inherited here.
- `.agents/plans/rus-02-invite-only-owner-project-control.md` - Establishes the stable internal project boundary and explicitly requires RUS-04 to remain outside the core/control table.
- `.agents/plans/rus-03-project-credential-lifecycle-authentication.md` - Establishes the current trusted internal project context consumed later by file utility handlers; RUS-04 must not accept caller project identity as authorization.
- `.agents/reports/rus-03-project-credential-lifecycle-authentication-report.md` - Confirms main contains the current implemented baseline and local/preview validation patterns.
- [MVP Ticket Breakdown — RUS-04](https://github.com/noamtz/utility-services/wiki/MVP-Ticket-Breakdown#rus-04--establish-versioned-pricing-and-the-usage-ledger) - Stable scope, dependency, acceptance criteria, and downstream seams.

**Forward-references**:

- RUS-05 records successful upload-request usage, opens storage checkpoints, and uses the usage service without importing pricing logic.
- RUS-07 checkpoints/closes storage when physical objects are permanently removed; trash remains billable.
- RUS-08 records download requests, transferred bytes, and CloudTrail data-event quantities, drives watermarks/quarantine/replay, and performs the live download-pricing gate.
- RUS-09 resolves owner/project identity through the control boundary and exposes the monthly projection in the dashboard.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` (lines 7-17) - Canonical wiki policy, current implementation status, module boundaries, and GitHub identity requirement.
- `AGENTS.md` (lines 19-29) - Exact AWS account/principal/region, CA bundle, shared `dev-rus02` continuity, and external-action restrictions.
- `AGENTS.md` (lines 31-40) - One modular SST application and separate on-demand DynamoDB tables by bounded context.
- `AGENTS.md` (lines 42-61) - Project attribution, immutable pricing/events, AWS-equivalent label, quarantine/freshness, and retention rules.
- `AGENTS.md` (lines 71-105) - Required tests, release blockers, validation commands, and wrapper-only infrastructure preview.
- `packages/backend/README.md` (lines 1-8) - A future cohesive `src/modules/usage-pricing` slice owns the domain; functions remain thin, contracts remain shared, and backend never imports infra.
- `package.json` (lines 1-29, 31-50) - Node/npm pins, workspaces, exact validation scripts, and SST/TypeScript/Vitest versions.
- `packages/backend/package.json` (lines 1-16) - Existing AWS SDK, Powertools, SST, contracts, and Zod runtime dependencies. Do not add a decimal dependency unless the fixed-point design is deliberately amended.
- `vitest.config.ts` (lines 4-52) - Node/jsdom projects, root integration-test discovery, source inclusion, and 80% global thresholds.
- `sst.config.ts` (lines 1-40) - Current dynamic resource composition and non-sensitive outputs to extend with usage/pricing resources.
- `infra/control.ts` (lines 1-26) - Existing global Dynamo Linkable wrapper; refactor it into a neutral helper before a second bounded-context table uses the component.
- `infra/control.ts` (lines 28-61) - On-demand Dynamo component and production deletion-protection pattern to mirror.
- `infra/config/control.ts` (lines 1-31, 95-97) - Centralized names/key/index/link policy and pure production-protection helper pattern.
- `infra/api.ts` (lines 20-66) - Route-specific table linking/permissions. RUS-04 does not modify routes; future consumers must receive only explicit actions.
- `infra/composition.test.ts` (lines 1-35) - Pure infrastructure-composition policy tests that avoid deploying SST resources.
- `infra/sst-globals.d.ts` (lines 1-132) - Narrow committed declarations; extend only for Dynamo TTL and the Pulumi DynamoDB `TableItem` surface actually used.
- `packages/contracts/src/projects/contract.ts` (lines 1-90) - Strict schema-first contract and inferred-type pattern.
- `packages/contracts/src/index.ts` (lines 1-74) - Public export boundary to extend.
- `packages/contracts/src/projects/contract.test.ts` (lines 33-110) - Accepted/default/rejected/extra-field contract testing pattern.
- `packages/contracts/src/auth/project-context.ts` (lines 6-14) - Minimal verified internal project context; future project-authenticated callers may pass only its internal ID into the module.
- `packages/backend/src/core/http/handler.ts` (lines 181-265) - Shared HTTP envelope/error/auth seam that later query routes will use; do not create a parallel transport in this ticket.
- `packages/backend/src/core/observability/powertools.ts` (lines 5-32) - Safe structured logger seam for future processors.
- `packages/backend/src/core/observability/redact.ts` (lines 6-29, 53-90) - Sensitive-key/query redaction that any future raw-source processing must preserve.
- `packages/backend/src/modules/identity-control/projects/model.ts` (lines 10-62) - Strict persisted-item schemas, item type discriminators, and deterministic key conventions.
- `packages/backend/src/modules/identity-control/projects/repository.ts` (lines 31-62, 64-127, 130-198) - Minimal repository interface, fail-closed read parsing, conditional transaction classification, and bounded query patterns.
- `packages/backend/src/modules/identity-control/projects/repository.test.ts` (lines 27-69, 71-212) - Actual SDK-command assertions, stub client, conditional errors, and corrupt-record tests.
- `packages/backend/src/modules/identity-control/projects/service.ts` (lines 18-29, 56-133) - Dependency injection, clock injection, policy orchestration, and public projection validation.
- `packages/backend/src/modules/identity-control/credentials/repository.ts` (lines 327-396, 449-529) - Multi-item transaction, `ClientRequestToken`, ordered cancellation-reason classification, and atomic lifecycle patterns.
- `packages/backend/src/modules/identity-control/credentials/repository.test.ts` (lines 97-185, 211-224) - Exact transaction-input and idempotent-terminal behavior tests.
- `packages/backend/src/modules/project-authentication/service.ts` (lines 64-94) - Verified/frozen internal project context and fail-closed record-linkage checks.
- `tests/integration/project-credential-authentication.test.ts` - Cross-slice in-memory integration style without a live DynamoDB dependency.
- `README.md` (lines 3-26, 61-107) - Current implemented-status, repository map, stage wrapper, and preview/deployment guardrails to keep truthful.
- `.agents/plans/rus-03-project-credential-lifecycle-authentication.md` (lines 288-351, 491-505, 509-616) - Current phase/task/validation style and exact `dev-rus02` preview gate.

### Existing Files to Update

- `packages/contracts/src/index.ts` - Re-export usage metrics, pricing snapshot schemas, monthly AWS-equivalent projection, and freshness types.
- `infra/control.ts` - Move the class-wide Dynamo Linkable setup to a neutral shared helper without broadening permissions; keep identity/control construction focused.
- `infra/sst-globals.d.ts` - Add only `DynamoArgs.ttl` and the provider `aws.dynamodb.TableItem` constructor/options used for immutable seed items.
- `infra/composition.test.ts` - Assert usage resources are composed independently and existing API/dashboard/control wiring remains unchanged.
- `sst.config.ts` - Construct usage/pricing resources after common Dynamo linking, return only a non-sensitive table-name output, and leave API routes untouched.
- `README.md` - Describe the implemented RUS-04 module/table and state clearly that ingestion, HTTP/dashboard presentation, and live deployment remain later/authorized work.
- `AGENTS.md` - Update only the repository-status sentence after implementation; preserve canonical architecture and external-action rules.

### New Files to Create

- `packages/contracts/src/usage-pricing/contract.ts` - Strict metric/rate/projection/freshness schemas and canonical string transport types.
- `packages/contracts/src/usage-pricing/contract.test.ts` - Contract strictness, label, currency, exclusions, decimal grammar, and internal-field exclusion tests.
- `infra/dynamo-link.ts` - One idempotent class-wide Dynamo linker with a least-privilege baseline reused by every bounded-context table.
- `infra/config/usage-pricing.ts` - Usage table policy, TTL name, immutable append-only AWS price snapshots, provenance, and pure seed-item conversion.
- `infra/config/usage-pricing.test.ts` - Key/TTL/no-index/provenance/append-only/version/retention policy tests.
- `infra/usage-pricing.ts` - Usage table construction and deployment-managed immutable `aws.dynamodb.TableItem` pricing seeds.
- `infra/usage-pricing.test.ts` - Stubbed SST/Pulumi resource construction, production protection, seed retention, and no-route/no-wildcard tests.
- `packages/backend/src/modules/usage-pricing/fixed-point.ts` - Exact bigint parsing, half-up division, atto-USD formatting, and DynamoDB 38-digit guards.
- `packages/backend/src/modules/usage-pricing/fixed-point.test.ts` - Known vectors and fractional/rounding/overflow tests.
- `packages/backend/src/modules/usage-pricing/model.ts` - Strict stored item schemas, key constructors, fingerprints, UTC period helpers, and TTL calculations.
- `packages/backend/src/modules/usage-pricing/model.test.ts` - Every item family/key/retention/corruption invariant.
- `packages/backend/src/modules/usage-pricing/pricing.ts` - Price-version selection and metric-specific cost calculation.
- `packages/backend/src/modules/usage-pricing/pricing.test.ts` - Effective boundary, unit conversion, excluded-cost, and historical-snapshot tests.
- `packages/backend/src/modules/usage-pricing/repository.ts` - Dynamo adapter for pricing, idempotent ledger writes, aggregates, events, checkpoints, quarantine, and watermarks.
- `packages/backend/src/modules/usage-pricing/repository.test.ts` - Exact command/access/transaction/cancellation/rebuild/corrupt-record tests.
- `packages/backend/src/modules/usage-pricing/storage.ts` - Pure interval splitting and deterministic segment identities.
- `packages/backend/src/modules/usage-pricing/storage.test.ts` - UTC month/rate boundary, leap/month length, subsecond, and idempotent segmentation tests.
- `packages/backend/src/modules/usage-pricing/service.ts` - Usage recording, storage checkpoint orchestration, quarantine/watermark handling, projection reads, and rebuild orchestration.
- `packages/backend/src/modules/usage-pricing/service.test.ts` - Fake-repository business-policy, retry, isolation, freshness, and rebuild tests.
- `tests/integration/usage-pricing-ledger.test.ts` - In-memory end-to-end contract/service/rebuild/checkpoint workflow.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [GitHub Architecture — Usage table and usage pricing/metering](https://github.com/noamtz/utility-services/wiki/Architecture#usage-pricing-and-metering)
  - Specific sections: Usage table; Usage pricing and metering; Storage and upload metering; Usage reliability and reconciliation.
  - Why: Canonical model, included/excluded costs, event authority, storage intervals, watermark, and retention decisions.
- [DynamoDB transactions and idempotency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-apis-idempotency)
  - Specific sections: `TransactWriteItems`, 10-minute client-token limit, cancellation/conflict handling, capacity.
  - Why: Durable dedupe cannot rely on `ClientRequestToken`; event/dedupe conditions must own long-lived correctness.
- [DynamoDB supported data types](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html#HowItWorks.NamingRulesDataTypes.DataTypes)
  - Specific section: Number precision and wire representation.
  - Why: DynamoDB supports 38 decimal digits and transmits Numbers as strings; the implementation must preserve integers as `bigint`, not JavaScript `number`.
- [AWS SDK v3 `unmarshallOptions.wrapNumbers`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-util-dynamodb/Interface/unmarshallOptions/)
  - Specific section: custom wrapped-number conversion.
  - Why: Configure the usage DocumentClient to return exact bigint counters. A local probe against pinned SDK 3.1116.0 already confirmed bigint marshalling and custom bigint unmarshalling; retain a regression test.
- [DynamoDB Query API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html)
  - Specific sections: exact partition-key condition, sort-key predicates, 1 MB pagination, consistent reads.
  - Why: Every read path must use derived keys and pagination; no scan/filter authorization or unbounded read.
- [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
  - Specific sections: epoch-second Number and asynchronous deletion.
  - Why: Expiry is a retention aid, not an exact correctness clock; expired records may remain visible and must be treated accordingly.
- [AWS Price List `ListPriceLists`](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_pricing_ListPriceLists.html)
  - Specific fields: `ServiceCode`, `CurrencyCode`, `EffectiveDate`, and `RegionCode`.
  - Why: Capture region-specific price-list identity and effective/publication metadata without building refresh automation.
- [Calling AWS services and prices](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html)
  - Specific sections: endpoints and price-list/service-page precedence.
  - Why: The Pricing API endpoint region is not the product region; use product region `il-central-1`, and record the service-page cross-check/source.
- [S3 pricing](https://aws.amazon.com/s3/pricing/)
  - Specific sections: storage/requests/data transfer and binary gigabyte definition.
  - Why: S3 uses 1 GiB = 2^30 bytes and cost depends on size/time; exclude free tier, taxes, discounts, and unrelated dimensions.
- [S3 storage billing FAQ](https://aws.amazon.com/s3/faqs/)
  - Specific section: byte-hours divided by the hours in that calendar month.
  - Why: Storage segments must use the actual UTC month's duration rather than a fixed 30-day divisor.
- [AWS Price List file format](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/reading-service-price-list-files.html)
  - Specific sections: product SKU, on-demand term, price dimension, unit, begin/end ranges.
  - Why: Persist exact selected SKU/rate/unit/range/source evidence for every snapshot.
- [SST Dynamo component](https://sst.dev/docs/component/aws/dynamo/)
  - Specific sections: fields, primary index, TTL, deletion protection, linking.
  - Why: Key fields cannot be changed casually after creation; TTL names one attribute but does not make deletion immediate.
- [SST linking](https://sst.dev/docs/linking/)
  - Specific sections: `Linkable.wrap`, linked properties, permissions.
  - Why: Configure the class-wide Dynamo link exactly once and add write actions only to future functions that need them.
- [Pulumi AWS DynamoDB TableItem](https://www.pulumi.com/registry/packages/aws/api-docs/dynamodb/tableitem/)
  - Specific fields: table name, hash/range keys, DynamoDB AttributeValue JSON, resource options.
  - Why: Deployment seeds immutable pricing records without a runtime/startup side effect; retain removed historical seed items and ignore in-place item mutation.

### Patterns to Follow

**Naming Conventions:**

- Kebab-case metric/source strings; PascalCase Zod schemas/types; camelCase functions/fields; uppercase constants; lower-case folder `usage-pricing`.
- Use item discriminators and explicit keys, for example `itemType: "usage-event"`; never infer record type only from optional attributes.
- Use exact UTC ISO timestamps with `Z`, canonical `YYYY-MM` project periods, and half-open intervals.

**Persistence and access patterns:**

| Concern | PK | SK / behavior | Retention |
| --- | --- | --- | --- |
| Price version | `PRICING` | `VERSION#<effectiveAt>#<versionId>`; descending `<= occurrence` query | Indefinite/immutable |
| Usage event | `PROJECT#<internalId>#MONTH#<YYYY-MM>` | `EVENT#<occurredAt>#<sourceDigest>`; conditional put | TTL after 14 calendar months |
| Metric aggregate | same project/month PK | `AGGREGATE#METRIC#<metric>`; bigint `ADD` + revision | Indefinite |
| Total aggregate | same project/month PK | `AGGREGATE#TOTAL`; bigint `ADD` + revision | Indefinite |
| Dedupe | `SOURCE#<sha256(project/sourceKind/sourceId)>` | `DEDUPE`; includes canonical input fingerprint | 90-day TTL |
| Storage checkpoint | `STORAGE#<internalId>#<subjectDigest>` | `CHECKPOINT`; conditional revision | Active plus 14-month closed evidence |
| Watermark | `PROJECT#<internalId>` | `WATERMARK#<sourceKind>` | Indefinite |
| Quarantine | `QUARANTINE#<UTC YYYY-MM>` | `<observedAt>#<quarantineId>`; safe metadata only | 90-day TTL |

No GSI or Scan is required. Project/month event and aggregate reads use the base partition; prices use one pricing partition; checkpoints/dedupe are direct keys; project watermarks are one bounded partition; quarantine operations are month-partitioned.

**Fixed-point arithmetic:**

- Use `USD_SCALE = 18` (atto-USD) and bigint integer counters. Render `costUsd` as a canonical non-exponent decimal string only at the contract boundary.
- Persist raw integral base quantities: request count, byte count, and storage byte-milliseconds. Normalize pricing units with integer multiplication/division and round each immutable event once, half-up, to atto-USD.
- S3 storage divisor is `2^30 * millisecondsInThatUtcMonth`; request/data-event configuration records the published unit quantity (for example per 1,000 or 100,000); transfer uses the captured binary-GB unit.
- Validate every persisted numeric value stays within DynamoDB's 38-digit Number precision. Never pass a bigint counter through JavaScript `number`, `parseFloat`, or binary floating-point arithmetic.
- The usage-specific DocumentClient uses `wrapNumbers: value => BigInt(value)` and `removeUndefinedValues: true`; schemas expect bigint for Dynamo numeric counters and convert to strings only in public projections.

**Idempotency:**

- Compute a canonical fingerprint over trusted project ID, metric, exact base quantity, source kind/ID, and occurrence time.
- One transaction conditionally puts dedupe + event and atomically adds metric/total aggregate atoms. `ClientRequestToken` is only a short retry aid; persistent items provide durable idempotency.
- Same source/fingerprint returns `duplicate` without another aggregate update. Same source with a different fingerprint is a conflict/quarantine condition and never overwrites or charges.
- Watermark advancement is separately retryable: failure after a successful ledger transaction causes the caller to retry; the ledger becomes a duplicate and watermark repair continues without double cost.

**Error handling and corruption:**

- Repositories parse every persisted record with strict Zod and map conditional/cancellation positions to typed duplicate, divergent-source, checkpoint-conflict, and projection-conflict outcomes.
- Unexpected or corrupt stored data fails closed. Quarantine contains bounded reason codes, hashes, timestamps, and optional trusted project attribution—never raw CloudTrail records, object keys, URLs, credentials, or stack traces.
- No HTTP errors/routes are introduced. Later handlers map service outcomes through the existing shared envelope.

**Logging:**

- The module itself remains logger-agnostic where possible. Future processors log sparse safe metadata and use `safeLogger`; no raw source event or sensitive identifiers are required for ledger correctness.

**Price configuration:**

- Each version contains `versionId`, `effectiveAt`, `publishedAt`, `currency: "USD"`, product region `il-central-1`, service/product/SKU/rate-code/unit/range evidence, source URLs/hash, and the five approved MVP metric rates.
- Metric set: `s3-storage-byte-milliseconds`, `s3-upload-requests`, `s3-download-requests`, `s3-download-bytes-out`, and `cloudtrail-s3-data-events`.
- Select the zero-begin-range on-demand list dimension applicable under MVP quotas. Keep free tiers, credits, discounts, taxes, and shared infrastructure absent—not represented as negative or zero-priced usage events.
- All historical config entries remain in source. New rates append a strictly later `effectiveAt`; never edit/remove/reuse a prior version. `TableItem` resource names include the version identity and use `retainOnDelete` plus `ignoreChanges: ["item"]` so ordinary IaC drift cannot rewrite/delete historical price contents.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts, arithmetic, and price policy

Define the stable metric/projection/freshness vocabulary, exact fixed-point representation, immutable price snapshot schema, current published-rate evidence, and unit calculations before persistence code.

**Tasks:**

- Add strict shared usage/pricing contracts and exports.
- Implement/test fixed-point bigint helpers and metric cost calculation.
- Capture one append-only `il-central-1` price version from current official AWS sources with provenance.

### Phase 2: Usage/pricing infrastructure and data model

**Depends on:** Phase 1 (table seed items must match the approved price and record schemas)

Create the independent on-demand usage table, one safe class-wide Dynamo link configuration, immutable price seed items, keys/item schemas, TTL policy, and pure composition tests.

**Tasks:**

- Add the table policy and SST resource.
- Seed pricing versions as infrastructure-managed DynamoDB items.
- Define/validate all table item families and access patterns.

### Phase 3: Ledger, projection, and freshness repository

**Depends on:** Phase 2 (uses the concrete key/item topology)

Implement bounded DynamoDB commands for effective-price lookup, durable idempotent event recording, aggregate queries/rebuild replacement, checkpoint concurrency, watermark advancement, and quarantine.

**Tasks:**

- Implement strict read/write adapters and conditional error classification.
- Use atomic event/dedupe/aggregate transactions and exact bigint counters.
- Add strong-read pagination and optimistic projection replacement.

### Phase 4: Usage and storage services

**Depends on:** Phase 3 (orchestrates repository operations)

Implement usage recording, deterministic storage segmentation/checkpointing, project-month projection assembly, freshness evaluation, quarantine, and rebuild orchestration using dependency injection.

**Tasks:**

- Apply occurrence-time price selection and immutable event amounts.
- Split/record storage intervals and safely advance/close checkpoints.
- Return exact AWS-equivalent current-month projections even when freshness is stale/incomplete.

### Phase 5: Cross-boundary validation and repository status

**Depends on:** Phases 1-4

Assemble an in-memory integration workflow, update truthful status documentation, run all local gates, validate the Codex layer, and preview the new table/items against the shared stage only through the authorized wrapper.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. CREATE `packages/contracts/src/usage-pricing/contract.ts` and `contract.test.ts`; UPDATE `packages/contracts/src/index.ts`

- **IMPLEMENT**: strict schemas/types for the five metric identifiers, price-version metadata/rates, canonical decimal strings, UTC period, metric breakdown, total USD, `priceVersionIds`, exact literal label `AWS-equivalent usage cost`, `USD`, explicit exclusions, and freshness states `fresh | stale | incomplete | not-yet-metered` with nullable `lastMeteredAt`.
- **IMPLEMENT**: keep internal project IDs, Dynamo keys, raw source IDs, bigint atoms, checkpoints, quarantine internals, and AWS resource names out of the public monthly projection.
- **PATTERN**: `packages/contracts/src/projects/contract.ts:11-90`, `packages/contracts/src/index.ts:1-74`, and strictness tests in `projects/contract.test.ts:33-110`.
- **GOTCHA**: current month may contain multiple price versions; expose sorted unique version IDs rather than a misleading singular value. Cost and quantity transport values are strings, never JSON numbers.
- **VALIDATE**: `npm test -- --project node packages/contracts/src/usage-pricing/contract.test.ts`
- **SATISFIES**: AC4, AC5, AC7, AC8.

### 2. CREATE `packages/backend/src/modules/usage-pricing/fixed-point.ts` and `fixed-point.test.ts`

- **IMPLEMENT**: parse bounded unsigned decimal/integer strings into bigint atoms, exact multiply/divide with explicit half-up rounding, atto-USD formatting without exponent notation, binary-GiB constants, and a 38-digit Dynamo Number guard.
- **IMPLEMENT**: regression-test pinned SDK bigint marshalling/unmarshalling through the same `wrapNumbers` converter that the repository will use.
- **PATTERN**: strict fail-closed helpers and exhaustive colocated tests used in the current identity/control slices.
- **GOTCHA**: do not use `number`, `parseFloat`, `toFixed`, implicit bigint-to-number conversion, or DynamoDB floating-point `ADD`. Reject overflow before issuing a command.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/fixed-point.test.ts`
- **SATISFIES**: AC3, AC4, AC6, AC8.

### 3. CREATE `packages/backend/src/modules/usage-pricing/pricing.ts` and `pricing.test.ts`

- **IMPLEMENT**: validate price versions, choose the greatest `effectiveAt <= occurredAt`, select only the requested approved metric rate, calculate immutable base quantity/cost atoms, and return the exact price/version/rate snapshot stored on the event.
- **IMPLEMENT**: storage calculation uses byte-milliseconds divided by `2^30 * millisecondsInUtcMonth`; request/data-event/transfer calculation uses the price snapshot's exact published unit quantity.
- **TEST**: before/at/after price boundaries, no effective version, exact month lengths/leap February, 0.1/0.2-style fractional normalization, sub-atto half-up cases, repeated sub-cent events, and overflow.
- **GOTCHA**: never select price by processing time. A new version must not recalculate an existing event. No excluded metric enters the rate map.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/pricing.test.ts`
- **SATISFIES**: AC2, AC3, AC4, AC6, AC8.

### 4. CREATE `infra/config/usage-pricing.ts` and `infra/config/usage-pricing.test.ts`

- **IMPLEMENT**: define `UsagePricingTable`, `{pk, sk}` primary key, no GSI, `expiresAt` TTL, PAY_PER_REQUEST documentation policy, production deletion-protection helper, exact baseline link actions, and append-only price-version configuration.
- **RESEARCH/CAPTURE**: immediately before coding rates, retrieve the current AmazonS3 and AWSCloudTrail `il-central-1` on-demand price dimensions from the official Price List, cross-check service pricing pages, and record effective/publication time, product/SKU/rate code/unit/begin/end range, USD string, source URL, and a source-content hash. Do not rely on remembered values or copy another region.
- **IMPLEMENT**: pure conversion to DynamoDB AttributeValue JSON for `PRICING` items; validate unique IDs/effective instants, strict ascending history, all five metrics, USD only, and absence of excluded adjustments.
- **IMPLEMENT**: keep every historical version literal in the array; a changed rate is a new later version, never an edit.
- **PATTERN**: `infra/config/control.ts:1-31,95-97`.
- **GOTCHA**: Pricing API endpoint region is not the product region. MVP quota/traffic remains in the first published on-demand range; record its range evidence. If official sources are ambiguous or disagree, stop and document the discrepancy rather than guessing.
- **VALIDATE**: `npm test -- --project node infra/config/usage-pricing.test.ts`
- **SATISFIES**: AC1, AC2, AC3, AC8.

### 5. CREATE `infra/dynamo-link.ts`; UPDATE `infra/control.ts`

- **REFACTOR**: move the idempotent class-wide `sst.Linkable.wrap(sst.aws.Dynamo, ...)` configuration out of the identity/control resource into a neutral shared helper. Keep the existing table name property, Query-only baseline, table/index ARN shape, and one-time guard exactly intact.
- **UPDATE**: both control and usage resource factories call the neutral helper safely; no second wrapper or broadened global actions.
- **PATTERN**: `infra/control.ts:12-26` and route-specific additions in `infra/api.ts:45-61`.
- **GOTCHA**: `Linkable.wrap` is class-wide, not table-local. Never add Put/Update/Get/Scan/wildcard permissions globally; future functions add only required actions.
- **VALIDATE**: `npm test -- --project node infra/composition.test.ts infra/usage-pricing.test.ts`
- **SATISFIES**: AC1 and least-privilege architecture compliance.

### 6. CREATE `infra/usage-pricing.ts` and `infra/usage-pricing.test.ts`; UPDATE `infra/sst-globals.d.ts`, `sst.config.ts`, and `infra/composition.test.ts`

- **IMPLEMENT**: create one `sst.aws.Dynamo` usage/pricing table with `{pk,sk}`, `ttl: "expiresAt"`, and production-only deletion protection; preserve app-level production retain/protect.
- **IMPLEMENT**: create one provider `aws.dynamodb.TableItem` per price version using the exact table output and AttributeValue JSON. Use stable versioned resource names, `retainOnDelete: true`, and `ignoreChanges: ["item"]`; return the price resources to preserve dependency tracking.
- **UPDATE**: compose the table independently in `sst.config.ts` and return only `usagePricingTableName`; do not pass it to `createApi`, add a route/function, or change the dashboard.
- **UPDATE**: minimally declare TTL and TableItem/resource-option types in `infra/sst-globals.d.ts`, then regenerate ignored provider artifacts during validation to confirm the real pinned types.
- **TEST**: exact key/TTL/protection/seed arguments, no GSI/Scan/wildcard, all configured versions seeded, and existing control/API/dashboard outputs unchanged.
- **PATTERN**: `infra/control.ts:28-61`, `sst.config.ts:20-40`, and `infra/composition.test.ts:1-35`.
- **GOTCHA**: TableItem is infrastructure seed state, not a runtime pricing API. Never update or remove a historical seed. No deployment is authorized by this plan.
- **VALIDATE**: `npm test -- --project node infra/config/usage-pricing.test.ts infra/usage-pricing.test.ts infra/composition.test.ts`
- **SATISFIES**: AC1, AC2.

### 7. CREATE `packages/backend/src/modules/usage-pricing/model.ts` and `model.test.ts`

- **IMPLEMENT**: strict schemas and key builders for price version, usage event, metric/total aggregate, dedupe, checkpoint, watermark, and quarantine items matching the access-pattern table above.
- **IMPLEMENT**: SHA-256 canonical source/checkpoint digests, canonical input fingerprints, UTC period helpers, 90-day TTL, event expiry after the end of the fourteenth following UTC calendar month, and closed-checkpoint expiry.
- **IMPLEMENT**: usage event includes trusted internal project ID, metric/base quantity, occurrence time, source kind/digest, applied version/effective time/rate/unit, immutable cost atoms, created time, and expiry. It never stores caller authorization evidence or a mutable price lookup.
- **TEST**: item relationships/key prefixes, strict extra-field rejection, UTC lexical ordering, source-ID length/character extremes, TTL calendar behavior, and every corrupt cross-field relationship.
- **PATTERN**: `packages/backend/src/modules/identity-control/projects/model.ts:10-62` and credential dual-record validation.
- **GOTCHA**: use source hashes in keys to bound length and avoid sensitive/raw identifiers; preserve safe source metadata only where reconciliation needs it.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/model.test.ts`
- **SATISFIES**: AC1, AC3, AC4, AC6, AC7, AC8.

### 8. CREATE `packages/backend/src/modules/usage-pricing/repository.ts` and `repository.test.ts` — price/event paths

- **IMPLEMENT**: minimal repository and DocumentClient interfaces; usage-specific client-options factory; strongly consistent effective-price query (`PRICING`, descending, upper-bound sort key, limit one); and exact read parsing.
- **IMPLEMENT**: `recordEvent` transaction with conditionally new dedupe and event items plus bigint `ADD` updates for metric and total aggregates/revisions and price-version string sets. Include a deterministic bounded `ClientRequestToken` only as short retry protection.
- **CLASSIFY**: ordered cancellation reasons. On dedupe/event condition failure, consistently read the existing evidence: identical fingerprint returns duplicate; divergent payload returns typed source conflict. Aggregate conflict/SDK conflict remains retryable and never partially charges.
- **TEST**: exact PK/SK expressions, consistent reads, no Scan/filter/GSI, all transaction items/conditions/atoms, duplicate outside 10 minutes, divergent source, transaction conflict, overflow, and corrupt pricing/event data.
- **PATTERN**: `projects/repository.ts:31-62,64-127` and `credentials/repository.ts:327-396,449-529` with their command-shape tests.
- **GOTCHA**: transaction actions may not target the same item twice. Dedupe/event/metric/total keys must remain distinct even for the `TOTAL` label.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/repository.test.ts -t "price|record|duplicate|source conflict"`
- **SATISFIES**: AC1, AC3, AC4, AC6, AC8.

### 9. EXTEND `repository.ts` and `repository.test.ts` — projection/checkpoint/freshness/quarantine paths

- **IMPLEMENT**: paginated strongly consistent project/month event query; bounded aggregate query; exact checkpoint get/create/conditional advance/close; project watermark query and monotonic/retry-safe update; safe quarantine put; and aggregate-replacement transaction for rebuild.
- **IMPLEMENT**: projection replacement reads/captures current aggregate revisions, then conditionally puts every recalculated metric/total item. A concurrent record changes a revision and forces a bounded rebuild retry; events remain untouched.
- **IMPLEMENT**: explicitly ignore logically expired dedupe/quarantine items even before asynchronous TTL deletion. Never TTL prices, active checkpoints, watermarks, or aggregates.
- **TEST**: pagination, empty/missing aggregates, aggregate delete/rebuild, concurrent revision conflict/retry, checkpoint revision conflicts, out-of-order watermark, quarantine TTL/safe fields, and fail-closed corrupt records.
- **GOTCHA**: `Query` pages are read-committed relative to concurrent writes; revision conditions are required before swapping a rebuild result. Do not describe repository command tests as a live DynamoDB integration test.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/repository.test.ts -t "projection|checkpoint|watermark|quarantine|rebuild"`
- **SATISFIES**: AC1, AC5, AC6, AC7, AC8.

### 10. CREATE `packages/backend/src/modules/usage-pricing/storage.ts` and `storage.test.ts`

- **IMPLEMENT**: pure `[startAt,endAt)` splitter that chooses the earliest of end, next UTC month start, and next price `effectiveAt`; produces exact byte-milliseconds and a deterministic segment source ID/fingerprint.
- **TEST**: no-op zero interval, invalid reverse interval, exact boundary endpoints, rate change inside a month, month change without rate change, simultaneous month/rate boundary, January/February/leap-year/daylight-saving irrelevance, subsecond values, long multi-month interval, and replay-identical segments.
- **GOTCHA**: never use local timezone or fixed 30/31-day assumptions. A segment ending exactly on a boundary belongs only to the preceding half-open interval; the next begins at that instant.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/storage.test.ts`
- **SATISFIES**: AC3, AC6, AC8.

### 11. CREATE `packages/backend/src/modules/usage-pricing/service.ts` and `service.test.ts` — usage recording

- **IMPLEMENT**: dependency-injected service (`repository`, `now`, bounded retry policy) with an internal strict recording input: trusted `internalProjectId`, approved metric, exact base quantity, bounded source kind/ID, and UTC occurrence time.
- **IMPLEMENT**: load occurrence-time price, calculate immutable event, call transactional record, map identical duplicate to the same logical result, reject/quarantine divergent identity, then advance the relevant watermark separately/retryably.
- **IMPLEMENT**: no owner/public project ID path and no raw bearer context. Future authenticated handlers pass `TrustedProjectContext.internalProjectId`; asynchronous processors pass only project identity derived from trusted enforced object/source state.
- **TEST**: two projects with same external source string remain isolated, same project/source duplicate no-ops, divergent payload never charges, later price version does not change history, processing time differs from occurrence time, and watermark retry after successful record is duplicate-safe.
- **PATTERN**: `projects/service.ts:18-29,56-133` and injected fake repository style in credential service tests.
- **GOTCHA**: source IDs are idempotency evidence, not authorization. Never accept project IDs from an HTTP body/path into this service without a prior trusted resolver.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/service.test.ts -t "record|duplicate|price|watermark|project"`
- **SATISFIES**: AC2, AC3, AC4, AC7, AC8.

### 12. EXTEND `service.ts` and `service.test.ts` — storage checkpoint orchestration

- **IMPLEMENT**: `openStorage`, `checkpointStorageThrough`, and `closeStorage` using opaque bounded `storageSubjectId`, trusted project, object byte size, and timestamps. Create is conditional/idempotent; checkpoint/close load the current revision, split the uncheckpointed interval, record each deterministic segment, then conditionally advance/close.
- **IMPLEMENT**: bounded retry on checkpoint revision races. If a crash occurs after some segment events but before checkpoint advancement, retry re-emits identical segment identities and ledger dedupe prevents double cost.
- **TEST**: duplicate open, checkpoint no-op, multiple checkpoints, month/rate splits, trash-like elapsed continuation, close once, duplicate close, out-of-order time, byte-size mismatch, failure after partial segment success, and concurrent revision conflict.
- **GOTCHA**: RUS-04 models storage accounting but does not decide file state. RUS-05 opens only after verified successful completion; RUS-07 closes only after physical permanent removal, not trash.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/service.test.ts -t "storage|checkpoint|close|interval"`
- **SATISFIES**: AC1, AC3, AC6, AC8.

### 13. EXTEND `service.ts` and `service.test.ts` — projection, rebuild, quarantine, and freshness

- **IMPLEMENT**: `getMonthlyProjection(internalProjectId, period, evaluatedAt, freshnessPolicy)` that assembles metric/total aggregate items, canonical decimal quantities/costs, sorted price versions, exact label/exclusions, and independent freshness.
- **IMPLEMENT**: freshness precedence `incomplete` (known quarantined/failed source) > `stale` (required processor heartbeat older than injected policy) > `fresh` > `not-yet-metered`; always return accumulated cost and last-metered evidence without disguising stale/incomplete state.
- **IMPLEMENT**: `rebuildMonthlyProjection` queries all authoritative events, recalculates atoms/grouping/version sets, conditionally replaces aggregates, and retries revision races without updating any event/price amount.
- **IMPLEMENT**: `quarantine` accepts only bounded reason code, safe hashes/timestamps, source kind, and optional trusted project; known-project quarantine marks its watermark incomplete without charging.
- **TEST**: zero-cost fresh, zero-cost not-yet-metered, stale nonzero, incomplete nonzero, multiple versions in one month, all metrics/total, deleted aggregate rebuild, corrupted aggregate repair policy, rebuild/record race, and quarantine exclusion from cost.
- **GOTCHA**: freshness thresholds are injected because RUS-05/RUS-08 schedules are not yet implemented. Do not hardcode a CloudTrail/storage cadence as architecture in this ticket.
- **VALIDATE**: `npm test -- --project node packages/backend/src/modules/usage-pricing/service.test.ts -t "projection|rebuild|fresh|stale|incomplete|quarantine"`
- **SATISFIES**: AC4, AC5, AC7, AC8.

### 14. CREATE `tests/integration/usage-pricing-ledger.test.ts`

- **ASSEMBLE**: real contracts, fixed-point/pricing/storage logic, and service around an in-memory repository that enforces conditional identities/revisions; no AWS and no HTTP route.
- **TEST**: project A records upload and storage; exact duplicate no-ops; a later price is selected only after its boundary; storage splits across UTC month/rate boundaries; projection equals event sum; aggregate deletion/rebuild reproduces it; project B remains separate; malformed/ambiguous evidence is quarantined and changes freshness without cost.
- **TEST**: serialize every returned/query/log-like object and assert no internal project ID, raw source ID, key prefix, stack trace, bucket/object key, token, or AWS resource detail appears in the public projection.
- **PATTERN**: `tests/integration/project-credential-authentication.test.ts`.
- **GOTCHA**: call this an assembled domain/integration-boundary test, not proof of DynamoDB TTL/transaction behavior in AWS.
- **VALIDATE**: `npm test -- --project node tests/integration/usage-pricing-ledger.test.ts`
- **SATISFIES**: AC2 through AC8.

### 15. UPDATE `README.md` and `AGENTS.md`

- **UPDATE**: README status/layout/infra summary for the independent usage table, versioned price seed, ledger/projection/storage contracts, and local tests; state that S3/CloudTrail ingestion, dashboard/API display, and deployment remain future/separately authorized.
- **UPDATE**: change only `AGENTS.md:13` (and paths only if needed) so usage/pricing is truthfully implemented while File Management remains unimplemented. Preserve every canonical product, security, retention, pricing, AWS, and command rule.
- **GOTCHA**: do not copy the wiki locally, claim an AWS deployment, publish actual resource URLs/names, or describe AWS-equivalent cost as an invoice. Restart Codex after the AGENTS change.
- **VALIDATE**: `python tooling/validate_codex_layer.py`
- **SATISFIES**: repository truthfulness and downstream implementation safety.

### 16. RUN targeted and full local validation

- **RUN**: all new contract, fixed-point, price, model, repository, storage, service, infra, and integration tests first.
- **RUN**: formatting, lint, typecheck, complete tests, coverage, and build through committed scripts.
- **GOTCHA**: do not relax 80% thresholds, exclude new module source, use floating-point shortcuts, or update snapshots with internal identifiers.
- **VALIDATE**: `npm run check`
- **SATISFIES**: AC1 through AC8 and zero-regression requirements.

### 17. PREVIEW infrastructure composition against the approved shared development stage

- **INSPECT**: confirm no parallel branch is using `dev-rus02`; inspect relevant current stage state without exposing data; use only npm scripts backed by `tooling/run-sst.mjs`.
- **RUN**: `infra:install` to regenerate ignored pinned provider artifacts, then a fresh `infra:diff` for `dev-rus02`.
- **VERIFY**: exactly one new on-demand usage/pricing table with PK/SK, TTL, expected deletion policy, and only configured immutable price seed items; no control table replacement, API/dashboard/Cognito route change, wildcard IAM, bucket/trail/function, or existing data deletion.
- **GOTCHA**: the wrapper must validate `ntz-cli`, account `162067902192`, principal `arn:aws:iam::162067902192:user/ntz-cli`, region `il-central-1`, and CA bundle. Stop if identity mismatches or SST requests an unapproved bootstrap/write. This task authorizes preview only, not deploy/table/item mutation.
- **VALIDATE**: `npm run infra:install -- --stage dev-rus02` then `npm run infra:diff -- --stage dev-rus02`
- **SATISFIES**: infrastructure composition/retention/least-privilege acceptance evidence.

---

## TESTING STRATEGY

### Unit Tests

Use colocated Vitest tests with dependency injection and actual AWS SDK command inspection:

- Contracts: strict metric/rate/projection/freshness shapes, exact label/currency/exclusions, decimal strings, and no internal fields.
- Fixed point: parse/format, half-up ties, fractions, negative/overflow rejection, 38-digit bounds, and bigint SDK round-trip.
- Pricing: inclusive effective boundary, UTC month divisor, published unit sizes, price snapshot immutability, and excluded metrics.
- Model: every key/item relationship, canonical fingerprints, source hashing, UTC periods, TTLs, and fail-closed corruption.
- Repository: exact commands, no scan/GSI/filter, strong reads/pagination, durable dedupe, divergent source, atomic aggregate updates, revisions, checkpoints, watermark, quarantine, and rebuild.
- Storage: deterministic half-open segmentation across simultaneous month and rate changes.
- Service: trusted project input, duplicate/conflict outcomes, checkpoint crash/retry, projections, freshness, quarantine, and rebuild.
- Infrastructure: table/TTL/protection, one global Dynamo linker, immutable retained seed items, exact current rate evidence, no route/function/wildcard.

### Integration Tests

Use an in-memory repository to exercise the complete accepted-event path and storage/rebuild workflows without AWS. Repository command tests are the DynamoDB integration boundary. The required `infra:diff` validates generated composition but remains non-mutating preview evidence.

No live table write is needed to complete local automated acceptance. A separately authorized deployment can later smoke-test DynamoDB conditions/TTL visibility before RUS-05 consumes the module.

### Edge Cases

- Same source delivered sequentially, after the 10-minute client-token window, and concurrently.
- Same source identity with a different project/metric/quantity/occurrence fingerprint.
- Event at `effectiveAt - 1 ms`, exactly `effectiveAt`, and `effectiveAt + 1 ms`.
- Event at UTC month start minus 1 ms, exactly start, end minus 1 ms, and exactly next month start.
- February/leap year and variable month duration; local Jerusalem DST must have no effect.
- Quantities/costs below one cent and one atto-USD; exact half-up tie; cumulative sub-cent events.
- Maximum product quota storage byte-milliseconds and DynamoDB 38-digit overflow rejection.
- Storage interval crosses a month boundary, a price boundary, both simultaneously, and several months.
- Crash after one/more storage segments record but before checkpoint advance; retry remains exact.
- Duplicate/out-of-order checkpoint/close and mismatched byte-size evidence.
- Aggregate missing/deleted/corrupt; rebuild is deterministic and never mutates events.
- Event recorded while rebuild is calculating; revision conflict forces safe retry.
- Zero usage with no watermark, fresh heartbeat, stale heartbeat, and incomplete/quarantined source.
- Malformed/ambiguous input with known and unknown project attribution; neither charges.
- Expired TTL item still physically present; service treats it logically expired.
- Price config missing metric, duplicate version/effective time, mutated historical record, wrong region/currency/unit/range, or source disagreement.

---

## VALIDATION COMMANDS

Execute every applicable command and retain only non-sensitive pass/fail evidence.

### Level 1: Syntax & Style

```powershell
npm run format:check
npm run lint
npm run typecheck
```

### Level 2: Targeted Unit Tests

```powershell
npm test -- --project node packages/contracts/src/usage-pricing/contract.test.ts
npm test -- --project node packages/backend/src/modules/usage-pricing
npm test -- --project node infra/config/usage-pricing.test.ts infra/usage-pricing.test.ts infra/composition.test.ts
```

### Level 3: Integration and Full Regression

```powershell
npm test -- --project node tests/integration/usage-pricing-ledger.test.ts
npm test
npm run test:coverage
npm run build
npm run check
```

Coverage must retain the existing 80% global statements/branches/functions/lines. Idempotency, occurrence-time price selection, arithmetic, month/rate splitting, rebuild, and quarantine/freshness require direct behavior assertions regardless of global percentage.

### Level 4: Infrastructure Preview

```powershell
npm run infra:install -- --stage dev-rus02
npm run infra:diff -- --stage dev-rus02
```

The wrapper identity preflight and expected diff described in Task 17 are mandatory. Do not run direct `sst`, direct AWS CLI, deploy, or any data write as a substitute.

### Level 5: Manual Validation (Requires Separate Explicit Authorization)

Only after explicit owner approval to mutate/deploy the exact `dev-rus02` implementation:

1. Deploy through `npm run infra:deploy -- --stage dev-rus02` only after reviewing the same-stage diff.
2. Verify the new table exists with on-demand billing, PITR/default encryption, TTL attribute, expected non-production deletion policy, and only the configured pricing items.
3. Through a temporary internal test harness—not a public endpoint—record a synthetic project usage event, repeat it, and confirm one event/one aggregate increment.
4. Add/use a later synthetic price version only in an isolated test stage if rate-boundary persistence needs proof; never mutate a retained shared-stage historical price.
5. Delete/rebuild a disposable aggregate only in isolated data explicitly authorized for destructive validation.
6. Confirm responses/evidence contain no internal project/source/table keys or raw sensitive inputs; remove disposable data/stage only under separate authorization.

No live mutation is authorized by this planning request or by the earlier issue-label authorization.

### Level 6: AI-Layer Validation

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

Run because `AGENTS.md` repository-status context changes. Restart Codex after that implementation change.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1 — Independent usage table/access patterns:** One on-demand usage/pricing table supports immutable prices, append-only events, metric/total aggregates, checkpoints, dedupe, quarantine, and per-source watermarks through bounded PK/SK reads; TTL applies only to the intended retained evidence and production deletion protection is enabled.
- [ ] **AC2 — Published immutable pricing:** Deployment configuration contains an append-only, provenance-rich `il-central-1` AWS list-price snapshot for every approved metric; no pricing UI/refresh exists and historical seed items cannot be rewritten/removed through ordinary config changes.
- [ ] **AC3 — Occurrence-time exact charging:** Recording selects the inclusive effective version by UTC occurrence time, stores the applied version/rate/cost on the event, uses exact fixed-point bigint arithmetic/explicit rounding, and never retroactively changes an event.
- [ ] **AC4 — Durable idempotent contract:** Trusted project, metric, exact quantity, source kind/identifier, and occurrence time produce one immutable event/charge across sequential, delayed, and concurrent duplicate deliveries; a divergent reuse never overwrites or charges.
- [ ] **AC5 — Rebuildable AWS-equivalent projection:** Authoritative events rebuild current or specified UTC project-month metric quantities/costs and total USD, return the exact `AWS-equivalent usage cost` label, show all applied price versions, and exclude invoice/free-tier/discount/credit/tax/shared-infrastructure concepts.
- [ ] **AC6 — Storage byte-time semantics:** Checkpoints use deterministic `[start,end)` byte-millisecond intervals, split at UTC month and price boundaries, retry partial progress without duplicate cost, and close only when the consuming file lifecycle says physical storage ended.
- [ ] **AC7 — Independent freshness/quarantine:** Watermarks and safe quarantine evidence do not alter accumulated cost; projections visibly distinguish fresh, stale, incomplete, and not-yet-metered states and provide nullable last-metered evidence.
- [ ] **AC8 — Explicit correctness tests:** Tests cover idempotency, divergent identity, rate/month boundaries, fractional normalization/rounding, overflow, aggregate rebuild/races, checkpoint partial retry, TTL lag, quarantine, freshness, project isolation, and every excluded cost class.
- [ ] All targeted/full validation commands pass with zero errors and existing 80% global coverage thresholds.
- [ ] Infrastructure preview shows only the intended table/price-item/output additions and neutral Dynamo-link refactor; no AWS deployment/data mutation or existing resource replacement/deletion occurred.
- [ ] README/AGENTS status is truthful, canonical decisions remain in the wiki, and no secret/internal identifiers or AWS implementation details are exposed.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order and each targeted validation passed immediately.
- [ ] Price snapshot values/provenance were re-read from official current sources and independently cross-checked.
- [ ] No historical price config/item was edited or removed.
- [ ] No JavaScript floating-point value participates in quantity/money persistence or aggregation.
- [ ] DynamoDB transaction conditions and ordered cancellation reasons distinguish duplicate, divergent source, and retryable conflict.
- [ ] Event records remain authoritative; aggregates rebuild exactly and concurrent writes cannot be lost.
- [ ] Storage segment IDs, interval boundaries, checkpoint revisions, and partial retries are deterministic.
- [ ] Public projection uses exact label/currency/exclusions, contains no internal IDs/keys, and shows freshness separately.
- [ ] No new API route, Lambda ingestion function, dashboard UI, file bucket, CloudTrail trail/log bucket, or automated price refresh was introduced.
- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run build`, and `npm run check` pass.
- [ ] `dev-rus02` diff ran only after identity/shared-stage preflight; no deployment or data mutation occurred without explicit authorization.
- [ ] Codex-layer validation passes and Codex restart after AGENTS change is reported.
- [ ] AC1-AC8 are checked against evidence and code review treats duplicate cost, silent metering loss, cross-project attribution, and historical repricing as release blockers.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **No HTTP route in RUS-04:** The ticket asks for recording/query contracts and projections, while RUS-09 owns dashboard display. This plan implements internal typed services/shared response schemas only. If an owner-facing usage route is required now, amend the plan before implementation because it adds owner resolution, API permissions, handlers, and transport/security tests.
- **First published tier under MVP bounds:** The plan snapshots the applicable zero-begin-range on-demand price dimension for each metric. The 5 GB storage and MVP traffic limits keep project usage in that range, and this is an AWS-equivalent project calculation rather than account-tier allocation. If product intent requires account-wide tier sharing or project-specific progressive tiers, that is an architecture/cost-attribution change and must be decided before implementation.
- **Freshness thresholds:** The architecture requires freshness visibility but does not set processor schedules. This plan keeps thresholds injected into projection evaluation. RUS-05/RUS-08 must define heartbeat schedules and pass matching policies; do not hardcode them as product constants here.
- **Download pricing gate:** RUS-04 captures/calculates download-related list rates but emits no live download events. RUS-08 must pass the documented full/range/cancelled/repeated/expired/unused acceptance exercise before enabling non-zero live download cost.
- **Price-source disagreement:** AWS states the service pricing page controls if it differs from the Price List. Implementation stops for explicit resolution if the `il-central-1` SKU/rate/unit cannot be mapped unambiguously; no guessed or another-region rate is acceptable.
- **No critical implementation ambiguity remains** under these assumptions. The numeric representation, table/access topology, idempotency transaction, rebuild race policy, storage semantics, retention, module/API boundary, tests, and preview order are specified.

## NOTES (open canvas)

### Why fixed-point bigint rather than decimal strings in aggregates

Canonical strings are ideal at REST boundaries but DynamoDB cannot atomically `ADD` string values. Reading a string aggregate, recalculating it, and conditionally rewriting it would introduce a hot optimistic loop for every event. Atto-USD and integral base-quantity bigint values fit comfortably inside DynamoDB's 38-digit Number limit under the MVP quotas, preserve sub-byte-time prices, and let one transaction atomically append evidence and increment projections. The pinned SDK was locally probed successfully with bigint marshalling and custom wrapped-number unmarshalling. Formatting remains a boundary concern.

### Why both a dedupe item and a conditionally unique event

The 90-day dedupe item provides direct source lookup, divergent-payload diagnosis, and the required operational retention. The 14-month event is the authoritative ledger and remains a second condition after dedupe TTL deletion. DynamoDB's 10-minute client token is useful only for immediate transport retries and cannot satisfy at-least-once asynchronous replay by itself.

### Why deployment-managed price items

Rates change only through reviewed deployments in the MVP. Infrastructure-managed `TableItem` records make the deployed snapshot explicit and eliminate startup/write side effects or a hidden pricing admin endpoint. Append-only source history, stable version identities, retained deletes, ignored in-place item updates, table production protection, and repository strict parsing jointly defend immutability. Automated refresh remains intentionally absent.

### Data flow

```text
trusted internal project + metric + base quantity + source identity + occurredAt
  -> canonical input fingerprint
  -> effective price query (occurredAt, not processedAt)
  -> fixed-point immutable event cost
  -> DynamoDB transaction
       conditional dedupe put
       conditional append-only event put
       ADD metric aggregate atoms/revision
       ADD total aggregate atoms/revision
  -> retryable monotonic watermark update
  -> recorded | identical duplicate | divergent-source quarantine/conflict

project + UTC month
  -> aggregate query -> canonical AWS-equivalent projection + independent freshness
  -> if rebuilding: strong event query -> recompute -> revision-conditional aggregate replace
```

### Rollout and external-action boundary

All calculations, contracts, command shapes, and assembled behavior can be validated locally. The required shared-stage `infra:diff` is preview-only and must propose a new table and pricing seed items without applying them. Deployment/table creation/price insertion or synthetic live data remains separately authorized. RUS-08's download-metering acceptance exercise is also a later explicit live gate.

### Confidence Score

**9/10** for one-pass implementation under the stated assumptions. Existing RUS-02/RUS-03 code supplies strong Zod, Dynamo transaction, service injection, SST composition, and test patterns. Official DynamoDB/SST/Price List behavior is documented, and the plan resolves arithmetic and concurrency rather than leaving them to implementation. The remaining risk is selecting and evidencing exact current `il-central-1` price dimensions; the explicit stop/cross-check rule contains that risk.

## AMENDMENTS

(None at creation.)
