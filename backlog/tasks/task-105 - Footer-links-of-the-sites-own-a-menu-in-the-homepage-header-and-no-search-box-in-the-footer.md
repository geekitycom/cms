---
id: TASK-105
title: >-
  Footer links of the site's own, a menu in the homepage header, and no search
  box in the footer
status: To Do
assignee: []
created_date: '2026-09-20 12:05'
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
Three changes to what the default theme puts around a page, and one new setting behind them.

**Footer links, belonging to the site rather than to one user.** The footer builds its list from `siteAuthor` — the account Settings > General names as the author — so it prints RSS and that one person's profile links. On a site with more than one user that is somebody's personal list presented as the site's, and every other user's links appear nowhere in it. Profile links already have a proper home: `partials/bio.njk` prints each person's own `rel="me"` links on their author archive, and that stays as it is.

Add a **Footer links** box to Settings > Reading beside Navigation, the same `Label | /url` syntax, with a third field marking a link as `rel="me"`:

    RSS | /feed/
    GitHub | https://github.com/andrewshell | me
    Mastodon | https://shll.me/@a | me

The marker matters: `rel="me"` on a link back to a profile is what Mastodon reads to verify it, so a box that could not emit it would quietly break verification for anybody who moves their links into it. RSS is a line like any other, so a site that does not want it can drop it.

An empty box keeps today's footer, RSS and the site author's links, so no existing site loses its footer by upgrading. A box with anything in it is the whole footer list.

**The menu in the homepage header.** Today the menu is inside the bio on an entry and an author archive, and in the footer everywhere else. At the root it moves into `<header class="global-header">` under the site title, where a reader arriving at the site looks for it. Everywhere else is unchanged: the bio still carries it where there is a bio, the footer where there is not. The menu is still on every page exactly once.

**No search box in the footer.** `partials/search-form.njk` comes out of the footer. Search does not disappear: it is a line in the Navigation box (`Search | /search/`), which already works, so it becomes a menu item like any other. The search page keeps its own box at the top. The starter site's navigation should carry the Search line so a new site still has a way to search, which is TASK-104 territory — coordinate rather than duplicate.

Everything here is the packaged default theme, which a site theme may override, so the theme README's sections on the footer, the menu and the search form need to match what the theme now does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Settings > Reading has a Footer links box taking Label | url and an optional me marker, saved to site.json, proven by a test
- [ ] #2 A link marked me renders with rel="me" and an unmarked one does not, proven by a test
- [ ] #3 With the box filled, the footer prints exactly those links and no longer reads the site author's profile, proven by a test
- [ ] #4 With the box empty, the footer is what it is today, proven by the existing footer tests passing unedited
- [ ] #5 At the root the menu renders inside the global header and not in the footer, proven by a test
- [ ] #6 On an entry the menu is still in the bio, and on a listing or a 404 still in the footer, so it appears exactly once on every page, proven by a test
- [ ] #7 No page but the search page carries a search form, proven by a test
- [ ] #8 The theme README describes the footer links, where the menu renders, and that the footer has no search form
<!-- AC:END -->
