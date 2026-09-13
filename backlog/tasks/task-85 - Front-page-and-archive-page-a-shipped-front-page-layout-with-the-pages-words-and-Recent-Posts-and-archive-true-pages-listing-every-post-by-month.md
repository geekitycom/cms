---
id: TASK-85
title: >-
  Front page and archive page: a shipped front-page layout with the page's words
  and Recent Posts, and archive: true pages listing every post by month
status: To Do
assignee: []
created_date: '2026-09-13 13:37'
labels:
  - web
  - content
milestone: m-14
dependencies:
  - TASK-84
references:
  - packages/cms/themes/default/README.md
  - packages/cms/src/web/render.ts
  - packages/cms/src/web/routes.ts
  - apps/demo/content
  - /Users/andrewshell/code/wordpress/asdo-theme/front-page.php
  - /Users/andrewshell/code/wordpress/asdo-theme/page-essays.php
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 110800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two page kinds from the source theme (decision-16). Front page: the default theme ships layouts/front-page.njk, until now an override point only. It renders the homepage page (the Reading setting) as the page body without the Published line or the bio, then an h2 Recent Posts over a .feed.h-feed of recentPosts (TASK-79) with h3 titles, then a line of links to the posts page when one is set and to search once it exists, then the bio. The site with no homepage set keeps the listing at / as now. Archive page: a page whose front matter says archive: true renders its body and then every published post grouped by month, newest first, each month an h2 of Month Year over an ol.list-none of permalink links, the source theme essays page; the front matter key is documented beside contact: true and the Eleventy example config is unaffected because the page still builds as a page there. The demo gains an archive page and sets its about page as the homepage so both render; the demo tests cover them. The theme README documents both layouts and the front-page and posts-page table is updated to say front-page.njk now ships.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With a homepage set, GET / renders the page body, then h2 Recent Posts and a .feed.h-feed of recentPosts with h3.feed-title entries, then the link line and the bio; the page permalink still redirects to / and the posts page link appears only when one is set
- [ ] #2 A site theme that ships its own layouts/front-page.njk still wins over the packaged one
- [ ] #3 A page with archive: true renders its body and then every published post grouped by month, newest first, as h2 Month Year headings over ol.list-none links; drafts and future posts are absent and a page without the key is unchanged
- [ ] #4 The demo content has an archive page and a homepage set, and apps/demo/test/site.test.ts proves both render; the Eleventy compatibility test still passes
- [ ] #5 themes/default/README.md documents archive: true beside contact: true, and its front-page table says the layout ships; front-page.test.ts is updated
<!-- AC:END -->
