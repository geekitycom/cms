---
id: TASK-72
title: >-
  Admin submenus: every section has children, the current section expands, and
  the landing child is marked
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:58'
updated_date: '2026-09-13 02:24'
labels:
  - admin
  - theme
milestone: m-12
dependencies: []
references:
  - packages/cms/src/admin/routes.ts
  - packages/cms/admin/layouts/shell.njk
  - packages/cms/admin/static/admin.css
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 99600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin navigation is a flat list of eleven sections (ADMIN_SECTIONS in admin/routes.ts), with tags and categories at the top level and settings, users and federation each hiding several screens behind one link. Model the menu on WordPress classic: a section is a heading with one or more children, clicking the heading opens it and lands on its first child, the open section shows its children, and the child you are on is marked as current, so clicking Users shows you are on Users > All users. Every section has at least one child even when it has one screen, because that is what makes the rule uniform and lets a second child appear later without changing the shape. The grouping to start from, following WordPress where the CMS has the same thing: Dashboard (Home); Posts (All posts, Add new, Categories, Tags); Pages (All pages, Add new); Media (Library); Comments (All comments); Messages (All messages); Users (All users, Add new); Settings (whatever TASK-73 splits it into, General alone until then); Federation (Followers). A screen names its section and its child rather than only its section, and the sections registry carries the children, so a later screen adds one line. Keyboard and assistive access: the open section is a real list, the current child carries aria-current, and the menu works without JavaScript, with JavaScript only adding the open and close affordance if one is wanted at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every top-level section in the admin has at least one child; clicking a section lands on its first child with the section open and that child marked current
- [x] #2 Tags and categories live under Posts, Add new under Posts, Pages and Users, and the top level reads Dashboard, Posts, Pages, Media, Comments, Messages, Users, Settings, Federation
- [x] #3 A screen declares its section and child in one place and the registry renders the whole menu; adding a child is one entry and a test proves an unknown child is refused
- [x] #4 The current child carries aria-current, the menu is usable with no JavaScript, and a screenshot of the demo admin on a narrow and a wide viewport looks right
- [x] #5 doc-5 describes the menu and its rule; the admin README or the theme README documents how a site's own screen joins it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New module packages/cms/src/admin/menu.ts holding the registry: AdminMenuChild {child,label,url}, AdminSection {section,label,url,children}, ADMIN_SECTIONS built so a section's url is its first child's url, and adminMenu({section,child}) returning the whole menu with the named section open and the named child current. An unknown section or an unknown child throws UnknownAdminScreenError, so a screen that names a child the registry does not have cannot ship.
2. Registry order and grouping: Dashboard (Home), Posts (All posts, Add new, Categories, Tags), Pages (All pages, Add new), Media (Library), Comments (All comments), Messages (All messages), Users (All users, Add new), Settings (General), Federation (Followers). routes.ts re-exports ADMIN_SECTIONS so the package's public export keeps working.
3. Every screen names its child beside its section: the listings 'all', the new-document editors 'new', the existing-document editor 'all', tags and categories move to section 'posts' with children 'tags'/'categories', media 'library', settings 'general', federation 'followers'. recovery's unused section names go, since those screens are outside the shell.
4. Users gets the Add new screen the menu now points at: GET /admin/users/new renders the add form alone, POST /admin/users/new adds the user, refusing back onto that page and redirecting to /admin/users on success. The list keeps the table, the email and notification rows and the change-password form.
5. render() in routes.ts computes the menu once and hands the shell 'navigation'; shell.njk renders a section heading plus, for the open section only, a real nested <ul> of its children, the current child carrying aria-current='page'. No JavaScript at all.
6. admin.css styles the open section and its children, and a narrow-viewport rule stacks the nav above the screen instead of squeezing an 11rem column.
7. Tests, red first: menu.test.ts for the registry and the refusal; routes.test.ts for the rendered menu (every section has at least one child, a section link goes to its first child, the landing child carries aria-current); users.test.ts for the Add new screen.
8. Docs: doc-5 gets the menu and its rule, README's admin route table gets /admin/users/new and a paragraph on how a site's own screen joins the menu.
9. Verify: pnpm build, test, typecheck, lint, format:check, plus screenshots of the demo admin at a narrow and a wide viewport.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on branch m13-admin-menu.

What changed:
- New packages/cms/src/admin/menu.ts: the whole menu as one registry. AdminSection {section,label,url,children}, AdminMenuChild {child,label,url}, ADMIN_SECTIONS built by a helper that takes a section's url from its first child so the two can never disagree, and adminMenu({section,child}) returning every section with open/current flags. An unknown section, an unknown child, or a section named with no child throws UnknownAdminScreenError. ADMIN_SECTIONS moved out of routes.ts; admin/index.ts now re-exports it (plus adminMenu and the new types) from menu.ts, so the package's public export path is unchanged.
- routes.ts: render() computes the menu from the section and child on the render context, so a screen still declares where it is in exactly one place. The dead placeholder loop and its 'built' set went — every menu URL has a real screen now.
- Every screen names its child: listings 'all', new-document editors 'new', the editor of an existing document 'all' (WordPress leaves the listing marked while you edit), conflict 'all', tags/categories move to section 'posts' with child 'tags'/'categories', media 'library', comments/messages 'all', users 'all'/'new', settings 'general', federation 'followers'. recovery.ts's unused section names ('forgot','reset') are gone: those screens are outside the shell.
- Users > Add new is a real screen: ADD_USER_PATH = /admin/users/new, GET renders the add form alone and POST adds the user, refusing back onto that page with a 400 and redirecting to /admin/users on success. One template, branching on 'adding'. The change-password form stays on the list.
- shell.njk renders a heading per section and, for the open section only, a nested <ul> of its children with aria-current on the one you are on. No script, no toggles.
- admin.css styles the open section and its children, and a max-width:45rem rule moves the menu above the screen and wraps it. While screenshotting the new Add new screen, input[type='email'] turned out never to have had the generic field rule the text and password inputs have, so it was added.
- styles.test.ts now covers shell.njk, so a class the menu emits has to be styled before it can land.
- doc-5 gained a 'The menu' section with the section/children table and the rule; the README's admin route table gained /admin/users/new and a 'The menu' subsection showing the two lines a site's own screen adds.

Verification: pnpm build, pnpm test (1467 + 14 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all pass. The demo admin was driven in a browser at a wide viewport and, through a 400px same-origin iframe, at a narrow one: Posts open with All posts / Add new / Categories / Tags and Tags marked; Users open with All users / Add new; Settings open on General. The dev server was stopped and the temporary demo admin deleted; nothing is left on port 3000.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Modelled the admin menu on WordPress classic: nine sections — Dashboard, Posts, Pages, Media, Comments, Messages, Users, Settings, Federation — each a heading over one or more children, the heading landing on its first child, the open section showing its children and the child you are on carrying aria-current. Tags and categories moved under Posts, Add new sits under Posts, Pages and Users, and Users > Add new became a screen of its own at /admin/users/new. The menu is one registry, src/admin/menu.ts: a screen names its section and its child, the registry renders the list, and a pair it does not hold throws UnknownAdminScreenError rather than drawing a menu expanded around nothing, so adding a screen later is one entry and the same name. No JavaScript is involved. Verified by menu.test.ts (the registry, the marking and the refusal), routes.test.ts (every section lands on its first child with that child marked, every child is a screen that marks itself, the closed sections keep their children, the menu is links and lists), the updated dashboard, media and users tests, and by driving the demo admin in a browser at a wide viewport and at 400px.
<!-- SECTION:FINAL_SUMMARY:END -->
