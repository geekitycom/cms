---
name: run-milestones
description: Build one or more Backlog milestones, or any named set of tasks, task by task with Opus agents that use the tdd skill, committing per task on one feature branch per milestone. Use when the user says "run milestone M14", "work through m-13", "build these tasks", "do the remaining milestones overnight", or hands over a scope of Backlog work to be implemented rather than planned.
---

# Run milestones

The orchestrator (you) owns branches, commits and the order of work. Each task is
built by one fresh Opus agent that uses the tdd skill and never commits. You review
and commit after every agent, so every commit is a reviewed, green, Conventional
Commit that release-please can read.

## Quick start

```
/run-milestones m-13
/run-milestones m-10 then m-12 then m-11   (chained, in that order)
/run-milestones TASK-22                    (no milestone: branch named for the task)
```

## Before the first task

1. `backlog instructions overview`, then `backlog instructions task-execution`.
2. Resolve the scope to an ordered list of milestones and, inside each, an ordered
   list of tasks: `backlog task list -m <id> --plain`, then `backlog task view` on
   each and order by `Dependencies`, then by ordinal. A task that is already Done is
   skipped. Report the order to the user before starting; do not wait for a reply
   unless the order is ambiguous.
3. `git status` must be clean apart from `apps/demo/content/_data/federation/`,
   which is scratch from booting the demo and is never committed.
4. Branch per milestone: `m<N>-<slug>` from the milestone title, for example
   `m14-named-themes`. The first milestone branches from `main`; a later milestone
   in the same run branches from the tip of the one before it, so the run stacks.
   A scope with no milestone gets a branch named for the work, such as
   `task-22-search`.

## Per task

1. Spawn one Opus agent (`Agent` tool, `model: "opus"`) with the briefing in
   [BRIEFING.md](BRIEFING.md). It gets the task id, the previous task's handoff
   notes, and the rule that it must not commit.
2. When it returns, read its report, then verify yourself:
   ```
   pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
   ```
   Skim the diff with `git diff --stat` and `git diff` on anything surprising.
   `backlog task view <id> --plain` must show the task Done with every criterion
   checked, or In Progress with the unchecked ones explained in its notes.
3. Kill anything left listening on port 3000 (`lsof -ti :3000 | xargs kill`).
4. Commit everything but the federation scratch directory, following the commit
   rules in `CLAUDE.md`: `feat(cms):` for a feature, `fix(cms):`, `docs:`,
   `chore:`, and `feat(cms)!:` with a `BREAKING CHANGE:` footer when the task says
   it is breaking. End the message with the attribution lines the session gives you.
5. Carry forward a short handoff note for the next agent: what landed, file paths
   that moved, migrations used, anything the agent flagged.

If an agent stops with work half done, do not commit. Send it a message to finish
or spawn a new one with the state described; commit only when the checks pass.

## After a milestone

- `backlog milestone list --plain` should show it complete. Start the next
  milestone's branch from this tip.
- Do not push and do not open a PR unless the user asked for it in this run. When
  asked, push each milestone branch, then open its PR with `gh pr create`, base
  set to the branch below it (`main` for the first), and a title in the form
  `CLAUDE.md` demands, for example `feat(cms)!: milestone M14 named themes`, with
  `!` if any commit on the branch is breaking. Then link them into a GitHub stack,
  bottom to top, by PR number:
  ```
  gh stack link 30 31 32
  ```
  Create the PRs yourself first: `gh stack link` can open PRs for bare branches,
  but it invents their titles and the `pr-title` CI job rejects those. The
  extension is `github/gh-stack`; `gh stack view` shows the stack and
  `gh stack merge --rebase` lands it, but merging is the user's call.

## Commit signing

Commits are signed through the 1Password SSH agent. If a commit fails with
`1Password: failed to fill whole buffer`, the agent is locked. Commit with
`git -c commit.gpgsign=false commit ...`, keep going, and tell the user which
commits need re-signing:
`git rebase --exec 'git commit --amend --no-edit -S' <last signed commit>`.

## Final report

One message that stands alone: per milestone, the branch, its commits with task
ids and types, anything left In Progress and why, anything an agent flagged as a
concern, and whether commits need re-signing.
