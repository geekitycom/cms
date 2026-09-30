---
id: decision-21
title: The pre-push hook runs typecheck only; the test suite is CI's gate
date: '2026-09-30 22:27'
status: accepted
---
## Context

decision-8 put the slow gates on `pre-push`: `pnpm typecheck` and `pnpm test`, once per push, with lint and format on staged files at commit and everything again in CI. When it was written the suite was small. On 2026-09-30 it is 2648 `node:test` cases in the package and 31 in the demo, and a run takes about fourteen minutes; `pnpm typecheck`, which builds the package first, takes seven seconds.

Two pushes that day failed the same way: the hook ran to the end with every check passing, then `git push` exited 141. Git opens the SSH connection to GitHub before it runs `pre-push`, and GitHub closes a connection that sits idle that long, so the pack write after the hook got a broken pipe. The commit landed only with `--no-verify`. A hook whose gate passes and whose push then fails is worse than no hook: it costs the fourteen minutes and delivers nothing, and it teaches everyone to skip it.

Meanwhile CI (`.github/workflows/ci.yml`) already runs the suite on every push and every pull request, on two Node versions, as a required status check, beside lint, format, the Eleventy build, the federation smoke, the packed install, the Docker smoke and coverage. The hook duplicated the one gate that is expensive and skipped the cheap ones.

## Decision

**`pre-push` runs `pnpm typecheck` and nothing else.** Seven seconds, and it catches the class of mistake a push most often carries: a type error in a file the change did not run. `commit-msg` and `pre-commit` are unchanged.

**The test suite is CI's gate.** It runs there on every push and pull request and is not skippable. A push does not wait for it. Anyone who wants the suite before pushing runs `pnpm test` by hand.

`pnpm lint` stays out of the hook too: it takes about fifty seconds with the type-checked rules, lint-staged already covers the staged files at commit, and CI runs the full lint.

## Consequences

- Amends decision-8's "typecheck and tests on `pre-push`". The three checks and where CI runs them are unchanged.
- A push takes seconds again, and a passing hook is followed by a push that lands. A `ServerAliveInterval` for github.com was also added to the dev server's `~/.ssh/config`, but the hook is the fix; the keepalive is a belt.
- A broken test now reaches `main` before anyone is told, and CI tells them within minutes. release-please only cuts a release from a green `main`, so nothing ships on a red suite.
- The fourteen-minute suite is its own problem: at about 310 ms a case, most cases are booting a server or building an index. That is a task for the suite, not a reason to keep it in a hook.
