---
name: piv-deliver
description: Deliver one workstream through planning, implementation, a pull request, independent review, one correction round, and a verified return to the parent orchestrator.
argument-hint: "[issue, request, document, or existing plan]"
---

# Deliver one workstream

Input: $ARGUMENTS

Own one workstream from its source through a reviewed pull request. Return the result and its proof to the parent orchestrator.   .

## Ownership contract

- Treat the input as one workstream with one final outcome.
- Own coherence across every context used inside this run.
- Use the PIV skills for their named jobs instead of copying their process here.
- Keep planning, implementation, and independent review in separate contexts.
- Continue the same implementation owner when corrections are needed.
- Confirm that the artifacts and facts promised by each agent exist. Do not repeat its work from scratch.
- Stop for missing authority, a real scope decision, or merge approval.

## 1. Resolve and plan

1. Read the complete source request, issue, document, or plan.
2. If an implementation-ready plan already exists, use it.
3. Otherwise, launch a fresh planning context with `piv-plan-implementation`.
4. Confirm that the plan addresses the requested outcome before implementation starts.

## 2. Implement and open the pull request

1. Launch a fresh implementation context with `piv-implement` and the approved plan.
2. Keep the implementation owner in the assigned worktree.
3. Require the implementation owner to validate the change, commit it, push it, and open the pull request.
4. Keep the implementation owner available for one correction round.

## 3. Review independently

1. Launch a fresh review context with `piv-review-pr`.
2. Give the reviewer the pull request and the original requested outcome.
3. Require the reviewer to inspect the current pull request, run relevant validation, and return findings with evidence.

## 4. Correct once and review again

1. Decide whether each finding is important for this change.
2. Send every important finding to the same implementation owner. Ask it to use its judgment, correct the findings, validate the result, and update the pull request.
3. Record why any finding is not important for this change. Decide whether it is rejected, mentioned as a follow-up, or captured as separate work.
4. After the correction round, launch a fresh independent review of the updated pull request.
5. Do not start a second correction round on your own. Return the second review to the parent orchestrator with one recommendation: run another correction round, capture separate work, or accept the result.

## 5. Confirm the final state

Confirm the current pull request, validation state, review verdict, unresolved findings, and any decision that still needs the operator. Do not merge the pull request.

## 6. Return the outcome

Return:

- The workstream outcome.
- The plan and pull request, with absolute paths.
- Validation and independent review proof.
- What the correction round changed.
- Any unresolved finding and what was decided about it.
- Your recommendation for the next step.