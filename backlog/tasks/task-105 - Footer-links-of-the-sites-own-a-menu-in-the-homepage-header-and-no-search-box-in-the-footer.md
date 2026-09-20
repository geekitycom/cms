---
id: TASK-105
title: >-
  The header carries the menu, the bio carries the person, the footer carries
  the site
status: To Do
assignee: []
created_date: '2026-09-20 12:05'
updated_date: '2026-09-20 12:18'
labels:
  - web
  - theme
dependencies: []
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/themes/default/partials/bio.njk
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/admin/settings-reading.ts
  - packages/cms/src/web/authors.ts
  - packages/cms/themes/default/README.md
type: feature
ordinal: 130800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three things sit around a page in the default theme — the menu, a person's profile links, and the site's own links — and each of them is currently in the wrong place, or in more than one place.

**The menu moves into the header, on every page.** Today it is inside the bio on an entry and an author archive, and in the footer everywhere else, so where a reader looks for it depends on what they are reading. It goes in `<header class="global-header">`:

- At the root, where the header is the site title as an `h1` and the tagline under it, the menu is a line of its own under the tagline.
- Everywhere else, where the header is the small `header-link-home` link, the menu sits beside it on the same line.

**The bio carries the person, and only the person.** `partials/bio.njk` stops printing the menu and keeps what it should have been about all along: the profile of whoever the page is by — their name, their note and their `rel="me"` links. It shows at the top of that person's author archive and under each of their posts, so a reader who has just read somebody finds that person's links right there.

**The footer carries the site.** The footer builds its list from `siteAuthor`, the one account Settings > General names as the author, so on a site with more than one user it prints somebody's personal links as the site's, and nobody else's appear at all. Add a **Footer links** box to Settings > Reading beside Navigation, the same `Label | /url` syntax, with a third field marking a link as `rel="me"`:

    RSS | /feed/
    GitHub | https://github.com/andrewshell | me
    Mastodon | https://shll.me/@a | me

The marker matters: `rel="me"` on a link back to a profile is what Mastodon reads to verify it, so a box that could not emit it would quietly break verification for anybody moving their links into it. RSS is a line like any other, so a site that does not want it drops it. The footer prints that box and nothing derived from any account, on every page.

**The search box leaves the footer.** Search becomes a line in the Navigation box (`Search | /search/`), which already works, so it is a menu item like any other. The search page keeps its own box at the top.

shll.me is the only live site, so none of this needs a fallback: the behaviour being replaced goes away rather than becoming a default. The starter site carries the lines a new site needs instead — RSS in Footer links, and the Navigation lines TASK-104 adds.

All of this is the packaged default theme, which a site theme may override, so the theme README's sections on the header, the bio, the menu, the footer and the search form have to match what the theme now does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Settings > Reading has a Footer links box taking Label | url and an optional me marker, saved to site.json, proven by a test
- [ ] #2 A footer link marked me renders with rel="me" and an unmarked one does not, proven by a test
- [ ] #3 The footer prints exactly the links in the box, on every page, and nothing derived from any account, proven by a test
- [ ] #4 An empty box prints no footer list at all, and the footer keeps its copyright line, proven by a test
- [ ] #5 The starter site ships a Footer links box holding RSS, so a new site has a footer without being told to fill one in
- [ ] #6 The menu is in the global header on every page: under the tagline at the root, beside the home link everywhere else, proven by a test for each
- [ ] #7 No page carries the menu twice, and no page carries it outside the header, proven by a test that counts it across a post, a listing, an author archive and a 404
- [ ] #8 The bio prints the profile links of whoever the page is by, with rel="me", at the top of their author archive and under each of their posts, and carries no menu, proven by a test
- [ ] #9 No page but the search page carries a search form, proven by a test
- [ ] #10 The theme README describes the header menu, what the bio prints, the footer links and that the footer has no search form
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope settled on 2026-09-20: shll.me is the only live site, so there is no upgrade path to protect. The earlier plan kept today's footer — RSS plus the site author's profile links — whenever the Footer links box was empty, so that no existing site lost its footer by upgrading. That hedge is dropped. The footer prints the box and nothing else; empty means no list.

The behaviour it replaces is therefore going away rather than becoming a fallback, so the existing footer tests that assert RSS and the site author's rel="me" links in the footer are expected to change. That is the one place in this task where an existing assertion should be edited rather than preserved, and the notes should say which tests moved and why.

The starter site carries the links a new site needs instead: an RSS line in Footer links, and the Navigation lines TASK-104 is already adding.

Arrangement revised on 2026-09-20 before any code was written. The earlier plan put the menu in the header at the root only, leaving it in the bio on an entry and in the footer elsewhere — three places, which is what prompted the rethink. It is now in the header on every page, which also means the bio stops being two things at once: it carries the person, their note and their rel="me" links, and nothing about the site's navigation.

The result is one home for each kind of link. The header has the menu, the bio has the person whose page or post it is, the footer has the site's own links on every page.

The menu's items come from the navigation setting alone once TASK-106 lands; this task is the theme side and does not care where they come from. Default arrangement the maintainer asked for: Search in the menu, RSS in the footer, About in the menu.
<!-- SECTION:NOTES:END -->
