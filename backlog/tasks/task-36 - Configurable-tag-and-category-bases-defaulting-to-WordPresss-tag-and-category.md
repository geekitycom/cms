---
id: TASK-36
title: >-
  Configurable tag and category bases, defaulting to WordPress's /tag/ and
  /category/
status: To Do
assignee: []
created_date: '2026-09-04 00:31'
updated_date: '2026-09-04 00:31'
labels:
  - theme
  - admin
milestone: m-5
dependencies:
  - TASK-14
  - TASK-35
references:
  - backlog/docs/doc-5 - Admin-UI.md
  - 'https://andrewshell.org/category/general/'
type: feature
ordinal: 26500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tag archives live at `/tags/{tag}/` today and WordPress puts them at `/tag/{tag}/`, with categories at `/category/{slug}/`. Make both bases settings (`tagBase`, `categoryBase`) on the settings screen and in `site.json`, validated as one URL-safe path segment, defaulting to `tag` and `category` so a WordPress site keeps its URLs without touching anything. Every place that builds or parses a taxonomy URL reads the setting: the public routes and their canonical trailing-slash redirects, `tagHref` and its category twin, the theme templates, the editor links, the feed hrefs and the Article Hashtag hrefs. Since there are no production deployments, the old `/tags/` default is simply replaced; no redirect from it. The two bases may not be equal to each other, to `page`, or to a reserved top-level path such as `feed`, `admin` or `ap`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With no setting the tag archive answers at /tag/{tag}/ and the category archive at /category/{slug}/, and /tags/{tag}/ is a 404
- [ ] #2 Changing either base on the settings screen moves the archive, its paging and its feeds to the new base on the next request, and every link the theme, the editor and the feeds render follows
- [ ] #3 The bases are mirrored to site.json and read back from it on seed; an old site.json without them gets the defaults
- [ ] #4 A base that is empty, contains a slash, equals the other base, or names a reserved path is refused with a message and the previous value kept
- [ ] #5 The Article's Hashtag hrefs and the outbox point at the current bases
<!-- AC:END -->
