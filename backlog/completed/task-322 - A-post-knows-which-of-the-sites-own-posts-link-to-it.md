---
id: TASK-322
title: A post knows which of the site's own posts link to it
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 12:41'
updated_date: '2026-10-10 18:06'
labels:
  - indieweb
  - themes
dependencies: []
references:
  - packages/cms/src/webmention/links.ts
priority: low
type: feature
ordinal: 281800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A link from one post to another post or page on the same site sends nothing: the webmention sender drops own-site targets (`externalTarget`, packages/cms/src/webmention/links.ts), and nothing else records the link, so the linked post never learns it was cited.

Do not send self-webmentions. They would put the site's own posts through moderation and the comment count, and cost an HTTP round trip to itself (WordPress self-pingbacks are mostly turned off for that reason). Instead, core already indexes every post's rendered body, so it records which published posts and pages link to which, and a theme reads that as backlinks on the linked document's context, apart from comments.

The default theme prints a "Linked from" list under a post or page that has backlinks, from a partial a site theme can reuse, move or leave out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post or page's theme context lists the published posts and pages on the site whose body links to it, newest first, each with title (or its wordless label), URL and date
- [x] #2 A link counts whether absolute or relative, with or without a trailing slash, a fragment or a query, and through a redirect_from or former permalink of the target; a post linking to itself does not count
- [x] #3 Drafts, future-dated, unlisted, private and trashed posts never appear as backlinks, and a backlink disappears when the linking post is edited to drop the link, unpublished or deleted
- [x] #4 No webmention, comment record or moderation item is created for an own-site link, and comment counts are unchanged
- [x] #5 The default theme prints a "Linked from" list under a post or page with backlinks, apart from the comments, and prints nothing when there are none; the list comes from a partial a site theme can include or override, documented in the default theme README
- [x] #6 The CMS README says own-site links are recorded as backlinks rather than sent as webmentions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. webmention/links.ts: ownSiteLinks(html, pageUrl, baseUrl) returns the site paths a body links to (root-relative hrefs read under the base directory as the feeds read them, other relative hrefs against the page's own URL, absolute same-origin URLs), decoded, with query, fragment and trailing slash dropped; siteLinkKey(path) is the same normalisation for a permalink or redirect_from path. Shares linkTarget with externalTarget, so own-site and external stay the two halves of one split.
2. content/store.ts migration 11: document_links (path REFERENCES documents ON DELETE CASCADE, target, PK (path, target)), index on target, and keys_base reset to NULL so the next open with a base URL fills every row's links from its stored html. writeOne rewrites a document's links with its other base-derived keys; refreshRepliesKeys rewrites links too; clear() empties the table.
3. ContentStore.listBacklinks(document): listed (LISTED_CLAUSE) posts and pages other than the document whose links name the document's permalink key or a redirect_from key that resolves to it (no document holds it as a permalink, getByFormerPermalink answers this document), newest first. Targets are stored as paths and matched at read time, so a link written before its target exists counts once the target does, and a source becoming public later counts with no rewrite.
4. web/context.ts BacklinkContext { title, url, date? }; renderer option backlinks(document) wired in index.ts like neighbours; documentPage puts backlinks: BacklinkContext[] (empty when none) on the context.
5. themes/default partials/backlinks.njk (section.backlinks, h2 Linked from, ol of links with dates), included by layouts/post.njk and layouts/page.njk after the article, before the conversation; style in src/style.css; README sections in the theme README and the CMS README.
6. Tests first: links.test.ts (normalisation), store.test.ts (AC1-3 incl. later target, redirect_from, self link, visibility, edit/unpublish/delete, migration list), an HTTP test for the rendered list and the empty case, and that an own-site link creates no webmention or comment (AC4).
7. pnpm build/test/typecheck/lint/format:check, curl a scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: content migration 11 adds document_links (path -> documents ON DELETE CASCADE, target, PK (path, target), index on target). target is the normalised site path a link names (webmention/links.ts ownSiteLinks: root-relative hrefs read under the base directory as the feeds read them, other relative hrefs against the page's own URL, absolute same-origin URLs; decoded, query, fragment and trailing slash dropped via siteLinkKey). Paths, not document ids, are stored and resolved on read, so a link written before its target exists counts once the target does.
Rows are rewritten in writeOne beside the /replies/ keys and dropped by the FK cascade on remove and by clear(). Like the keys they need the base URL: refreshRepliesKeys became refreshAgainstBase and rewrites links too, and migration 11 resets keys_base to NULL so the first open with a base fills every row's links from its stored html, with no file scan. Without a base URL no links are written (same as keys).
ContentStore.listBacklinks(document) reads with LISTED_CLAUSE (drafts, future-dated, unlisted, private, trashed out), excludes the document itself, newest first. The document's keys are its permalink plus each redirect_from that still resolves to it (no document holds it as a permalink, and getByFormerPermalink answers this document), so a former URL a live post has taken over counts for that post, not this one.
Renderer option backlinks(document) wired in index.ts like neighbours; context key backlinks: BacklinkContext[] ({ title, url, date? }, title via postLabel), always a list. Default theme partials/backlinks.njk (section.backlinks, h2 Linked from, ol with <time>), included by layouts/post.njk and layouts/page.njk after the article; styles in src/style.css.
Not handled: a link to / does not count for a page set as the homepage (its permalink is not /), and a link to a stored WordPress-style ?p= id does not resolve (the query is dropped). The Eleventy example config is not mirrored: it would need every document's rendered templateContent inside a collection, which is not a trivial addition, and it does not mirror neighbours either.
Validation: pnpm build, pnpm test (cms 5346 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. New tests: webmention/links.test.ts ownSiteLinks, content/store.test.ts 'backlinks (TASK-322)', web/backlinks.test.ts over HTTP. Scratch site curl: /2026/09/target/ listed Citing it (linked through redirect_from /2026/09/old-target without slash) and About (relative ../2026/09/target), left out an unlisted linking post, and printed no section on pages nothing links to. AC4 test guards existing behaviour (externalTarget already dropped own-site links); it passes with and without the new code.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Own-site links now become backlinks. The content index stores each document's outgoing own-site link targets as normalised paths (migration 11, document_links), ContentStore.listBacklinks matches them on read against the target's permalink and live redirect_from paths under the listing visibility rules, the renderer puts backlinks ({ title, url, date }) on every post and page context, and the default theme prints them as a Linked from section from partials/backlinks.njk. No webmention, comment or moderation item is created. Documented in the theme README and the CMS README. Verified with unit, store and HTTP tests, the full build/test/typecheck/lint/format suite, and curl against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
