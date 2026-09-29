---
id: TASK-137
title: Don't lazy-load the LCP image; add fetchpriority and decoding
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 23:46'
labels:
  - performance
  - images
milestone: m-20
dependencies: []
references:
  - 'https://specification.website/spec/performance/lazy-loading/'
  - 'https://specification.website/spec/performance/image-optimization/'
  - 'https://specification.website/spec/performance/core-web-vitals/'
priority: high
type: bug
ordinal: 161800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/images/markup.ts adds loading=lazy to every image, including the first image on a post, which is usually the Largest Contentful Paint element. Lazy-loading the LCP image delays it measurably. The first image in a single post or page should load eagerly with fetchpriority=high. Every image should also get decoding=async.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On a single post or page, the first content image has no loading=lazy and has fetchpriority=high
- [x] #2 Images after the first, and all images on listing pages beyond the first entry, keep loading=lazy
- [x] #3 Every generated img carries decoding=async
- [x] #4 Tests cover a post with one image, several images, and a listing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: the image loading policy is a per-fragment flag, lead. A fragment rendered with lead gives its first <img> (any img, in document order, so an external first image still takes the slot) fetchpriority=high and no loading=lazy; every other generated img gets loading=lazy. Every generated img gets decoding=async. Author-written attributes still win.
2. markup.ts: responsiveImages and siteImageMarkup take an optional { lead } option; image() adds the loading and decoding attributes from it.
3. context.ts: documentContext takes an optional { lead } and passes it to siteImageMarkup.
4. render.ts and admin/preview.ts: a single post or page (documentPage, preview) renders with lead. A listing gives lead to the posts page's own body when it has an image, else to the first entry; later entries, recent posts and search hits stay lazy.
5. Tests first: markup unit tests (one image, several, external first image, no lead) and end-to-end site tests for a post with one image, a post with several, and a listing of several posts.
6. Verify with pnpm build, test, typecheck, lint, format:check, and curl a running demo post and listing.

7. Found while curling the demo: a front page renders its recent posts under the page body through documentPage, not renderListing, so the same rule applies there (lead to the page body when it has an image, else the first recent post). Added with its own test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: ImageLoading { lead?: boolean } is a per-fragment option on responsiveImages, siteImageMarkup and documentContext. In a lead fragment the first <img> of any kind takes the slot, so an external first image keeps later uploads lazy. Only generated imgs (uploads rewritten into a <picture>) gain attributes: the lead gets fetchpriority=high and no loading, every other gets loading=lazy, and all get decoding=async. Author-written attributes still win. Images the rewrite leaves alone (other origins, GIFs, underived uploads, optimization off) are untouched, as before and as decision-10 and the existing tests require.
Who leads: renderDocument and renderFrontPage (documentPage) and the admin preview give the body the lead. renderListing gives it to the posts page's own body when it has an <img>, else the first entry. The front page's recent posts follow the same rule against the page body. Search hits and every later entry stay lazy.
Known edge: a listing whose first entry is a titled post prints only its summary, so its lead is spent on images that are not printed, and a later note's first image stays lazy. This matches AC2 as written.
README image section documents the rule.
Validation: pnpm build, pnpm test (2507 + 31 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. Mutating the posts-page branch to false made its test fail, then restored. Served a scratch copy of the demo content with three image notes on port 3917 (server stopped after): /lcp-note-3/ gave fetchpriority=high on the first img and loading=lazy on the second; /posts/ and / gave the lead only to the first entry's first img; every img carried decoding=async.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The first image on a page is no longer lazy-loaded. A single post or page, the admin preview, a listing and a front page's recent posts now give their first generated image fetchpriority=high with no loading attribute; every later image keeps loading=lazy, and every generated img carries decoding=async. The choice is an ImageLoading { lead } option threaded through responsiveImages, siteImageMarkup and documentContext, set by the renderer. Unit tests in markup.test.ts and end-to-end tests in site.test.ts cover one image, several images, a listing, a posts page body and a front page. Verified with the full build, test, typecheck, lint and format suite, and by curling a served copy of the demo.
<!-- SECTION:FINAL_SUMMARY:END -->
