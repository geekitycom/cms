---
id: TASK-247
title: >-
  Strip direction-control characters from fetched names and drop an author a
  title already names
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 18:07'
updated_date: '2026-10-03 18:35'
labels:
  - webmention
  - theme
dependencies: []
priority: low
type: bug
ordinal: 262800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-244 found two blemishes on cited pages. Flickr's oEmbed author_name carries invisible Unicode bidi controls (U+202A-U+202E, U+2066-U+2069, U+200E/U+200F); they are escaped but printed, and the same holds for h-card names today, so a hostile name can reorder the text around it. SoundCloud's oEmbed title is 'Flickermood by Forss' with author_name 'Forss', so the citation reads 'Flickermood by Forss by Forss'.

In packages/cms/src/webmention/reply-context.ts, strip bidi control characters from every fetched name, author name and summary before storing. In the citation and reply-context partials, when the title already ends with ' by <author name>', do not print the author name again.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Bidi control characters are removed from fetched titles, author names and words before they are stored, tested with a stubbed host
- [x] #2 A title ending in 'by <author>' is not followed by the same author name again
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in reply-context.test.ts: an oEmbed answer, an h-entry page and a plain page whose title, author name and words carry bidi controls (U+202A-U+202E, U+2066-U+2069, U+200E/U+200F, U+061C) store none of them, and a name made only of controls is dropped like an empty one.
2. Strip every Bidi_Control code point in describe(), the one place every stored string passes through, before empty checks and the excerpt, so the context file never holds them.
3. Failing HTTP tests in citation-context.test.ts and reply-context web tests: a title 'Flickermood by Forss' with author Forss prints 'by Forss' once, case-insensitively; a title that names its author elsewhere ('Rick Astley - Never Gonna Give You Up' by Rick Astley) keeps its author; mf2 still parses the same name and author h-card.
4. Decide at render, not store, so the stored context stays faithful: one shared macro in a new partial splits a title ending in ' by <author>' into the title link and the author h-card, keeping p-name as the whole title and the author's link. Both partials use it.
5. Update the theme README; build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Stripping happens in describe() in packages/cms/src/webmention/reply-context.ts. Every stored string passes through it, whether it came from an h-entry, oEmbed, <title>, og:title or a description. A new visible() helper removes every \p{Bidi_Control} code point (U+061C, U+200E/F, U+202A-E, U+2066-9), collapses whitespace and trims. This runs before the empty checks and the excerpt, so a name made only of controls counts as no name.

The repeated author is handled at render, not at store, so replyContexts.json still holds what the page said. A new partial, themes/default/partials/cited-page.njk, holds one macro that both reply-context.njk and citations.njk use. When the trimmed name ends in ' by ' plus the author name (case-insensitive), the macro prints the name in two parts. The part before ' by ' links the cited page. The title's own words after ' by ' become the p-author h-card, keeping the author's link. A span.p-name wraps both parts, so mf2 still reads the whole title as the name. A title that names its author anywhere else keeps the author after it.

Tests:
- src/webmention/reply-context.test.ts, stubbed host: oEmbed title and author, h-entry name, author and words, <title>, og:title, a name made only of controls, and other scripts kept.
- src/web/citation-context.test.ts, over HTTP with microformats-parser: Flickermood by Forss, a case-insensitive match, the Rick Astley guard, and a listing.
- src/web/reply-context.test.ts: the reply partial.

pnpm build, test (3805 + 30 pass), typecheck, lint and format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fetched names, author names and words lose their bidi control characters before they are stored, and a citation whose title already ends in 'by <author>' prints the author once. Stripping is in describe(), the one place every stored string passes through. The render rule is a shared cited-page.njk macro: it splits such a title into the page link and the author h-card, keeping the author link and the mf2 name. The theme README documents the rule. Verified with failing-first unit tests against a stubbed host, HTTP render tests checked with microformats-parser, and the full build, test, typecheck, lint and format:check run.
<!-- SECTION:FINAL_SUMMARY:END -->
