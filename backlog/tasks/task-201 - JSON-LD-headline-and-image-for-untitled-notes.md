---
id: TASK-201
title: JSON-LD headline and image for untitled notes
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:07'
updated_date: '2026-10-02 06:56'
labels:
  - theme
  - seo
  - schema-org
milestone: m-27
dependencies:
  - TASK-192
references:
  - packages/cms/themes/default/partials/jsonld.njk
  - backlog/decisions
priority: low
type: enhancement
ordinal: 217800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default theme's JSON-LD BlogPosting takes headline from the post's title (partials/jsonld.njk, decision-16), so a note, which has no title, has no headline. Its image comes from metaImage, so a note with no image in it has none either. Google lists headline and image as recommended for article rich results, so notes rarely qualify. Seen live on shll.me: /2026/09/this-post-should-be-able/ prints a BlogPosting with description but no headline or image. Give an untitled post a headline built the same way the theme builds the note's hidden h1 and its <title> (the summary or opening words, trimmed to Google's 110 characters on a word boundary), and fall back to the author's photo, then the site icon, for image when the post has none. Titled posts and pages keep today's values.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An untitled note's BlogPosting has a headline matching its visible title text (the hidden h1 / <title>), at most 110 characters, cut on a word boundary
- [x] #2 A post with no image of its own has image set to the author's photo, or the site icon when there is no photo; a post with an image keeps it
- [x] #3 Titled posts and pages print the same headline and image as before
- [x] #4 A note's page passes Google's Rich Results Test for Article with no missing recommended headline or image
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in packages/cms/src/web/page-shell.test.ts for each AC: an untitled note's BlogPosting headline equals its label (the <title> words), at most 110 chars cut on a word boundary; a post with no image falls back to the author's avatar, then site.icon; a post with its own image keeps it; titled posts and pages keep headline and image.
2. partials/jsonld.njk: headline = title, else the post's label (what <title> prints) through nunjucks truncate(109, false, '…') so the result is at most 110 characters. image = metaImage (own image, else site avatar, today's value), else on a post siteAuthor.avatar, else site.icon, through absoluteUrl. Pages keep today's values.
3. Update the partial's comment and the theme README if it documents the graph.
4. Verify with pnpm build, test, typecheck, lint, format:check, and curl a running demo note's JSON-LD. AC #4 (Rich Results Test) needs a public URL; leave unchecked.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order: after TASK-192. Both edit themes/default/partials/jsonld.njk, and the image fallback to the author's photo reads the site author that TASK-192 reworks; building this first means redoing it.

Headline: title, else on a post the context's label (the words base.njk puts in <title> as pageTitle) through nunjucks truncate(109, false, '…'), so at most 110 characters cut where a word ends. Reused label rather than the hidden h1, which reads 'Note by X, date' and is no headline; the task description names the <title> words. Titled posts and pages keep title as before, untruncated.
Image: metaImage first (the post's own image, else the site avatar, today's value, so AC #3 holds on every site that printed one), then on a post siteAuthor.avatar (the post's writer), then site.icon, through absoluteUrl. site.icon is the original upload, not the icons list: the largest head icon is 180px, under Google's 50K-pixel article image guideline. Caveat: site.icon is printed as the setting names it, without checking the upload exists. Pages keep today's image.
Tests: 6 new in packages/cms/src/web/page-shell.test.ts (TASK-201 describe). Before the change, 4 failed with headline/image undefined against the expected literal; keep-image and unchanged-values passed as guards.
Gates: pnpm build && pnpm test (3094 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check, exit 0.
HTTP: served a scratch copy of the demo content with an untitled note on port 3491; the note's BlogPosting printed headline 'This post should be able to say something without a …' matching its <title>; with site.icon set, both the note and a titled post without an image printed image http://localhost:3491/uploads/2026/09/icon.png. Server stopped.
AC #4 not checked: Google's Rich Results Test needs a public URL. Structurally the BlogPosting now carries every Article recommended property (author, datePublished, dateModified, headline, image) when the site has an author photo, avatar or icon; verify on shll.me after deploy.

2026-10-02, 0.14.0 on shll.me: Google's Rich Results Test on https://shll.me/2026/09/this-post-should-be-able/ reported Articles: 1 valid item detected, with no missing recommended fields (screenshot from the site owner).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The default theme's JSON-LD now heads an untitled post with the words its <title> names it by, cut to 110 characters on a word boundary, and gives a post with no image the site avatar, else its author's photo, else the site icon; titled posts and pages are unchanged. Verified by six tests in page-shell.test.ts (four failing before), the full gates, curl against a served note, and Google's Rich Results Test on the deployed note (1 valid Article).
<!-- SECTION:FINAL_SUMMARY:END -->
