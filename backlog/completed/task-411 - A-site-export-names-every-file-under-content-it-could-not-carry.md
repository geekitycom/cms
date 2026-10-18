---
id: TASK-411
title: A site export names every file under content/ it could not carry
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 18:09'
updated_date: '2026-10-14 19:14'
labels: []
milestone: m-38
dependencies:
  - TASK-406
references:
  - packages/cms/src/export/site-export.ts
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: low
type: bug
ordinal: 366800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
geekity export (packages/cms/src/export/site-export.ts, TASK-406) walks content/ and carries only regular files. A symlink or other non-regular file under content/ is skipped silently, so a restore can lack it with no warning. Undeclared data files are already listed in the manifest's undeclared list and printed by the CLI; non-regular content files should get the same treatment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A symlink or other non-regular file under content/ is not in the archive, is listed in the manifest with why, and geekity export prints it; a test proves it
- [x] #2 docs/cli.md says what an export does with a symlink under content/
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. data-files.ts: add classifyEntries(dir, declarations) returning { files, others }; others are entries under dir that are neither regular files nor folders (symbolic link, socket, FIFO, device), each with its kind and declaration. classifyFiles becomes classifyEntries(...).files. A symlinked folder is listed as a link and not walked.
2. site-export.ts: a new manifest list notCarried: { path, why }[] for content/ entries that are not regular files and are not scratch. Separate from undeclared, which is a list of data/ paths with one fixed reason. Field is additive, so EXPORT_FORMAT stays 1: parseManifest in site-import.ts reads it with [] as the default, and an older import ignores the key.
3. cli.ts: geekity export prints each notCarried entry on standard error, as it prints undeclared files.
4. Tests first: site-export.test.ts (symlink to a file, symlinked folder, FIFO under content/ are not in the archive and are listed with why), cli-export.test.ts (the CLI prints it), data-files.test.ts (classifyEntries).
5. docs/cli.md: what an export does with a symlink under content/, and the notCarried manifest field.
6. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Separate manifest list notCarried: { path, why }[] rather than extending undeclared, because undeclared is a list of data/ paths with one fixed reason and the why differs per entry. The field is additive, so EXPORT_FORMAT stays 1: parseManifest reads it with [] as the default, and an older import builds its manifest from named keys and ignores it.
Found while testing: Node's readdirSync({ recursive: true }) follows a symlinked folder, so the old walker carried the files behind a linked folder under content/ (and data/). classifyEntries in files/data-files.ts now walks folder by folder, lists links without following them, and treats a folder removed mid-walk as empty. classifyFiles is classifyEntries(...).files, same signature.
Symlinks under data/ are still left out without a name, as before; the task covers content/.
Validation: failing-first site-export.test.ts (notCarried undefined) and cli-export.test.ts (stderr had only the undeclared line); then pnpm build, pnpm test (cms 6105, plugin-wordpress 108 incl. data census, all pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity export now names every entry under content/ it cannot carry. A symbolic link, socket, FIFO or device is left out of the archive, listed in the new manifest field notCarried with why, and printed on standard error. The walker no longer follows a linked folder, which it used to. Import reads the new field and EXPORT_FORMAT stays 1. docs/cli.md says what an export does with a symlink. Verified by new tests in site-export.test.ts and cli-export.test.ts (both failed first) and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
