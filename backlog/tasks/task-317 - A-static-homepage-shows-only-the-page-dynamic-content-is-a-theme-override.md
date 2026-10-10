---
id: TASK-317
title: 'A static homepage shows only the page; dynamic content is a theme override'
status: To Do
assignee: []
created_date: '2026-10-10 10:06'
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
- [ ] #1 With a static homepage, the default theme's front page renders the page's own title and content only: no Recent Posts, no line of links, no bio
- [ ] #2 The month-or-five rule (recentPosts, RECENT_POSTS, decision-16) is removed from core, and a decision records the reversal
- [ ] #3 A site theme that overrides front-page.njk can list the newest published posts, choosing the count, with the same entry context a listing uses (drafts and future-dated posts excluded); documented with an example in the default theme README
- [ ] #4 The front page keeps its rel="me" identity claims and h-card somewhere documented, or a decision records that it doesn't, and why
- [ ] #5 The CMS README's front page section and the default theme README describe the new behaviour
<!-- AC:END -->
