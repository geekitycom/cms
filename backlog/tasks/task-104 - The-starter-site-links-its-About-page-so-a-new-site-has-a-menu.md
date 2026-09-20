---
id: TASK-104
title: 'The starter site links its About page, so a new site has a menu'
status: To Do
assignee: []
created_date: '2026-09-20 11:54'
labels:
  - web
  - content
dependencies: []
references:
  - packages/cms/templates/site/content/pages/about.md
  - packages/cms/templates/site/content/_data/site.json
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/init.ts
type: bug
ordinal: 129800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A new site gets one page, About, and nothing links to it. `templates/site/content/pages/about.md` carries only `title` and `permalink`, and a page joins the menu only by setting `navigation: true` in its front matter or by being listed in `navigation` in `site.json` — so the page is served at /about/ and is reachable only by somebody who already knows it is there.

Found on a real install: the About page on a site seeded by the Docker image is invisible from the home page, and the reason took reading navigation.ts to work out.

It also means the menu itself never appears. The default theme draws `<nav class="site-nav">` only when there is something in it, so a new site shows no navigation at all, and somebody evaluating Geekity cannot tell whether it has menus.

The fix is one line of front matter in the starter About page. Worth doing on top: the page's own words are about where page files live, which is right for somebody reading the file on disk, and says nothing about the menu they are now in. A sentence saying how it got into the menu and how to take it out turns the starter page into the documentation of the feature it is demonstrating.

Check while there whether the starter post and site.json have the same shape of problem — something the starter ships that a new site cannot find.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A site seeded from the template draws a menu with About in it, proven by a test over a freshly seeded content directory
- [ ] #2 geekity init and the serve-time seeding both produce it, since they share one template
- [ ] #3 The About page says how it put itself in the menu and how to take it out
- [ ] #4 Any other starter file that ships unreachable is named in the implementation notes, fixed or with a reason not to
<!-- AC:END -->
