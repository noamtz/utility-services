# Launching workstreams

Before launching a workstream:

- Give it one outcome and one primary owner.
- Pass the complete source request or issue.
- Add only operator context and decisions that materially affect this workstream.
- For repository-changing work, create a separate git worktree and give the owner its absolute path, branch, and base branch.
- Give the owner the absolute path of this run's artifact directory, `.agents/orchestration/runs/<date>-<short-name>/<workstream>/` in the main checkout, and ask it to write its plan, report, and review there.
- Name the PIV capability to use and let that capability define its own process.
- State the expected result and the proof that should come back.

Ask the owner to return:

- The outcome.
- The artifact, report, commit, or pull request, with absolute paths.
- Validation and review evidence.
- Any blocker or the exact operator decision it needs.
- The next step when the workstream is not complete.

Continue an existing workstream by messaging the same owner so its context is preserved.

Treat the owner's final message as a map to the result. Confirm the promised artifact and lightweight facts exist before marking the workstream complete.

## Capabilities that run their own stages

When a workstream uses a capability that runs its own stages, such as `piv-deliver`, launch one workstream owner with the complete input and ask it to run the whole capability.

Keep that capability's planning, implementation, correction, and review stages inside the workstream. Do not recreate them as top-level workstreams or launch them from the main orchestrator.

Track the workstream's current stage when useful, but wait for the capability to return its outcome, proof, unresolved findings, and recommendation.