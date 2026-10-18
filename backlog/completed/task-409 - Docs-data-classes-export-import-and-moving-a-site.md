---
id: TASK-409
title: 'Docs: data classes, export, import and moving a site'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 16:25'
updated_date: '2026-10-14 19:47'
labels: []
milestone: m-38
dependencies:
  - TASK-407
  - TASK-408
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 365800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From decision-55 (accepted), proposed task 7. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docs/personal-data.md gives each file's class and says that an export contains personal data.
- [x] #2 docs/deploying.md gains "Back up and move a site": drain the queue, export, stop, import, DNS. It says what import installs, what users must do again and what is lost.
- [x] #3 docs/cli.md documents `export` and `import`, including the exit codes. docs/admin.md documents Tools > Export.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Check docs/content.md, docs/personal-data.md, docs/cli.md and docs/admin.md against files/data-files.ts, the settings and plugin declarations, export/site-export.ts, export/site-import.ts, admin/export.ts and cli.ts; fix any claim the code contradicts.
2. docs/personal-data.md: add a Class column to the table (content/ is kept; data/ files take their declared class) and a section saying every export holds personal data, what retention and erasure do not reach, and how to store an archive.
3. docs/content.md: bring the class summary in line with CORE_DATA_FILES (import scratch, lock pattern, plugin files).
4. docs/deploying.md: add 'Back up and move a site' with the end-to-end procedure: maintenance on and drain the queue, export (with or without credentials), stop, copy, import with the new host's env so the base URL matches, plugins from npm and exit 1, what users redo, what is lost, geekity resend for posts that came due, dev mode, DNS, Docker. Link to cli.md and admin.md sections instead of repeating them.
5. docs/cli.md: add exit codes for export; correct the plugin-needs-newer-core case on import.
6. Link the guide from docs/README.md; run unslop on new prose; pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added 'Back up and move a site' to docs/deploying.md (the AC names deploying.md, so the guide is a section there, not a separate file), linked from docs/README.md and the Backups section. personal-data.md gains a Class column checked against CORE_DATA_FILES and the settings/plugin declarations, plus a 'Site exports' section. content.md's class table now names the import scratch (.geekity-import, .geekity-importing/, .geekity-before-import-*/), the lock pattern with .takeover, and plugin files. cli.md gains export exit codes.
Docs and code disagreed in one place: cli.md listed 'the version needs a newer @geekity/cms' among the reasons a plugin cannot be installed. installArchivedPlugins installs it (addPlugin succeeds) and then reports it as failed, and the plugin registry keeps it unavailable. The docs now say it is installed but does not run, and that retrying does not help until core is upgraded. The stderr line reads 'was not installed: ... so it is installed but will not run', which contradicts itself; code left unchanged (docs task).
Verified from code: maintenance gate exempts only admin/health/theme/security.txt and lets signed-in users through; queue is not touched by maintenance; seedContent runs only in serve; resend sends a Create for a published, unannounced, non-migrated post and --all lists only federated posts; maintenance.json is rebuildable so never exported; second import run with the marker treats the folder as unfinished.

Validation: pnpm build, typecheck, lint (doc links), format:check pass; pnpm test passes (cms 6110, demo 32, plugins 49/23/32/108). Unslop pass applied to the new prose.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Documented data classes, export, import and moving a site. docs/deploying.md gains 'Back up and move a site' (before the move, drain the queue under maintenance mode, export with or without credentials, stop, copy, import with the new host's env, exit codes and plugin retry, dev mode, DNS, after the move, what is kept and lost, Docker commands), linking to cli.md and admin.md for detail. docs/personal-data.md gains a Class column and a 'Site exports' section. docs/content.md's class table matches CORE_DATA_FILES. docs/cli.md gains export exit codes and corrects the plugin-needs-newer-core case. Verified against cli.ts, export/*, plugins/install.ts, web/maintenance.ts, federation/delivery.ts; build, typecheck, lint, format:check and the full test suite pass.
<!-- SECTION:FINAL_SUMMARY:END -->
