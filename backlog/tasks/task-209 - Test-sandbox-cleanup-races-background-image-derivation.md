---
id: TASK-209
title: Test sandbox cleanup races background image derivation
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:53'
updated_date: '2026-10-01 19:22'
labels:
  - tests
  - media
dependencies: []
references:
  - packages/cms/src/content/media.ts
priority: low
type: bug
ordinal: 225800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while building TASK-204: a test that writes an upload file into a sandbox site but never fetches it starts background image-variant derivation, which can still be writing when the sandbox is removed, so cleanup fails with ENOTEMPTY and the test run fails intermittently. TASK-205 and TASK-207 worked around it by calling generateImageVariants after writing an upload. Fix it at the root: the sandbox (or the CMS's close()) should wait for, or cancel, pending derivation before the directory is removed, so a test cannot fail this way however it writes uploads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A test that writes an upload and never fetches it passes reliably under repeated runs (for example 50 runs of that file)
- [x] #2 cms.close() or the test sandbox waits for or cancels pending image derivation before files are removed
- [x] #3 The generateImageVariants workaround is no longer needed in tests that only used it to avoid the race
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce: a test that writes an upload, renders a page that references it, and closes, run repeatedly until ENOTEMPTY fires.
2. variants.ts: export settleImageVariants(config) that awaits every in-flight generation under that config's dataDir (the module-level generating map), ignoring rejections.
3. Cms.close() awaits it alongside the other settled() calls, before the sandbox removes directories.
4. Drop the generateImageVariants workaround from oembed.test.ts and page-shell.test.ts where it only avoided the race; rerun 50 times.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced with a one-test file (sandbox site, 1600x1200 PNG upload under content/uploads, a post embedding it, one GET of the post, no wait on derivation, sandbox cleanup in after). It fired on the first run without tightening anything. Before the fix, 50 runs each via tsx --test: 4/50 failed with ENOTEMPTY at 1600x1200, 4/50 at 4000x3000. The other runs mostly logged sharp 'unable to open for read' because cleanup removed the content dir under a running encode.

Fix: variants.ts exports settleImageVariants(config), which waits (Promise.allSettled) for every entry of the module-level generating map whose derived directory sits under <dataDir>/images/, and loops until none is left, so a generation started while it waits is waited for too. Cms.close() awaits it after mail.settled() and before the server and stores close. Not re-exported from the package; only close() needs it.

After the fix, 50 runs each: 0/50 failed at 1600x1200, 0/50 at 4000x3000.

Permanent test: src/images/site.test.ts 'closing a site while its images derive' opens a CMS through its own sandbox over directories from the file's sandbox, renders a post naming a 4000x3000 upload, closes, then asserts image.json exists. Mutation check: with the settleImageVariants line removed from close() it failed 3/3 runs ('close returned before the variants were recorded'); with it, it passes.

Workarounds: none removed. Every generateImageVariants call in oembed.test.ts and page-shell.test.ts sits in an upload() helper whose callers assert a recorded size. Removing the call fails oembed 'gives a post with an image its thumbnail' (thumbnail_width/height) and page-shell 'cards a wide picture large, with its size' and 'keeps a square avatar, or a narrow picture, a summary' (og:image:width, card type). oembed 'honours maxwidth and maxheight' still passed without it, but only because no thumbnail exists at all, which makes it vacuous, so the call stays there too. The helper doc comments now say the derivation is there to record the size.

Checks: pnpm build, test (3051 + 30 pass), typecheck, lint, format:check all clean.

Orchestrator verification: the committed race test (images/site.test.ts, 'closing a site while its images derive') passed 30/30 runs on the branch, and failed 10/10 with the settleImageVariants line removed from close(). AC #3: none of the generateImageVariants calls in tests existed only to dodge the race. Each one records the image size that the thumbnail and card assertions need, so all of them stay, and their doc comments now say so. Full suite 3061 + 30 pass; typecheck, lint, format clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Cms.close() now waits for every background image derivation under the site's dataDir (settleImageVariants in images/variants.ts), so nothing is still writing when a sandbox removes the directory. Verified with a race test: before the fix it failed 4/50 with ENOTEMPTY, after it 0/50 and 30/30, and 10/10 failures when the wait is removed. The generateImageVariants calls left in tests record image sizes, not a race workaround.
<!-- SECTION:FINAL_SUMMARY:END -->
