---
name: audit-all
description: Run the full CMS audit. Reads _local/AUDIT_MAP.md, runs the audit-slice skill for each suggested audit area in separate subagents, triages the results, writes AUDIT_REPORT.md, and proposes backlog.md tasks. Use only when the user asks to run the audit.
argument-hint: 'create-tasks | slice IDs to run'
disable-model-invocation: true
---

# Run the full audit

Arguments: $ARGUMENTS

If the arguments are exactly `create-tasks`, skip to "Create backlog tasks". Otherwise, if arguments list slice IDs, run only those slices. If there are no arguments, run all slices.

## 0. Choose models

Read pstack-models.md. Use it to decide which model each kind of agent runs on: slice auditors, the triage agent, and any other agent you spawn. If it assigns a model to a specific slice ID, use that for that slice. Record the choices in `_local/audit/PLAN.md`.

Pass the chosen model in the `model` parameter of every Agent call. If pstack-models.md is missing, or does not cover a role, use the default model for that agent. Say so at the top of `_local/audit/PLAN.md` and in your final message.

## 1. Plan

Read _local/AUDIT_MAP.md. Build the slice list from "Suggested audit areas": slice ID (short, lowercase), scope, and files. Write it to `_local/audit/PLAN.md`. Skip any slice whose `_local/audit/slices/<id>.md` already exists and has no unreviewed items, unless the arguments name it explicitly.

## 2. Run the slices

Spawn one subagent per slice using the Agent tool, at most 3 running at a time. Delegate only the slices. Do not spawn extra subagents to double-check anyone's work.

Each subagent's prompt: "Invoke the audit-slice skill with these arguments: <slice-id> <scope>. If you cannot invoke skills, read .claude/skills/audit-slice/SKILL.md and follow it exactly. Do not read other slices' reports."

Subagents must not share findings with each other. Wait for all of them to finish before continuing.

## 3. Coverage check

Compare the entry points in _local/AUDIT_MAP.md section 2 against the progress files in `_local/audit/progress/`. List as gaps:

- entry points not covered by any slice
- items the map marked "unknown"
- areas the map says have no tests
- slices that ended with unchecked items or blockers

## 4. Triage

Spawn one fresh subagent for triage. It reads every `_local/audit/slices/*.md` and, for each finding, verifies it against the code, drops false positives (with a one-line reason), merges duplicates across slices, groups findings that share one root cause, and ranks by real-world impact for a CMS hosting public sites. It writes `_local/audit/TRIAGED.md`.

## 5. Report

Write `AUDIT_REPORT.md`: executive summary, counts by severity, top findings, root-cause groups, coverage gaps from step 3, dropped false positives, and per-slice status. Do not paste full findings; link to the slice files and finding IDs.

## 6. Propose tasks

Write `_local/audit/PROPOSED_TASKS.md`: one proposed task per root cause (not per finding), plus one per coverage gap. Each has a title, priority, finding IDs, file and line, the fix, and acceptance criteria written as regression tests asserting correct behavior. Do not create tasks yet.

Final message: lead with the count of findings by severity and the number of coverage gaps. Then give the paths to AUDIT_REPORT.md and _local/audit/PROPOSED_TASKS.md, and say the user can edit that file and then run `/audit-all create-tasks`.

## Create backlog tasks

Only run this when the arguments are `create-tasks`.

1. Run the backlog.md CLI help to learn its current commands. Do not guess flags.
2. Read `_local/audit/PROPOSED_TASKS.md` as the user left it. Treat the file as approved.
3. For each proposed task, search existing backlog tasks for its finding IDs first. If a match exists, update that task. Otherwise create a new one.
4. Final message: list the tasks created and updated, with their backlog IDs.
