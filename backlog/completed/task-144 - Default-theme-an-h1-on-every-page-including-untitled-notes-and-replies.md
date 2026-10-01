---
id: TASK-144
title: 'Default theme: an h1 on every page, including untitled notes and replies'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-30 04:18'
labels:
  - accessibility
  - seo
  - theme
milestone: m-21
dependencies: []
references:
  - 'https://specification.website/spec/seo/heading-hierarchy/'
priority: medium
type: bug
ordinal: 168800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
post.njk renders an h1 only for a named post. The page of an untitled note or reply has no h1, which leaves screen-reader users and crawlers with no top-level heading to navigate by.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every single-post page in the default theme has exactly one h1
- [x] #2 For an untitled post the h1 is meaningful (for example, the author and date) and can be visually hidden so the note's look is unchanged
- [x] #3 Heading levels below it never skip a level
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add packages/cms/src/web/headings.test.ts: over HTTP against the default theme, a named article, an untitled note and an untitled reply each render exactly one h1; the untitled ones' h1 names the kind, author and date, carries screen-reader-text and no p-name; the whole page's heading outline starts at h1 and never skips a level (including the comment form h2 and conversation h2s).
2. Run it red.
3. layouts/post.njk: for a post that is not named, print <h1 class="screen-reader-text">Note|Reply by <author>, <date></h1> in the article, no p-name so mf2 and Post Type Discovery are unchanged.
4. Update the notes/replies tests that asserted no h1 to assert no p-name heading instead; document the hidden heading in the theme README.
5. pnpm build/test/typecheck/lint/format:check; curl a note page on the demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
layouts/post.njk now prints, for a post that is not named, <h1 class="screen-reader-text">Note|Reply[ by <author>][, <date>]</h1> in place of the header. Author is bioAuthor (the post's author, else the site author); the date uses the site's date filter. No p-name on it, so mf2 parsing and Post Type Discovery still read a note as a note (e-content means no implied name).
Tests: new src/web/headings.test.ts (article, note with a comment thread, untitled reply: exactly one h1, first heading is h1, no level skipped; exact hidden-h1 text; no p-name; screen-reader-text rule hides). Failed first with 'h1s on /2026/09/coffee/: 2' (0 h1 found). notes.test.ts and replies.test.ts had asserted an untitled post has no h1; they now assert no visible header and the hidden h1. Theme README documents it under 'An entry'.
Verified: pnpm build, pnpm test (2641 pass), typecheck, lint, format:check all pass. Curled a scratch site on the packaged theme: /2026/09/quick/ has '<h1 class="screen-reader-text">Note by Andrew Shell, 20 September 2026</h1>' then h2; an untitled reply has 'Reply, 21 September 2026'.
Out of scope, flagged: the demo site's own theme (apps/demo/themes/demo/layouts/post.njk) overrides post.njk and still has no h1 on an untitled post; the conversation's h2.comments-title prints 'on “”' for an untitled post because it quotes the empty title; post body headings the author writes (a Markdown '# ') can still add an h1 or skip a level.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every single-post page in the default theme now has exactly one h1. A named post keeps its visible h1.p-name; an untitled note or reply gets a visually hidden h1 (screen-reader-text) naming its kind, author and date, with no p-name so microformats are unchanged. Headings under it (conversation and comment form h2, error summary h3) step one level at a time. Verified by src/web/headings.test.ts over HTTP, the updated notes/replies tests, the full pnpm build/test/typecheck/lint/format:check run, and curl against a scratch site on the packaged theme.
<!-- SECTION:FINAL_SUMMARY:END -->
