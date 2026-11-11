---
name: orchestrate
description: coordinate serveral workstreams from one session. Use when asked to orchestrate work, start a workstream, assign a workstream, or manage serveral tasks or agents
argument-hint: "[work to orchestrage]"
---

# Orchestrate

## Input 
Work to orchestrate: `$ARGUMENTS`

## Purpose 

- Coordinate several workstreams from one agent session.
- Keep the work moving while the operator is away or focused on something else
- Keep one clear view of the combined work and bring decisions back to the operator

## Responsibilities

- Remain responsible for the combined outcome across all workstreams while delegating the work inside them.
- Give every workstream one clear outcome and one owner.
- Use the native agent tools available in the current harness to start, message, and follow agents.
- Track the status, next step, and expected result of every workstream.
- Confirm that every agent report includes the expected result and relevant evidence before marking a workstream complete.
- Check lightweight authoritative facts when useful, such as whether a pull request, CI result, or review exists.
- Do not repeat implementation, review, or validation work unless the evidence is missing or inconsistent.
- Bring decisions, blockers, and important risks back to the operator.

## Workstream contract

A workstream is one lane of work that the orchestrator is responsible for coordinating.

Each workstream has:

- One clear outcome.
- One primary owner.
- An expected result and the evidence that should come back.
- A current status and a clear next step.

A workstream may involve one or more agents. The primary owner remains responsible for returning the result and evidence to the orchestrator.

Planning, investigation, implementation, correction, and review are stages within a workstream, not separate workstreams.

The workstream stays open until the expected result and evidence have been returned, or the operator decides to close it.

## Available capabilities

Use the following skills to run workstreams.

### Deliver

Deliver always launches using astra unless the operator specifies otherwise.

Use `piv-deliver` when one workstream should go from an issue, request, document, or existing plan to a validated pull request with independent review.

`piv-deliver` owns the planning, implementation, pull request, review, one correction round when needed, second review, and final recommendation inside that workstream.

Track the workstream as one unit. Do not recreate the internal `piv-deliver` stages as separate top-level workstreams.

### Plan

Plan always launches using sol unless the operator specifies otherwise.

Use `piv-plan-implementation` when new work needs an implementation plan.

Expected result: a plan ready for operator approval. Do not begin implementation until the plan is approved.

### Investigate

Investigate always launches using luna unless the operator specifies otherwise.

Use `piv-investigate-issue` when an issue or bug needs to be understood before changing the code.

Expected result: a root-cause report with supporting evidence and a recommended next step.

### Implement

Implement always launches using sol unless the operator specifies otherwise.

Use `piv-implement` when an approved plan is ready to build.

Expected result: a validated implementation, commit, and open pull request.

### Review

Review always launches using luna unless the operator specifies otherwise.

Use `piv-review-pr` when an open pull request is ready for independent review.

Expected result: a posted review with a clear verdict and any findings.

Choose the capability that matches what the workstream needs next. Do not run every capability by default.

## ARCHON

- If the operator asks you to use Archon to plan, deliver, or ship work, use the `archon-cli` skill and register the resulting Archon run as one workstream.

## Interactive workstreams

When a workstream owner asks a question:

- If the answer is already explicit in the source request, operator decisions, or run log, relay it to the owner.
- Otherwise, bring the question to the operator with the context needed to answer it and a recommendation when useful.
- Do not answer product, scope, priority, trade-off, or authority questions on the operator's behalf.
- Send the operator's final answer back to the same workstream owner so its context is preserved.
- Record answers and decisions that change the run in the run log before continuing.

## Standing decisions

When the operator answers a question that will come up again in this run:

- Record it in the run log's standing decisions table, in the operator's words, with the scope it applies to.
- Before adding a row, say "For the rest of this run, …" in front of it. If that reads as wrong, it is a one-time answer. Log it as an event instead.
- Apply a matching standing decision without asking again. Note which one you applied.
- Never record a rule the operator did not decide, and never grant the run a permission the operator did not give.
- If the operator changes an answer, rewrite that row and log the change.


## Starting a run

When the skill is invoked:

1. Treat `$ARGUMENTS` as the work entrusted to the orchestrator.
2. Create one workstream for each distinct unit of work explicitly assigned by the operator.
3. Keep one issue, feature, or requested outcome as one workstream. Do not split it into additional workstreams unless the operator asks.
4. Treat planning, investigation, implementation, correction, and review as work performed inside the same workstream.
5. Create the run log at `.agents/orchestration/runs/<date>-<short-name>.md`.
6. Record each workstream's outcome, primary owner, expected result, status, evidence, and next step.
7. Before starting or continuing any workstream, read and follow `references/launching.md`.
8. Start the workstream owner inside its assigned worktree using the native agent tools available in the current harness.
9. Update the run log when a workstream starts, returns evidence, becomes blocked, requires a decision, or completes.

The main orchestrator remains in the original repository checkout and owns the run log.

## Final handoff

When the run reaches a stopping point:

- Lead with the combined outcome.
- Give each workstream one compact result with its artifact or pull request and enough proof to trust it.
- Do not repeat detailed implementation, validation, or review reports when they are already available through linked artifacts.
- Put decisions, blockers, important risks, incomplete work, and required operator attention at the end.
- Link to the run log and relevant artifacts for deeper detail.
- Omit empty sections and routine housekeeping that does not require operator attention.

## Run log

For every orchestration run, create and maintain one run log at:

`.agents/orchestration/runs/<date>-<short-name>.md`

The orchestrator owns the run log. Workstream agents report their results to the orchestrator rather than editing the log themselves.

Record:

- The original request from `$ARGUMENTS`.
- Upcoming workstreams.
- Workstreams in flight.
- Blocked workstreams.
- Completed workstreams.
- The outcome, owner, expected result, evidence, current status, and next step for each workstream.
- Decisions that affect the run.

Update the run log when a workstream changes state, returns meaningful evidence, becomes blocked, or requires an operator decision.

Do not record every agent message or minor action.