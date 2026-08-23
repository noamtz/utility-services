# Implementation Report - RUS-06 Private Download and Stable Public Access

**Plan**: `.agents/plans/rus-06-private-download-stable-public-access.md`  
**Branch**: `feature/rus-06-private-download-stable-public-access`  
**Status**: COMPLETE AND DEPLOYED TO `dev-rus02`

## Summary

Implemented project-authenticated private download authorization and an unauthenticated stable public download route that revalidates the exact public project/file pair before returning a fresh non-cacheable S3 redirect. Both flows enforce ready-only state, current project-specific expiry, canonical private object keys, direct S3 transfer, least-privilege route permissions, and secret-safe observability.

Deployed validation also exposed and fixed two pre-existing composition gaps required for the end-to-end journey: File Management now isolates its control-table document client from the file-table BigInt decoder, and the upload route grants the exact `PutItem`/`UpdateItem` member actions used by its DynamoDB transaction.

## Tasks completed

- Added strict public path, download transfer, authorization, response schemas, types, exports, and contract tests.
- Added a shared HTTP boundary runner and fixed 302/no-store redirect factory without changing JSON endpoint behavior.
- Added bounded `GetObjectCommand` presigning with no fixed Range or response overrides.
- Added exact `PublicFiles` GSI pair lookup with duplicate/corrupt fail-closed handling.
- Added ready-only private/public download orchestration with live project settings.
- Added private/public handlers, runtime composition, Lambda entry points, exact routes, and route-specific `s3:GetObject` permissions.
- Extended assembled lifecycle coverage for downloads, isolation, freshness, denial states, range behavior, and log safety.
- Isolated control/file DynamoDB base clients and added the missing upload transaction member permissions.

## Validation results

- Focused unit suite: PASS.
- Focused integration/infrastructure suite: PASS.
- `npm run check`: PASS.
- Full suite: 69 files / 430 tests.
- Coverage: 87.52% statements, 81.58% branches, 93.13% functions, 90.03% lines.
- Fresh `dev-rus02` infrastructure diffs: PASS through the required wrapper and exact AWS identity preflight; no table/bucket replacement or public-access change.
- `dev-rus02` deployment: PASS through the required wrapper.
- Deployed validation: PASS, 33 assertions covering owner/project/key issuance, private/public direct uploads and asynchronous completion, owning-project downloads, cross-project and malformed-key denial, stable 302/no-store/empty-body behavior, fresh redirects, direct S3 `206` range delivery, one-minute expiry rejection, stable-route refresh, guessed/wrong-pair denial, and fail-closed non-ready state.
- CloudWatch safety scan: PASS across 6 relevant log groups / 128 messages, with 0 bearer values, signing-query fields, presigned URLs, or object keys.
- Fixture credentials: all disposable Cognito owners deleted and all API keys revoked; 0 active fixture keys remain.

## Deviations and issues encountered

SST previews included generated code-asset replacement cycles, shared Lambda code refreshes, and dashboard asset refreshes in addition to the new routes. Review confirmed these were generated assets/build resources, not durable data-resource replacement or public exposure.

The first deployed run found control-table numeric settings being decoded as BigInt because the file API shared a base DynamoDB client with the file-table decoder. A separate base client fixed the fail-closed authentication error, and a runtime regression test preserves the boundary.

The next run found the upload role lacked the `PutItem`/`UpdateItem` member permissions required by its transaction. The final policy adds only those actions on the stage file table, with an explicit infrastructure assertion.

Two early disposable Cognito passwords were echoed by the local test transport while the harness was being hardened. Both disposable owners were deleted immediately, no project API key was exposed, the transport was corrected, and a cleanup audit revoked the two active keys left by the earliest failed run. No active disposable credential remains.

The shared stage retains 23 named validation project records and disposable file/state records because project deletion is not an implemented product operation. Their owners are deleted and their API keys are revoked.
