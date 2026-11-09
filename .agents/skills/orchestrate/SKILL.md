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

## Starting a run

When the skill is invoked:

1. Treat `$ARGUMENTS` as the work entrusted to the orchestrator.
2. Create one workstream for each distinct unit of work explicitly assigned by the operator.
3. Keep one issue, feature, or requested outcome as one workstream. Do not split it into additional workstreams unless the operator asks.
4. Treat planning, investigation, implementation, correction, and review as work performed inside the same workstream.
5. Create the run log at `.agents/orchestration/runs/<date>-<short-name>.md`.
6. Record each workstream's outcome, primary owner, expected result, status, evidence, and next step.
7. Create a separate git worktree for each workstream that may change the repository.
8. Start the workstream owner inside its assigned worktree using the native agent tools available in the current harness.
9. Update the run log when a workstream starts, returns evidence, becomes blocked, requires a decision, or completes.

The main orchestrator remains in the original repository checkout and owns the run log.

Workstream agents operate inside their assigned worktrees and report their results to the orchestrator. They may use other agents to complete their work, but that does not create additional top-level workstreams.

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