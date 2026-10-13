---
id: TASK-331
title: The Eleventy example config catches up with the theme context
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 18:09'
updated_date: '2026-10-10 20:31'
labels:
  - themes
  - eleventy
dependencies: []
references:
  - packages/cms/docs/eleventy.config.example.js
priority: low
type: docs
ordinal: 290800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/docs/eleventy.config.example.js claims to build the default theme the way the CMS does, but it has fallen behind several changes: newestPosts(count) on the front page (TASK-317, which replaced recentPosts, never mirrored either); native comment urls are still #comment-{id} rather than /comment/{id}/ (TASK-318), which is right only if a static build has no comment pages and should say so; a visible reply under a hidden comment is dropped where the CMS shows a placeholder (TASK-325); reply posts shown inline in threads (TASK-300); and backlinks (TASK-322). Decide per feature whether the example mirrors it or documents that a static build leaves it out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An Eleventy build of a site using the default theme front-page override with newestPosts(5) succeeds
- [x] #2 For comment pages, placeholders, inline reply posts and backlinks, the example either mirrors the CMS or says in its header which it leaves out and why
- [x] #3 The example's claim to match the CMS is accurate
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Premise check: the example builds a site's own layouts; the default theme's templates fail under it on missing filters (absoluteUrl first) and on newestPosts. Probed: with absoluteUrl, asset, host, fediverseHandle and a newestPosts global, the default theme's layouts and partials build.
2. Tests first in packages/cms/test/eleventy.test.ts: (a) a second build of the fixtures with the default theme's layouts and partials as the includes and andrewshell.org's front-page override over newestPosts(5) succeeds, lists the newest published posts by title in order, no draft; (b) a refusal of newestPosts(0); (c) the fixtures' post thread shows a placeholder for a pending comment and for a deleted one with the approved replies under them, counts exclude placeholders.
3. Example: newestPosts(count) Nunjucks global returning listing entries in the shape partials/post-list.njk reads (url, title, named, postType, date, summary, content, categories, lang), RangeError like the CMS; the filters absoluteUrl, asset, host, fediverseHandle; the datetime date format.
4. Placeholders (TASK-325): port threadOf's placeholder rule into conversationIn: held native comments (any status but approved) and unknown parents of native replies get { id, withheld: true, replies }, created on demand, sorted by first visible reply, not counted. Fixture post.njk renders nested replies with placeholders.
5. Document omissions in the header: comment pages /comment/{id}/ (no comment server; the post keeps #comment-{id} anchors, so entries link there), inline reply posts (TASK-300) and backlinks (TASK-322/330) need other documents' rendered HTML and the redirect table, and the default theme's own context (menus, conversation, neighbours, feeds, search ...) is not handed to it. Rewrite the header claim to say what matches: URLs, and the context listed.
6. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Premise: the example never built the default theme; it builds a site's own layouts. Copying the default theme's layouts/ and partials/ into _includes failed first on the absoluteUrl filter (base.njk), then would fail on newestPosts. Grep of the theme's templates: the filters it uses that the example lacked are absoluteUrl, asset, host, fediverseHandle, plus the date format datetime; the only context function is newestPosts (in overrides). Missing context keys (menus, conversation, backlinks, neighbours, commentForm, pagination, search) render empty rather than fail.
Built: newestPosts(count) as a Nunjucks global over collections.all (posts only, newest first, count limited), returning listing entries in the fields partials/post-list.njk reads (url, title, named, postType article|note, date, summary from description, content, categories, tags, lang); RangeError with the CMS's message for a count that is not a whole number >= 1. The four filters, mirroring the CMS (asset is /theme/{path}, no hash; the header says to passthrough-copy the theme's static/ there). One siteJson() reader replaces the three site.json reads.
Placeholders (TASK-325): mirrored. storedCommentsFor reads every stored comment; non-approved ones are held (id -> inReplyTo); threadOf ports the CMS's rule (held parent or unknown parent of a native reply gets { id, withheld: true, replies }, made on demand, under the held one's own target or the post), sortThread orders by a placeholder's first visible reply, countReplies skips placeholders.
Documented omissions in the header (and in the CMS README's Eleventy section and the theme README's conversation section): comment pages /comment/{id}/ (no server to take a comment; url stays #comment-{id}, which the default theme prints as the anchor), reply posts in threads (TASK-300, needs the CMS's index of in-reply-to), backlinks (TASK-322/330, needs every document's links and the redirect table), neighbours. Header claim rewritten: URLs match, and the default theme builds but only with the context the config gives. The README line 'Everything else is the same directory' is gone.
Tests (test/eleventy.test.ts, written first and failing): the fixtures built with the default theme's layouts and partials and andrewshell.org's front-page override over newestPosts(5) list the three newest posts by title, no draft; newestPosts(2) lists two; newestPosts(0) fails the build with the CMS's message; the fixtures' thread shows placeholders for a pending and a deleted comment with the approved replies under them, the spam with nothing under it leaves no trace, and 4 replies are counted. Mutations checked: dropping the RangeError or the slice fails the matching test. Each build names its override afresh because Eleventy caches a compiled layout by path for the process.
Also built a scratch copy of the fixtures with the real asdo_geekity themes/andrewshell/layouts/front-page.njk (recentPosts swapped for newestPosts(5)): builds, lists Hello, World!, Café au Lait, Renamed in the Admin, stylesheet at /theme/style.css.
Validation: pnpm build, pnpm test (cms 5383, demo 32, plugins all pass), pnpm test:11ty (cms 22, demo 8), pnpm typecheck, pnpm lint, pnpm format:check all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The Eleventy example config builds the default theme's layouts and partials, and a site theme's front-page override that calls newestPosts(5): it adds newestPosts(count) (listing entries for partials/post-list.njk, the CMS's RangeError), the absoluteUrl, asset, host and fediverseHandle filters and the datetime date format. Placeholders for hidden comments (TASK-325) are mirrored in the conversation filter. Comment pages, inline reply posts, backlinks and neighbours are documented in the header as left out of a static build, with the reason; the header and the CMS README now say the default theme builds with only the context the config gives. Verified by new test:11ty tests (default theme build, count limit, refusal, placeholders), a build of andrewshell.org's real override, and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
