---
id: TASK-414
title: 'A derived image of an upload that is not an image answers 404, not 500'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-15 01:16'
updated_date: '2026-10-15 02:13'
labels: []
milestone: m-39
dependencies: []
references:
  - packages/cms/src/web/asset-routes.ts
  - packages/cms/src/images/variants.ts
priority: low
type: bug
ordinal: 369800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A request under /uploads/_/ for a derived variant (packages/cms/src/web/asset-routes.ts imageVariant, images/variants.ts) whose source upload exists but is not an image sharp can read answers 500 with 'Input file contains unsupported image format'. Found while building TASK-377. A variant of a source that cannot be resized is a missing resource, not a server error, and should answer 404 without logging an error.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A variant request whose source is not a readable image answers 404 and logs no error; a test proves it
- [x] #2 A variant of a real image is served as today
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing test in packages/cms/src/images/site.test.ts: an upload named .jpg whose bytes are text, requested as a variant, answers 404 with console.error silent; plus a variant of a real image whose derived file cannot be written still answers 500.
2. In images/variants.ts derive(): read the source's metadata inside a try; a rejection there means sharp cannot read the source as an image, so answer undefined (no variants) like a GIF or a missing file. Errors after that point (mkdir, encode, writing the variant or the sidecar) still throw and reach onError as a 500.
3. Run the full verify suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
How the two are told apart: by where the failure happens, not by sharp's message text. derive() reads the source's header with sharp(file).metadata() inside a try; a rejection there means sharp cannot read the file as an image, so it answers undefined like a GIF or a missing file and findImageVariant gives the handler a 404. Everything after that (mkdir of the derived directory, each encode, writing the variant and the sidecar) still throws and reaches app.onError as a logged 500. Matching on message strings was rejected: sharp/libvips wording is not a contract. Side effect: a render that calls generateImageVariants on a non-image .jpg no longer logs either.
Test proof: site.test.ts 'a variant of an upload that cannot be derived' — a text file named .jpg and a PDF named .png answer 404 with console.error silent (failed with 500 before the fix); a real PNG whose derived directory path is blocked by a file answers 500 and logs, which guards against catching too much. Existing end-to-end variant tests (derive on upload, rebuild after delete, cache lifetimes, AVIF) pass unchanged.
Validation: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A /uploads/_/ variant of an upload sharp cannot read (text or PDF under an image extension) now answers 404 with nothing logged instead of a 500. packages/cms/src/images/variants.ts derive() treats a failed header read (sharp metadata()) as 'not an image' and derives nothing; failures after the header is read (making the directory, encoding, writing) still throw and answer 500. Proven by two new tests in packages/cms/src/images/site.test.ts (404 and silent for non-images; 500 and logged when a real image's variant cannot be written) and the full verify suite.
<!-- SECTION:FINAL_SUMMARY:END -->
