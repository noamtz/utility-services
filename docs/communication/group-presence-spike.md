# GREEN group-presence spike: offline evidence and live protocol

## Result of the offline spike

The existing POC shape is reproducible locally: call `getChats`, then confirm each listed target with `getGroupData`. The fixture evaluator publishes `present` only when a complete scan and group-data response agree. It returns `unknown` for a missing group, partial scan, delayed group-data confirmation, or provider error.

No live GREEN-API calls were made for this result. No bot number, token, group identifier, client data, or measured provider delay is recorded here.

## Why absence remains unknown

The known API shape can distinguish a current positive observation from a failed or incomplete observation. It cannot, from a missing row alone, distinguish a bot leave from provider synchronization lag, pagination/partial listing, an API failure, or a malformed group-data response. Repeating missing rows is still absence evidence, not a provider membership event.

## Owner-authorized live experiment

Run this only after the owner separately authorizes access to the dedicated GREEN instance and controlled test group. Do not put credentials or identifiers in the repository, console evidence, or issue comments.

For each scenario, capture a sanitized row containing: randomized run ID, scenario, action timestamp, first `getChats` observation timestamp, `getGroupData` observation timestamp, scan completeness, response classification, and delay in whole milliseconds. Retain raw provider output only in an approved restricted evidence store; publish only the sanitized rows.

| Scenario        | Controlled action                                      | Required observation                             | Pass condition                                                                    |
| --------------- | ------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Join            | Add dedicated bot to controlled group                  | Poll `getChats`, then `getGroupData`             | Group becomes `present`; record action-to-presence delay.                         |
| Leave candidate | Remove dedicated bot from controlled group             | Repeat complete scans after an earlier `present` | Keep `unknown` unless provider supplies an independently verifiable leave signal. |
| Delayed sync    | Observe directly after join and leave                  | Record each polling result and delay             | Partial, missing, or unconfirmed observations stay `unknown`.                     |
| Provider error  | Induce a safe test failure or use a controlled adapter | Record safe error category                       | State remains `unknown`; no stale presence is republished as fresh.               |

## Rate and scale evidence

The smallest automated fixture is one controlled group, one target key, a fake `getChats` response, and a fake `getGroupData` response for each of the four scenarios. Before a 200-plus group scan is accepted, record the provider plan limits, request count (`1 + group-data calls`), bounded concurrency (the reference POC uses four), total scan duration, per-call error count, and the proportion of scans marked incomplete. No rate or scale claim is made until this run is measured.

## WCU-07 decision rule

WCU-07 may publish `present` using the tested positive rule. It must publish `unknown` for absence until an owner-authorized live experiment produces repeatable evidence of a provider-supported leave signal and documents its freshness bound. If that evidence does not exist, WCU-07 keeps the unknown state and selects a stronger provider method rather than inferring a leave.
