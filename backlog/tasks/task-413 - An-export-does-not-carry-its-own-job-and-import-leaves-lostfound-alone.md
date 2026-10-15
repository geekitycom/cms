---
id: TASK-413
title: 'An export does not carry its own job, and import leaves lost+found alone'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 19:08'
updated_date: '2026-10-14 19:20'
labels: []
milestone: m-38
dependencies:
  - TASK-408
  - TASK-412
references:
  - packages/cms/src/export/export-job.ts
  - packages/cms/src/export/site-export.ts
  - packages/cms/src/export/site-import.ts
priority: low
type: bug
ordinal: 368800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two edge cases from the site export run. (1) An admin export (TASK-408, packages/cms/src/export/export-job.ts) runs as a site.export job, so the jobs.json it archives records that job as running; after geekity import, start-up recovery runs the export again on the new host and writes an unwanted archive. The archived jobs.json should not carry the export's own job (or any site.export job). (2) geekity import (TASK-412, packages/cms/src/export/site-import.ts) moves every entry it does not own aside with --replace and reads every entry when checking a target; a target that is the root of a filesystem can hold lost+found owned by root, which it cannot move or read. Import should leave lost+found where it is, and export should not carry it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The jobs.json in an archive written by the admin export holds no site.export job, and importing it runs no export; a test proves it
- [x] #2 geekity import with --replace into a target holding lost+found leaves lost+found in place and restores the site; a test proves it
- [x] #3 geekity export does not carry a lost+found folder
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. site-export.ts: SITE_EXPORT_JOB_NAME lives here (export-job.ts imports it, so no import cycle). A planned file can carry a rewrite of its bytes; data/jobs.json gets one that drops every site.export job. tarEntries reads a rewritten file whole, so the tar header size and the manifest's size and sha256 are those of the bytes written. pendingWork stops counting site.export jobs, so manifest.pending agrees with the archived jobs.json.
2. data-files.ts: LOST_AND_FOUND = 'lost+found'. classifyEntries does not read a lost+found folder at the top of the folder it walks, so export never carries it and import's target check never reads it.
3. site-import.ts: placeSiteImport leaves a top-level lost+found where it is (never moved aside or removed); placeOf refuses an archive entry under content/lost+found or data/lost+found, since export never writes one and it would land on the filesystem's own folder.
4. Tests first: admin/export.test.ts (the archive written by a running site.export job holds a jobs.json without it, and a site booted from the import runs no export); site-export.test.ts (lost+found at mode 000 in content/ and data/ is not read or carried); cli-import.test.ts (--replace into targets holding lost+found at mode 000 restores the site and leaves lost+found in place).
5. docs/cli.md: jobs.json without export jobs, lost+found on export and import.
6. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Export: SITE_EXPORT_JOB_NAME moved to site-export.ts (export-job.ts imports it; no cycle). A planned file can carry a rewrite; data/jobs.json drops every site.export record, and tarEntries reads a rewritten file whole so the tar size and the manifest's size and sha256 are those of the bytes written. This applies to geekity export as well as the admin job. pendingWork no longer counts site.export jobs, so manifest.pending matches the archived jobs.json and the admin's Export screen does not count its own job.
lost+found: LOST_AND_FOUND in files/data-files.ts. classifyEntries does not descend into lost+found at the top of the folder it walks, which covers export (content/ and data/) and import's target check. placeSiteImport leaves it in place (never moved aside or removed). An archive holding content/lost+found/… or data/lost+found/… is refused, as names the import uses itself are.
Validation: failing-first admin/export.test.ts (archive held site.export), site-export.test.ts (EACCES scanning a mode-000 lost+found; pending running:1 with the filter removed), cli-import.test.ts (EACCES under --replace; archive with lost+found accepted). Then pnpm build, typecheck, lint, format:check, test (cms 6110, plugin-wordpress 108 incl. data census) all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An archive no longer carries site.export jobs in data/jobs.json (admin and CLI export alike; size and sha256 match the rewritten bytes), and manifest.pending does not count them, so an imported site runs no export. A lost+found folder at the top of content/ or data/ is never read or exported, geekity import --replace leaves it in place, and an archive that holds one is refused. docs/cli.md updated. Verified by new failing-first tests in admin/export.test.ts, site-export.test.ts and cli-import.test.ts (mode-000 lost+found stands in for a root-owned one) and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
