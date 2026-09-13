# Agent briefing

Fill in the bracketed parts and pass the whole thing as the agent's prompt; the repo
root is `git rev-parse --show-toplevel`, never a path from memory. Keep
the shape; agents that got this briefing have finished every task so far.

```
You are building TASK-[id] in the repository at [absolute path of the repo root] on branch
[branch]. Work only on this task.

Read first, in this order:
1. `backlog instructions overview`, `backlog instructions task-execution`, and
   `backlog instructions task-finalization`.
2. `backlog task view TASK-[id] --plain`, then every file under References and
   Documentation on it, including the decision it cites.
3. CLAUDE.md at the repo root.

Handoff from the previous task:
[what landed, moved paths, migration numbers, anything flagged; or "none, first
task on the branch"]

How to work:
- Move the task to In Progress with the backlog CLI, write your implementation
  plan on it with `backlog task edit --plan`, then build it with the tdd skill:
  a failing test first for each acceptance criterion, then the code.
- Use the backlog CLI for every change to the task; never edit files under
  backlog/ by hand.
- Verify with real commands before you claim anything: `pnpm build && pnpm test
  && pnpm typecheck && pnpm lint && pnpm format:check`, and curl the running
  site where a criterion is about HTTP. Stop any server you start.
- Check each acceptance criterion with `--check-ac` only when you have proof.
  Leave a criterion unchecked and the task In Progress when the proof needs
  something you do not have (GitHub, a deployed site, a later task), and say so
  in the implementation notes.
- Write implementation notes and a final summary on the task as the
  finalization guide describes, then move it to Done if every criterion holds.
- Do not run `git commit`, `git push`, or change branches. The orchestrator
  reviews and commits.
- Do not touch apps/demo/content/_data/federation/.

Report back with: what you built, the files that changed, which criteria are
checked and which are not and why, the commit type this should land as (feat,
fix, docs, chore, or feat! with the breaking change in one line), and a handoff
note for the next task.
```

## Notes for the orchestrator

- One agent per task, sequentially. Parallel agents on one branch fight over
  the working tree and the backlog files.
- The agent's report is not shown to the user; relay what matters in the final
  report.
- A task the agent leaves In Progress still gets committed if the checks pass;
  say in the commit body which criterion is open and why.
