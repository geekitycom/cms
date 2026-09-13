---
id: TASK-83
title: >-
  Post and page: the blog-post h-entry, the Published line inside e-content, the
  bio h-card footer with the site menu, previous and next links, and the
  IndieNews u-category
status: To Do
assignee: []
created_date: '2026-09-13 13:37'
labels:
  - web
milestone: m-14
dependencies:
  - TASK-82
references:
  - packages/cms/themes/default/layouts/post.njk
  - packages/cms/themes/default/layouts/page.njk
  - packages/cms/themes/default/partials/byline.njk
  - >-
    /Users/andrewshell/code/wordpress/asdo-theme/template-parts/content-essay.php
  - /Users/andrewshell/code/wordpress/asdo-theme/template-parts/bio.php
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 108800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite layouts/post.njk and layouts/page.njk to the source entry (decision-16): article.blog-post.h-entry with header > h1.p-name, section.e-content holding the rendered body and then a paragraph with an a.u-url to the permalink wrapping time.small.dt-published Published (long date), and a time.small.dt-updated Updated line when the updated date differs by day; on a post the paragraph starts with an a.u-category.small link to https://news.indieweb.org/en reading #indienews when the post is tagged indienews. Then an hr and a footer holding the bio. partials/bio.njk is new: div.bio.p-author.h-card with a .bio-avatar img.u-photo of the author avatar at 50px, Written by a.p-name.u-url[rel="author me"] to the author url (the profile link when one is marked as the website, else the author archive), a job title as p-job-title and a location as p-locality when present (TASK-79), and an ul.hlist of the site menu items, so the navigation setting is what the bio lists. The author is the post author on a post and siteAuthor on a page; with neither the bio is omitted. After the article on a post: nav.blog-post-nav with rel prev and next links to previous and next when present, then the conversation and the comment form as now. Categories and tags are printed under the entry as p.post-categories of p-category links, categories then tags. The byline partial is retired in favour of the bio and the README says how a site that used it moves.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post renders article.blog-post.h-entry with h1.p-name, section.e-content containing the body and a trailing paragraph with a.u-url > time.dt-published Published and, only when the day differs, time.dt-updated Updated, then hr and footer .bio
- [ ] #2 partials/bio.njk renders .bio.p-author.h-card with .bio-avatar img.u-photo, Written by a.p-name.u-url[rel="author me"], p-job-title and p-locality only when set, and an .hlist of the site menu; a post with no resolvable author and a page with no siteAuthor omit the bio
- [ ] #3 A post tagged indienews prints a.u-category[href="https://news.indieweb.org/en"] at the start of the Published paragraph and no other post does
- [ ] #4 nav.blog-post-nav prints rel="prev" and rel="next" links to the neighbouring posts with their titles and arrow text, and is absent when a post has neither
- [ ] #5 Categories and tags print as p.post-categories a.p-category under the entry; the demo theme override that extends the base layout still renders its byline and reading time; the stylesheet gains the blog-post, bio, bio-avatar and blog-post-nav rules
- [ ] #6 The theme README documents the bio partial, the retirement of partials/byline.njk and the e-content shape; site.test.ts and the demo site test are updated and pass
<!-- AC:END -->
