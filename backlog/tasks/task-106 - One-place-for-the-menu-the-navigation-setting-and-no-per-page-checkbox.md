---
id: TASK-106
title: 'One place for the menu: the navigation setting, and no per-page checkbox'
status: To Do
assignee: []
created_date: '2026-09-20 12:18'
labels:
  - web
  - admin
dependencies: []
references:
  - packages/cms/src/web/navigation.ts
  - packages/cms/src/admin/documents.ts
  - packages/cms/admin/pages/documents/editor.njk
  - packages/cms/src/index.ts
  - packages/cms/src/web/index.ts
type: feature
ordinal: 131800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The menu comes from two places that cannot see each other. `navigationMenu` (web/navigation.ts) concatenates the lines typed into the `navigation` setting with every page whose front matter says `navigation: true`, which the page editor offers as a checkbox and an order number.

The two sources cannot be reconciled by anybody using them:

- A checked page can never sit between two typed lines. The comment at navigation.ts:62 says so outright: pages 'come after the items the setting names', so a page opting in appends itself.
- Ordering works differently in each. Typed lines keep the order they were typed; checked pages sort by `navigationOrder` and then by title, with pages naming no order last.
- Nothing dedupes. A page both typed into the setting and ticked in its editor appears in the menu twice, and neither screen says the other exists.

Keep the setting and drop the checkbox. The `navigation` box in Settings > Reading becomes the whole menu: what it says, in the order it says it, and nothing else. One screen, one order, no duplicates.

What goes:
- `navigation` and `navigationOrder` as front matter, and `NAVIGATION_KEY`, `NAVIGATION_ORDER_KEY`, `navigationPages` and `navigationOrder` in web/navigation.ts.
- The checkbox and the order box in the page editor, and the two fields the editor writes in admin/documents.ts.
- The `homepage` rewriting inside `navigationPages`, which existed so a page serving as the front page was linked at `/` rather than at the permalink that redirects there. With a typed menu that is the admin's business: they type `Home | /`.

What stays: `navigationMenu`, which becomes the setting's items with `current` marked, and everything about how a line is parsed and refused.

shll.me is the only live site and it uses no checkbox, so nothing needs migrating. A page that still carries `navigation: true` in its front matter simply stops meaning anything, which is worth a line in the release notes rather than a migration.

Coordinate with TASK-104, which was going to put `navigation: true` on the starter About page: with this in, the starter site types About into the setting instead. TASK-105 is the theme side and does not care where the items come from.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The menu is exactly the navigation setting's items, in the order the setting gives them, proven by a test
- [ ] #2 A page carrying navigation: true in its front matter is not in the menu, proven by a test
- [ ] #3 The page editor offers no navigation checkbox or order box, and saving a page writes neither key, proven by a test
- [ ] #4 navigationPages, navigationOrder, NAVIGATION_KEY and NAVIGATION_ORDER_KEY are gone from the package's exports and from the codebase
- [ ] #5 A page served as the front page is reachable from the menu by typing Home | /, and the README says so where it described the checkbox
- [ ] #6 The starter site types its About line into the setting rather than ticking a box
<!-- AC:END -->
