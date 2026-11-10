# WCU-04: Per-file deletion protection

Implements GitHub issue #30 after closed dependency WCU-03. A valid server-side project API key may turn protection on or off for its own project. This is a symmetric File Management credential authority; dashboard identity, WhatsApp, and CPA policy are outside this ticket.

## Design

- Expose `deletionProtected` on every public `File`; legacy and new records read as `false`.
- Add `PUT /v1/files/{fileId}/deletion-protection` with `{ "deletionProtected": boolean }`, authenticated through the existing project bearer path.
- Persist last-change time and key lookup ID internally for auditability. Do not expose a secret, object key, or provider detail.
- Add conditional DynamoDB updates. All trash and permanent-removal claims require no protection flag; the update rejects a file already claimed for purge. These conditions close the toggle/delete race.
- Protected bytes remain in the current file record and quota. Purge skips protected records. Clearing protection restores existing lifecycle behavior.

## Owning files

- `packages/contracts/src/files/contract.ts` — request and file response contract.
- `packages/backend/src/modules/file-management/{model,repository,service,lifecycle,handlers,runtime}.ts` — state, conditional persistence, service authority, lifecycle enforcement, and endpoint composition.
- `infra/config/file-management.ts` and `packages/backend/src/functions/files/update-file-deletion-protection.ts` — route and least-privilege entry point.

## Validation

- Contract, model, repository, lifecycle, service, handler, runtime, and infrastructure tests.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- Independently review the completed PR before requesting merge. No AWS deployment or provider call is part of this ticket.
