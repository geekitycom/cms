---
id: TASK-317
title: A static homepage shows only the page; dynamic content is a theme override
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 10:06'
updated_date: '2026-10-10 11:00'
labels:
  - enhancement
milestone: m-31
dependencies: []
references:
  - packages/cms/themes/default/layouts/front-page.njk
  - packages/cms/src/web/recent.ts
  - packages/cms/src/web/render.ts
priority: low
ordinal: 276800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen in the andrewshell.org migration (asdo_geekity _local/PLAN.md). With a static homepage, the default theme's front-page.njk adds three things the page never asked for:
- Recent Posts, chosen by a hard-coded rule (recent.ts, decision-16): this month's posts if there are at least 5 (RECENT_POSTS), else the newest 5. The count is not a setting, and postsPerPage doesn't apply.
- A hard-coded line of links: the posts page, if any, then Search.
- The bio.

That is very opinionated, and it doesn't even reproduce the WordPress site it was modelled on. andrewshell.org has no posts page and /essays/ is an archive: true page, so the line shows only 'Search →', where WordPress showed 'See all essays → | See all notes → | Search →'.

Andrew, 2026-10-10: if the homepage is a static page, it shows the page content and nothing else. Dynamic content on the front page belongs in a site theme's override of front-page.njk, not in the default theme. This reverses decision-16 for the default theme.

For an override to be possible, core must still give a theme a neutral way to list the newest published posts, with the theme choosing how many. Only the opinion (the month rule, the fixed 5, the links, the bio) leaves the default theme. andrewshell.org will then rebuild its WordPress front page (5 newest posts with excerpts, then its own links) in its site theme.

andrewshell.org already overrides front-page.njk in its site theme (asdo_geekity themes/andrewshell/layouts/front-page.njk). The override includes partials/post-list.njk over recentPosts, so removing recentPosts breaks it. Name the replacement in the task, so that site can switch to it and ask for the 5 newest.

To settle in the task: the bio is where a solo-author site's front page prints its rel="me" claims and h-card (TASK-180). Decide where that identity lives once the bio is gone, for example only in rel="me" footer menu items (which andrewshell.org already has) or in a <link rel="me"> in the head. Record the choice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With a static homepage, the default theme's front page renders the page's own title and content only: no Recent Posts, no line of links, no bio
- [x] #2 The month-or-five rule (recentPosts, RECENT_POSTS, decision-16) is removed from core, and a decision records the reversal
- [x] #3 A site theme that overrides front-page.njk can list the newest published posts, choosing the count, with the same entry context a listing uses (drafts and future-dated posts excluded); documented with an example in the default theme README
- [x] #4 The front page keeps its rel="me" identity claims and h-card somewhere documented, or a decision records that it doesn't, and why
- [x] #5 The CMS README's front page section and the default theme README describe the new behaviour
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Subtract: delete web/recent.ts and recent.test.ts (recentPosts, RECENT_POSTS, startOfMonth, RecentPostsSource), store.listPostsSince and its tests, the renderer's recentPosts option and recentPostsContext, and their exports from web/index.ts and src/index.ts.
2. Replacement (neutral capability): the front page context carries newestPosts(count), a function a template calls, {% set posts = newestPosts(5) %}. It returns the newest count published posts as listing entries (the same entryContext a listing uses; drafts, future-dated, unlisted and trashed posts excluded by store.listPosts), the first entry's image eager when the page's own words hold none. Lazy: the query runs only when a theme calls it, so the default front page runs none. A count that is not a whole number of at least 1 throws, naming the function. Wired in index.ts to store.listPosts({ limit }). postsPage stays on the front page context as neutral data an override can link.
3. Default theme front-page.njk: the page's own title (h2.section-title under the site-title h1) and its rendered body, plus the contact form when the page asks (its own front matter). No Recent Posts, no link line, no bio.
4. Identity (AC#4): on a solo author site the root keeps its rel=me claims as <link rel="me"> in the head of base.njk at the root path (archive URL plus each profile link), outside any block so a front-page override keeps them; the representative h-card is no longer printed on a static front page (a site writes one in its homepage words or includes partials/bio.njk with bioHome in an override); JSON-LD WebSite about stays. Record as a decision.
5. Decisions: reversal of decision-16's front page (AC#2) and the identity placement (AC#4), via backlog decision create.
6. Tests first: front-page.test.ts and design-context/solo-author tests for AC#1, AC#3 (count, drafts, future-dated excluded, through a site theme override), AC#4 (head rel=me on a static front page of a solo author site, none otherwise).
7. Docs: packages/cms/README.md front page section, themes/default/README.md front page section and context table with the newestPosts example; migrate any recentPosts users in apps/demo.
8. Verify: pnpm build, test, typecheck, lint, format:check; curl a running static-homepage site with the default theme and with a sample override.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replacement for recentPosts: newestPosts(count), a function on the front page context only. {% set posts = newestPosts(5) %} then {% include "partials/post-list.njk" %} gives the five newest published posts as listing entries (entryContext, the shape a listing's posts are). Drafts, future-dated, unlisted and trashed posts are excluded by store.listPosts. Lazy: the query runs only when a template calls it, so the packaged front page runs none. A count that is not a whole number of at least 1 throws a RangeError (a negative LIMIT would mean every post in SQLite). andrewshell.org's override switches from {% set posts = recentPosts %} to {% set posts = newestPosts(5) %}.
Chose a context function over a theme.json key or front matter: the theme chooses the count (front matter would be the content's choice), and it needs no manifest parsing. There is no Nunjucks global in the web renderer; data reaches themes as context keys, so the function is a context key.
Removed: web/recent.ts and recent.test.ts (recentPosts, RECENT_POSTS, startOfMonth, RecentPostsSource), store.listPostsSince and its tests (its only caller was the month rule), the renderer's recentPosts option, and the exports from web/index.ts and src/index.ts. postsPage stays on the front page context as neutral data an override can link.
Default front-page.njk: h2.section-title with the page title, div.page-body.e-content, and the contact form when the page asks. The stylesheet keeps .section-title and .front-links because an override (andrewshell.org's) uses them; the README says so. The demo theme's .front-links rule went, since nothing in the demo prints it.
Identity (decision-45): base.njk prints <link rel="me"> for the solo author's archive and each profile link in the head at the root path, outside every block, so a front-page override keeps the claims. The representative h-card is no longer on a static front page; a listing homepage keeps its bio card. The README shows an override that includes partials/bio.njk with bioHome.
Decisions: decision-44 (reverses decision-16's front page) and decision-45 (identity). Bodies to be filled by the orchestrator from the handoff report; the CLI writes only title and status.
Tests: page-kinds.test.ts (AC#1, failed first on the missing title and the Recent Posts markup), design-context.test.ts newestPosts suite (count, drafts and future excluded, no month rule, refusal of 0, recentPosts gone, front page only), front-page.test.ts (an override over post-list.njk lists the two newest without a draft or a 2099 post), solo-author.test.ts (static front page: no card, claims kept, no representative h-card), images/site.test.ts (lead image now proven through a newestPosts override), apps/demo/test/site.test.ts.
Validation: pnpm build, pnpm test (cms 5185 pass, demo 32, plugins all pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all clean. Curled scratch sites: default theme / has <main> holding only h2 Welcome and the page body, and the head carries link rel=me to /author/ada/ and the Mastodon profile; an override with newestPosts(3) lists Post 6, 5, 4 and neither the draft nor the 2099 post. Servers stopped.
Commit type: feat(cms)! with a BREAKING CHANGE footer, since a documented theme-context key (recentPosts) and public exports are removed. bump-minor-pre-major is on, so it releases as 0.29.0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A static homepage now renders only its own title and words in the default theme: no Recent Posts, no link line, no bio. The month-or-five rule (recentPosts, RECENT_POSTS, startOfMonth, store.listPostsSince) is gone from core, reversed in decision-44. A site theme's front-page.njk calls newestPosts(count) for the newest published posts as listing entries, documented with an example in both READMEs. The solo author's rel=me claims stay on / as head links from base.njk (decision-45); the static front page prints no h-card. Verified by new and updated tests (page-kinds, design-context, front-page, solo-author, images/site, demo site), the full build/test/typecheck/lint/format run, and curl against a default-theme site and an override site.
<!-- SECTION:FINAL_SUMMARY:END -->
