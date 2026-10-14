---
id: TASK-399
title: A strip-metadata sweep cut off mid-write leaves no temp file behind
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 11:20'
updated_date: '2026-10-14 11:55'
labels: []
milestone: m-38
dependencies:
  - TASK-392
references:
  - packages/cms/src/content/metadata/sweep.ts
  - packages/cms/src/admin/media.ts
priority: low
type: bug
ordinal: 355800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The metadata sweep (packages/cms/src/content/metadata/sweep.ts) replaces an upload by writing <file>.geekity-strip and renaming it over the original. Since TASK-392 the sweep runs as a queued job that can be killed or cut off, and a process killed between the write and the rename leaves the .geekity-strip file in content/uploads. It stays until a later sweep strips that same upload, and meanwhile the Media library may list it and the site may serve it. A sweep should remove any leftover .geekity-strip files it finds, and the Media library should never list one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A sweep removes every leftover .geekity-strip file under content/uploads, whether or not its upload still needs stripping; a test proves it
- [x] #2 The Media library does not list a .geekity-strip file; a test proves it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Export the temp-file suffix (.geekity-strip) from sweep.ts so the sweep and the library share one name.
2. Test first (strip-job.test.ts): leftovers beside a clean upload, beside an upload that still needs stripping, and with no upload at all are gone after a sweep.
3. Sweep: before stripping, unlink every file under uploads that ends in the suffix (ENOENT is fine). CLI output and exit codes unchanged.
4. Test first (admin/media.test.ts): a .geekity-strip file dropped in uploads is not on the media screen.
5. listUploads skips names ending in the suffix, which also keeps it out of the editor's photo and enclosure pickers.
6. Check static serving of /uploads/ and report; run full verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
sweep.ts exports STRIP_TEMPORARY_SUFFIX ('.geekity-strip'). stripStoredUploads lists every file under uploads, rm's each one ending in the suffix (force, so a vanished one is fine), then strips as before. Removal happens before the first abort check and is not reported, so geekity strip-metadata output and exit codes are unchanged. listUploads skips names ending in the suffix, which covers the Media screen, its total/page counts, and the editor's photo and enclosure pickers (all built on listUploads).
Tests: strip-job.test.ts 'removes every temporary file a cut-off sweep left behind' (leftovers beside two clean uploads, beside a missing upload, beside a non-image) failed before with the four .geekity-strip files still present; the existing cut-off test covers a leftover beside an upload that still needs stripping. admin/media.test.ts 'does not list a temporary file a cut-off metadata sweep left behind' failed before with geekity-strip in the screen HTML.
Not changed: the /uploads/ route (findAsset) still serves a leftover until the next sweep removes it; it holds stripped bytes, so it leaks no metadata. A CLI sweep run while the server's sweep job is mid-file could delete that job's in-flight temp file and make its rename fail with ENOENT; the admin side already refuses a second queued sweep.
Validation: pnpm build, pnpm test (cms 5992 pass, demo 32, plugin-llm 48, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass. docs/media.md updated.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A metadata sweep now deletes every .geekity-strip file left in content/uploads by a sweep killed between the write and the rename, whether or not its upload still needs stripping, and the media library (screen, counts, editor pickers) never lists one. The suffix is one exported constant shared by the sweep and listUploads. Verified with new failing-first tests in strip-job.test.ts and admin/media.test.ts and the full build/test/typecheck/lint/format run; docs/media.md describes the cleanup.
<!-- SECTION:FINAL_SUMMARY:END -->
