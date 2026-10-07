---
name: audit-slice
description: Audit one slice of the codebase (for example authorization, uploads, or XSS) for security flaws, logic errors, and data-loss risks, and write the findings to a report file. Use when asked to audit a specific area, or when audit-all delegates a slice.
argument-hint: '[slice-id] [optional scope description]'
effort: medium
---

# Audit one slice

Arguments: $ARGUMENTS

The first word is the slice ID (lowercase, for example `authz`). Any remaining text is the scope. If no scope is given, find this slice in the "Suggested audit areas" section of _local/AUDIT_MAP.md. If you cannot find it, stop and say so.

## Rules

- This is a defensive source-code review of my own CMS, before I migrate production sites onto it.
- Do not modify source files. The only files you may create or overwrite are `_local/audit/slices/<id>.md` and `_local/audit/progress/<id>.md`.
- Start from _local/AUDIT_MAP.md, but verify against the actual code. The map may be wrong. Note any discrepancies you find.
- Report everything you find, including low-severity and uncertain items. Do not filter or soften. I will filter in a separate pass.
- Do not write exploit code. Describe the flaw, when it triggers, and the fix. Where useful, describe a regression test that asserts the correct behavior (for example, "an editor gets 403 on this endpoint").
- Do not read other slices' reports in `_local/audit/slices/`. Each slice must be independent.
- Stay inside the scope. Put issues outside it in one line each under "Out-of-scope notes".

## Progress tracking

Create `_local/audit/progress/<id>.md` as a checklist of every file, module, and entry point in scope. Tick items as you finish them. Do not end your turn while unchecked items remain, unless something truly blocks you. If something blocks you, write what and why in the progress file.

## Finding format

Use IDs made from the uppercase slice ID and a number, for example AUTHZ-001.

### <ID>: short title

- Location: file:line
- Severity: critical / high / medium / low
- Confidence: high / medium / low
- Problem: what is wrong, in plain language
- Triggers when: the conditions under which it happens
- Fix: the recommended change
- Regression test: what the test should assert

## Finish

Write `_local/audit/slices/<id>.md` with a short header (slice ID, scope, number of items reviewed, list of unreviewed items), then the findings, then "Out-of-scope notes".

Your final message must lead with the count of findings by severity, then the report path, then any unchecked items.
