---
id: TASK-79
title: >-
  Context for the design: siteAuthor on every page, summary on listing entries,
  previous and next on a post, recentPosts on the front page, and job title and
  location on the user profile
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 13:36'
updated_date: '2026-09-13 16:37'
labels:
  - web
  - admin
milestone: m-14
dependencies:
  - TASK-78
references:
  - packages/cms/src/web/context.ts
  - packages/cms/src/web/authors.ts
  - packages/cms/src/web/feed-item.ts
  - packages/cms/src/web/render.ts
  - packages/cms/src/web/routes.ts
  - packages/cms/src/admin/users.ts
  - packages/cms/themes/default/README.md
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 104800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The andrewshell.org design (decision-16) reads four things the template context does not carry. siteAuthor: the profile behind the site author setting when it names a user, resolved the way a byline resolves a post author (name, username, url, bio, avatar, links), present on every render; on a post the entry author is the same object as author, on an author archive it is the archive user. summary: on every entry in a listing (home, posts page, tag, category, author, front page), the description the author wrote or else the excerpt the feeds already compute, plain text, so a feed item can print a p-summary. previous and next: on a post, the published post before and after it by date, each with title and url, absent at the ends. recentPosts: on the front page (the page the homepage setting names), the newest published posts, the posts of the current month when there are at least five of them and the five newest otherwise, the rule the source theme uses. The user profile also gains two optional text fields, job title and location, edited on the user profile screen and present on the author and siteAuthor objects, so the bio can print them and the JSON-LD Person can carry jobTitle and address. Document every key in themes/default/README.md as part of the context contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 siteAuthor is on the context of every rendered page, is the resolved profile when the site author setting names a user, is the post author on a post and the archive user on an author archive, and is absent when nobody matches; a test covers each
- [x] #2 Every entry in every listing carries summary, the front-matter description or else the same excerpt the feeds print, and a post with neither has an empty summary rather than a missing key
- [x] #3 A post carries previous and next with title and url for its neighbours by date among published posts, absent at either end; drafts and future posts are never neighbours
- [x] #4 The front page context carries recentPosts by the current-month-or-five rule, and the home listing is unaffected
- [x] #5 The user profile screen edits optional job title and location fields, they round-trip through the profile store, and author and siteAuthor expose them as jobTitle and location
- [x] #6 themes/default/README.md documents siteAuthor, summary, previous, next, recentPosts, jobTitle and location as context keys
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Store (content/store.ts): two narrow queries the web layer cannot express — `neighbours(document)`, the published posts either side of one by (date_sort, path) with two LIMIT 1 selects and an empty pair for anything that is not a post, and `listPostsSince(instant)`, published posts dated at or after a UTC instant. Tests in store.test.ts first.
2. Profiles (admin/accounts.ts): `UserProfile` gains optional `jobTitle` and `location`; `cleanProfile` trims them and `profileFrom` reads them, so a hand-edited file and a saved form read alike.
3. Profile screen (admin/users.ts + admin/layouts/users.njk): two more boxes on the profile form, `job_title` and `location`, written by the same POST and shown by `row()`.
4. Authors (web/authors.ts): `AuthorContext` gains `jobTitle` and `location` from the profile; new `siteAuthorContext(users, author)` resolves the site author setting strictly — a user or nothing, never a bare name.
5. Summary (web/context.ts): `documentContext` gains `summary`, the `feedExcerpt` the feeds already print (description, else the excerpt, else empty), so every listing entry and every rendered document carries the same string the feed does.
6. Recent posts (new web/recent.ts): the current-month-or-five rule as a pure function over a source that can list posts and tell the time, so it is tested without a renderer.
7. Renderer (web/render.ts): `render()` puts `siteAuthor` on every page — the site author's profile, overridden by the page's own person, so `documentPage` passes the document's `author` and `renderListing` passes an author archive's user; `documentPage` adds `previous` and `next` as { title, url } from an injected `neighbours`; `renderFrontPage` adds `recentPosts` as document contexts from an injected `recentPosts`. Both injections are options beside `users` and `conversation`, wired to the store in index.ts.
8. Documentation: themes/default/README.md gains `summary`, `previous`, `next`, `recentPosts` and `siteAuthor` in the context tables and `jobTitle`/`location` in the byline table, inside the current column width; packages/cms/README.md gains a sentence on `siteAuthor` beside the one on `author`.
9. Tests: unit tests for the store queries, the recent-posts rule, the profile fields and `siteAuthorContext`; an end-to-end test file over a theme that dumps the context, proving siteAuthor on every page, summary on every listing entry, previous/next on a post and recentPosts on the front page; and an admin test for the round trip of the two new profile fields.
10. Verify with pnpm build, test, typecheck, lint and format:check, and curl a running demo for the HTTP-shaped criteria.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned, test-first.

**The index gained two narrow queries** (`src/content/store.ts`): `neighbours(document)` answers with the published posts either side of one, two `LIMIT 1` selects comparing `(date_sort, path)` as a row so the order is exactly the listings' — a draft, a trashed post, a page and a post that is not due yet are never neighbours, and a document that is not a post has none at all. `listPostsSince(instant)` is the front page's month. A `since` option on `listPosts` was rejected because the counts beside it could not honour it, and an option dropped by half the queries is a trap.

**siteAuthor** is put on in `render()`, so it is on every page the CMS draws — a listing, a document, an archive, the 404 and the editor's preview alike — and the page's own person wins by going on last: `documentPage` passes the document's resolved byline and `renderListing` passes an author archive's user. The site setting resolves through the new `siteAuthorContext`, which is stricter than `authorContext` on purpose: a name nobody answers to is absent rather than a bare `{ name }`, because there is no picture, bio or link behind it. The users file is read once per render, not twice: the site author is only resolved when the caller has not already put a person on the context.

**summary** is a modelled key on `documentContext`, computed by the feeds' own `feedExcerpt`, so a listing entry and a feed item cannot describe the same post differently. It is taken off the document rather than the rendered markup, so a site's `<picture>` markup is never cut into words. It is on a rendered document too, which is what a head's description and Open Graph tags will want in TASK-80.

**previous/next** are `{ title, url }` rather than whole document contexts, so a theme cannot print a second post by accident. **recentPosts** is the rule in `src/web/recent.ts` (this month when the month holds five, else the newest five, measured in UTC because that is what a stored date means), reaching the renderer through an injected source beside `users` and `conversation`, and asked only while drawing the front page.

**The profile** gained `jobTitle` and `location` through `cleanProfile` and `profileFrom`, so a hand-edited `users.json` and a saved form read identically, and two more boxes on the users screen. The ActivityPub actor does not carry them; `packages/cms/README.md` says so rather than leaving the mapping ambiguous.

Verification: `pnpm build`, `pnpm test` (1701 package tests + 18 demo, 0 failures), `pnpm test:11ty` (21, 0 failures), `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all clean. The demo was booted and curled — `/`, `/about/` and `/2026/09/the-theme-is-just-templates/` all 200 with the packaged theme unchanged — and stopped again.

New tests: `src/web/design-context.test.ts` boots a site wearing a theme that prints the context and asserts all four keys over HTTP; `src/web/recent.test.ts` covers the rule and its query budget; `src/content/store.test.ts` covers both new queries; `src/web/authors.test.ts`, `src/admin/accounts.test.ts` and `src/admin/users.test.ts` cover the profile fields and the strict site-author resolution.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The context now carries what the andrewshell.org design reads (decision-16). `siteAuthor` is on every rendered page — the document's own author on a post or page that names one, the archive's person on an author archive, and the profile behind the site's `author` setting everywhere else, absent when none of them name a user of this site. Every document context carries `summary`, the very string the feeds publish (description, else an excerpt, else empty), so every listing entry has one. A post carries `previous` and `next` as { title, url } for its neighbours among published posts, from two new indexed queries; `recentPosts` is on the front page by the current-month-or-five rule. The user profile gained optional job title and location fields, edited on the users screen, stored in `data/users.json` and exposed as `author.jobTitle` and `author.location`. All six keys are documented in `themes/default/README.md`, with `siteAuthor` also summarised in `packages/cms/README.md`.

Verified with `pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check` (1701 + 18 + 21 tests, 0 failures) and by booting the demo and curling `/`, `/about/` and a post, all 200. The behaviour itself is proved over HTTP by `src/web/design-context.test.ts`, which serves a site through a theme that prints the context and asserts each key on the pages that should and should not have it.
<!-- SECTION:FINAL_SUMMARY:END -->
