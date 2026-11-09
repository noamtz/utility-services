# WCU-02: installation-regional pricing and download metering

## Feature description

Make pricing seed selection and CloudTrail download-metering infrastructure derive their account and region solely from the resolved installation target.  Each selected target must have one complete immutable USD rate set for its region; an unlisted region must stop synthesis before resources are created.

## Inherited decisions

- Implements [#28](https://github.com/noamtz/utility-services/issues/28); prerequisite #27 is closed on `main`.
- The approved architecture requires an independent account and region per installation, immutable published regional price versions, and AWS-equivalent estimates rather than invoices.
- The installation registry remains the only source of target identity. This ticket does not add or approve a new installation, access AWS, enable priced downloads, or alter the ledger, quarantine, replay, or freshness model.

## Context to read before implementation

- `infra/config/installation-target.ts`: resolved target identity and stage binding.
- `infra/config/usage-pricing.ts`: rate provenance, price-version seed generation, and append-only validation.
- `infra/config/download-metering.ts` and `infra/download-metering.ts`: log-prefix, IAM, notification, CloudTrail, and function environment configuration.
- `sst.config.ts`: composition boundary where the resolved installation must be passed to both modules.
- `packages/contracts/src/usage-pricing/contract.ts`: public price-version validation.
- `packages/backend/src/modules/usage-pricing/cloudtrail-log.ts`: trusted record scope checks.

## Implementation plan

1. **UPDATE public price contract**: validate a general AWS region shape rather than an Israel literal, retaining strict rate completeness.
2. **UPDATE pricing configuration**: model immutable rate-set histories keyed by product region; expose a selector that validates region identity and fails closed if it has no complete published history. Preserve the current Israel version and add a distinct Frankfurt fixture/history with independent rate values and provenance for target-scoped tests.
3. **UPDATE metering configuration**: accept an explicit target account and region for regional log-prefix construction and reject invalid values. Remove deployment constants carrying Israel identity.
4. **UPDATE resource factories and SST composition**: pass the `ResolvedInstallationTarget` through to pricing and metering factories. Build CloudTrail IAM conditions, logs, event notification, function environment, and price seed items from that value only.
5. **ADD targeted tests**: prove Israel continuity, Frankfurt account/region selection, wrong-region archive rejection, missing regional rates failing before resource creation, and unchanged record attribution/quarantine behavior.
6. **VALIDATE**: run focused Vitest tests during edits, then formatting, lint, type checking, test coverage, and build. Write an implementation report with any deviation.

## Acceptance mapping

- Israel literals removed from target-dependent paths: steps 1, 3, and 4.
- Complete regional rate selection and fail-closed behavior: steps 1 and 2.
- Immutable attribution and cost semantics: step 2 plus existing ledger tests.
- CloudTrail identity, bytes, quarantine, replay, freshness: steps 3 to 5.
- Israel and Frankfurt fixtures plus wrong-region/rate mismatch cases: step 5.

## Risks and constraints

- No external target can be added without owner approval. Frankfurt remains a synthetic local target fixture.
- Existing raw CloudTrail and event schemas already carry account/region; retain that enforcement rather than reconstructing identity from a path alone.
- Do not enable `priced` downloads: the required architecture acceptance exercise remains a release gate.

## Validation commands

```powershell
npm test -- --runInBand
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```
