# WCU-06: communication utility enablement and GREEN connection registration

**Issue:** #32
**Branch:** `feature/wcu-06-communication-connections`

## Context

The WhatsApp architecture selects a new communication bounded context in the existing SST app. A project remains the authorization boundary; it may enable communication with or without File Management. Credentials must never enter project responses, logs, or browser code. The initial consumer has one connection, while the persisted shape must permit more later.

## Scope and decisions

- Add `communication` to the project utility contract and permit projects to select File Management, communication, or both.
- Keep existing File Management projects readable by treating their stored File Management item as optional only when that utility is disabled.
- Add a separate communication table and a single owner-authenticated control route for connection registration and inspection.
- Accept provider credential material only at registration, write it to an SST scoped secret, and persist only a secret reference plus non-secret instance identity. The registration response never includes credential material.
- Atomically reserve a provider instance per installation using a unique DynamoDB item; reject duplicate binding and return 404 for a guessed/wrong-project connection id.
- The dashboard shows a non-sensitive connection state; it never receives provider credentials.

## Tasks

1. Extend project contract and model/repository serialization for independently enabled utilities; preserve old File Management records. Add contract/model/repository tests.
2. Add `modules/communication-connections` model, repository, service, handlers, and runtime. Validate all input; require dashboard owner context; use conditional writes for installation-wide provider-instance uniqueness. Add tests for lifecycle, cross-project denial, duplicate binding, and redaction.
3. Add SST communication table, scoped secret and control route with minimum DynamoDB/secret permissions. Update composition tests without running SST/AWS.
4. Add dashboard API and a project details panel that renders connection state and submits registration without retaining credential state after the request. Add component/API tests.
5. Run targeted tests followed by `npm run check`, write implementation report, commit, push, open PR, then obtain an independent review.

## Validation

- `npm test -- --run packages/contracts/src/projects/contract.test.ts packages/backend/src/modules/identity-control/projects packages/backend/src/modules/communication-connections apps/dashboard/src/projects infra`
- `npm run check`

## Risks and assumptions

- SST secret values cannot safely be provisioned by an owner dashboard request through an immutable infrastructure `Secret`; implementation uses an injected secret-store adapter whose production transport is deliberately left unbound until a separate credential provisioning decision. This preserves the no-credential-return contract but does not make live GREEN setup deployable. If #32 must include live secret writes, the owner must approve the concrete AWS secret service and lifecycle.
- The architecture page is marked a local review draft; this plan implements only issue acceptance criteria and does not update the wiki.
