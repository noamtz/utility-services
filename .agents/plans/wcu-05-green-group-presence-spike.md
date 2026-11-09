# WCU-05: GREEN group-presence evidence spike

## Feature description

Implement the bounded, offline portion of issue #31: a repeatable evaluator and sanitized fixtures for the existing `getChats` and `getGroupData` group-discovery approach. The evaluator must make present and unknown outcomes explicit and must not treat a missing group as proof that the bot left. A separately authorized live experiment supplies the only evidence that can establish whether a confirmed-left state is supportable.

## Context and decisions

- Implements [#31](https://github.com/noamtz/utility-services/issues/31); no native blocker is open.
- Inherits the WhatsApp Communication Utility architecture: polling is a modest directory check; the documented webhook types do not supply a bot-membership event; an incomplete or stale snapshot is `unknown`.
- `../communication-service/src/directory.ts` already establishes the POC shape: `getChats`, per-group `getGroupData`, max four concurrent enrichments, and `complete: false` for a provider or parse failure.
- No GREEN request, message, credential, bot number, group ID, or client data belongs in this implementation.

## Scope

1. Add a small pure TypeScript evaluator in the future communication bounded-context path.
2. Model a scan with safe opaque fixture group keys, observation time, completeness, and optional group-data confirmation.
3. Classify a target as `present` only with a complete scan and matching group-data confirmation. Classify every absence, incomplete scan, delayed sync, or provider error as `unknown`.
4. Add tests for join, leave candidate, delayed sync, and provider error fixtures.
5. Publish a sanitized evidence protocol with observation fields, rate/scale measurement sheet, automation fixture minimum, and the WCU-07 decision rule.

## Non-goals

- A live provider run, messaging, credential access, deployment, or a production directory endpoint.
- A `left` state based on unverified absence. WCU-07 may add one only after owner-authorized live evidence supports a provider confirmation rule.

## Files

- `packages/backend/src/modules/communication/group-presence-spike.ts` — pure, safe outcome evaluator.
- `packages/backend/src/modules/communication/group-presence-spike.test.ts` — controlled fixture behavior.
- `docs/communication/group-presence-spike.md` — evidence protocol and decision record.

## Validation

```powershell
npm test -- --run packages/backend/src/modules/communication/group-presence-spike.test.ts
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Acceptance mapping

- Controlled join/leave/delayed-sync/provider-error cases: local fixtures and evaluator tests.
- Observation timestamps and measured delay: protocol defines fields; no measurement is claimed before live authorization.
- Missing-group semantics: test and document `unknown`.
- 200+ group rate/scale: protocol defines bounded concurrency and the required recorded measurements.
- WCU-07: protocol defines a publish gate requiring repeatable authorized evidence; otherwise retain `unknown`.
