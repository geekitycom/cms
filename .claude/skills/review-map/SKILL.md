---
name: review-map
description: Build or refresh the risk-ranked map of review areas for a deep code review cycle, as a Backlog doc plus one ranked Backlog task per area in a review milestone. Use when the user says "map review areas", "start a review cycle", "refresh the review map", or "what should we review next" and no map exists or the code has moved since it was made.
argument-hint: '[refresh]'
disable-model-invocation: true
---

# Map review areas

Arguments: $ARGUMENTS

The output is a ranked queue. `/review-area` with no arguments takes the top of it.

Run `backlog instructions overview` and `backlog instructions task-creation` first.

## What gets written

| Thing         | Where                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| The map       | Backlog doc titled `Review map`. One doc, updated in place every cycle.                     |
| One cycle     | Milestone `Code review YYYY-MM` (the month the cycle starts).                               |
| One area      | Task labelled `review-area`, in the cycle milestone.                                        |
| Findings      | Tasks labelled `review-finding`, in milestone `<area id> issues` (filed by `/review-area`). |
| Rank          | The area task's ordinal: 10, 20, 30… in rank order. Priority as well.                       |
| Scratch notes | `$MAIN/_local/review/map/`, where `$MAIN` is the main checkout.                             |

`$MAIN` is `$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`. A worktree's own `_local/` is deleted with the worktree, so never write there.

## 0. Worktree

Map what is deployed. `git fetch origin main`, then `git worktree add --detach .claude/worktrees/review-map origin/main` from the main checkout. Run every command below from that worktree. The worktree has no `backlog/`, so the backlog CLI uses the main checkout's board. Remove the worktree at the end.

## 1. Inventory (sonnet)

Measure first, by command, not by reading:

- Source lines per directory under `packages/*/src` and `packages/cms/src/*`, excluding `*.test.ts`.
- Churn per directory: commits and changed lines since the area's last review commit (refresh) or over the last 120 days (first map). Use `git log --numstat`.
- Test files per directory.

Partition the source tree into 4–6 groups of roughly equal size. Spawn one agent per group (`model: "sonnet"`, background), all at once. Each agent writes `$MAIN/_local/review/map/inventory-<group>.md` and returns only the path. Brief:

> You are taking inventory of part of Geekity CMS, a TypeScript CMS I wrote and run on live sites, so I can plan a defensive code review. Read only; change nothing. Your directories: <list>. For each module, record by reading the code: (1) entry points, meaning HTTP routes with method and path, inbox or queue handlers, CLI commands, MCP tools, plugin hooks, file watchers and listeners; (2) who can reach each entry point: anonymous visitor, remote server (ActivityPub, Webmention, IndieAuth client, oEmbed), commenter, logged-in author or admin, token holder (Micropub, MCP), or operator (CLI, config); (3) what it touches: the database, files on disk, outbound HTTP, rendered HTML, child processes, secrets, email; (4) how input is parsed and validated and where; (5) which tests exercise it. Cite file:line for each. List facts only. Do not rate risk. End with modules you could not finish.

## 2. Cut and score the areas (opus)

One agent (`model: "opus"`, background) reads every inventory file, the architecture doc (`backlog doc view doc-1`), the existing `Review map` doc if there is one, and the churn table, then writes `$MAIN/_local/review/map/areas.md`.

> Cut Geekity CMS into review areas, one deep review session each. Cut along trust boundaries and data flows, not along directories. "Federated inbox: remote server to stored activity" is an area; `federation/` is not. Size each area at 2,000–8,000 source lines; split larger ones by entry point. Every entry point in the inventories belongs to exactly one area. List any that fit nowhere.
>
> For each area give: id (short kebab slug), title, files and directories, entry points, who reaches it, sinks and assets, existing tests, churn, and these scores, each with a one-line reason:
>
> - Exposure, 1–4: 4 for an anonymous visitor or remote server, 3 for a commenter or an IndieAuth client without an account, 2 for an author, admin, or token holder, 1 for the operator only.
> - Impact, 1–4: 4 for code execution, account or token takeover, secret leak, or loss of site content; 3 for stored XSS, content tampering, or SSRF; 2 for denial of service or a privacy leak; 1 for wrong output with no security effect.
> - Churn, 0–2: 2 if heavy since the last review or never reviewed.
> - Test gap, 0–2: 2 if the entry points have no tests that send hostile or malformed input.
>
> Risk = exposure × impact + churn + test gap. Also name the review lenses that apply, from: boundaries, input, state, intent (defined in .claude/skills/review-area/LENSES.md). Name every lens unless one clearly has nothing to look at.

## 3. Rank (fable, one call)

One agent (`model: "fable"`, background; if the model is rejected, use `"opus"` and say so) reads `areas.md` and the inventories and writes `$MAIN/_local/review/map/ranked.md`:

> You are checking a risk ranking for a defensive review of a CMS that runs on live public sites. Challenge each score that the inventory facts do not support, and fix it. Check that the areas cover every entry point and do not overlap. Then give the final order. Ties go to the area whose flaws an outsider could reach soonest. Return the table with a one-line reason per change.

This is the only Fable call. Do not use Fable for inventory or drafting.

## 4. Write Backlog

1. Create or update the `Review map` doc (`backlog doc create "Review map" -t specification`, then `backlog doc update <id> --content`). It holds the scoring rules from step 2, the area table (id, title, scores, risk, lenses, last reviewed: date and commit, or "never"), the files and entry points of each area, and any uncovered entry points.
2. Find the cycle milestone: an active milestone named `Code review …`. If none has To Do `review-area` tasks, add `Code review YYYY-MM` with `backlog milestone add`.
3. For each area, look for an existing `review-area` task with its id in the title (`backlog task list --labels review-area --plain`):
   - To Do: update its ordinal, priority, and description.
   - Done in an earlier cycle and its risk still earns a place: create a new task in this cycle.
   - None: create one.

   Title: `Review <area id>: <title>`. Priority: high if risk ≥ 12, medium if ≥ 7, otherwise low. Description: scope, entry points, who reaches them, lenses, and the score reasons. One acceptance criterion: `/review-area` has run and every finding is filed or dismissed with a reason.

## Refresh

With `refresh`, or whenever a `Review map` doc exists, carry the last-reviewed commit forward from each area's Done task. Recompute churn since that commit and rerun steps 1–4. Step 1 covers only directories with churn or new files, and step 2 keeps area ids stable so history lines up.

## Reply

Lead with the top five areas in order, with risk scores and one reason each. Then give the cycle milestone, the doc id, any uncovered entry points, and the command for the next step, `/review-area`.
