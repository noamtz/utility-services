# GREEN group-presence spike: offline evidence and live protocol

## Result of the offline spike

The existing POC shape is reproducible locally: call `getChats`, then confirm each listed target with `getGroupData`. The fixture evaluator publishes `present` only when a complete scan and group-data response agree. It returns `unknown` for a missing group, partial scan, delayed group-data confirmation, or provider error.

Before the live baseline below, no live GREEN-API calls were made for the offline result. No bot number, token, group identifier, client data, or measured provider delay is recorded here.

## Live baseline: 2026-11-10

The owner supplied the Doron Trial GREEN credential through a one-time loopback form. The form checked the instance ID against the local POC record and confirmed GREEN reported the instance as `authorized`. The credential stayed in process memory and was discarded after the observations; it was not saved to AWS, the repository, or the evidence below.

Run `77aa4619b6fd1798` made five complete, read-only `getChats` / `getGroupData` observations at 09:46:07, 09:46:43, 09:49:15, 09:51:46, and 09:57:47 UTC. Each listed the controlled Trial test group and confirmed it through group data, so each classified the bot as `present`. No raw provider response or personal identifier was retained in this evidence. The group membership was not changed during this baseline; join, leave, and synchronization delay were still unmeasured at that point. The bot's own credential can leave the group but cannot rejoin it; the controlled sequence needs a group admin to remove and then restore the bot.

## Controlled leave and rejoin: 2026-11-10

The owner supplied a credential for the same verified POC instance through a fresh one-time form for run `f244a98881a50716`. A group admin removed and restored the bot in the controlled Trial test group. The times below use the owner's immediate chat reply as the **action signal**, not an instrumented WhatsApp action timestamp; the elapsed values are therefore observation timing relative to that signal, not a measured GREEN delivery guarantee. The credential was discarded after the final scan. No message was sent and no webhook setting was changed.

| Action / observation (UTC) | Elapsed from action signal | `getChats`   | `getGroupData` | Safe state              |
| -------------------------- | -------------------------: | ------------ | -------------- | ----------------------- |
| Before removal, 12:38:30   |                          — | Listed       | Confirmed      | `present`               |
| Removal signaled, 12:39:27 |                          — | —            | —              | —                       |
| 12:39:30                   |                        3 s | Still listed | HTTP error     | `unknown`               |
| 12:40:37                   |                       70 s | Still listed | HTTP error     | `unknown`               |
| 12:41:48                   |                      141 s | Still listed | HTTP error     | `unknown`               |
| Re-add signaled, 12:43:05  |                          — | —            | —              | —                       |
| 12:43:07                   |                        2 s | Listed       | Confirmed      | `present`               |
| 12:44:44                   |                       99 s | HTTP error   | Confirmed      | `unknown` for that scan |
| 12:46:17                   |                      192 s | Listed       | Confirmed      | `present`               |

The group remained listed in `getChats` for at least 141 seconds after the removal signal, so that list entry alone did not establish current membership. The observer did not retain HTTP status or raw error body for the `getGroupData` failures, and cannot claim a provider-confirmed `left` state from them. The single successful rejoin observation was within two seconds of the owner's signal, but the stale chat listing means this is not a measured chat-list synchronization delay. The later `getChats` HTTP error shows that an incomplete scan must be `unknown` even when group data succeeds. The final complete scan confirmed that the bot was restored.

GREEN webhooks remain the primary path for incoming messages and message status in the communication utility. This group-presence experiment uses modest provider reads because GREEN's published webhook type list does not include bot group join or leave. It does not propose polling every message or reusing the Doron walking-skeleton webhook as the utility endpoint. One controlled group does not establish a freshness bound or a 200-plus-group operating rate.

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
