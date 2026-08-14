---
name: system-evolution-review
description: Compare an implementation plan with its execution report, classify divergences, and recommend targeted improvements to AGENTS.md, planning/execution skills, hooks, validation, or custom agents. Use after implementation to find process failures rather than code defects.
---

# Review the engineering process

This is a process review, not a code review.

## Inputs

Resolve two artifacts from the user's request:

1. The implementation plan.
2. The execution report produced after the implementation.

Also read:

- `AGENTS.md` and any nested instructions that governed the work.
- `.agents/skills/piv-plan-implementation/SKILL.md`.
- `.agents/skills/piv-implement/SKILL.md`.
- Relevant validation or review skills named by the plan.

If either required artifact is missing, stop and ask for it rather than reconstructing history from memory.

## Analysis

1. Extract planned scope, architecture, assumptions, task order, and validation.
2. Extract actual changes, validation evidence, challenges, skipped work, and stated divergences.
3. Classify every material divergence:
   - **Justified adaptation:** new evidence made the change safer or more correct.
   - **Planning gap:** the plan lacked necessary context, a decision, or a realistic dependency.
   - **Execution failure:** the implementation ignored a clear and still-valid instruction.
   - **Validation gap:** the process could not establish whether the outcome worked.
   - **Stale guidance:** AGENTS.md or a skill described behavior that no longer matches the repository.
4. Trace each non-justified divergence to concrete evidence and a root cause.
5. Route the smallest durable improvement to the correct layer:
   - `AGENTS.md`: concise, always-on project choice or boundary.
   - Skill: reusable, judgment-based workflow.
   - Hook: deterministic lifecycle enforcement.
   - Custom agent: isolated specialist analysis.
   - Validation/CI: machine-checkable quality gate.
   - Task: one-off follow-up that should not become permanent guidance.

Do not recommend a new rule for a single anecdote unless its impact is severe or the owner explicitly wants it encoded.

## Output

Save a review under `.agents/system-reviews/<feature>-review.md` when the user wants an artifact. Include:

- Plan and execution-report paths.
- Overall alignment and validation confidence.
- A table of divergences with classification, evidence, root cause, and impact.
- Prioritized AI-layer improvements with the exact target file and a concise proposed change.
- Items explicitly dismissed as one-off or already covered.
- Open questions for the owner.

Do not edit the AI layer unless the user also asks to apply the recommendations.
