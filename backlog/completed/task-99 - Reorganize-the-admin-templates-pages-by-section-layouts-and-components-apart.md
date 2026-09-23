---
id: TASK-99
title: 'Reorganize the admin templates: pages by section, layouts and components apart'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 10:01'
updated_date: '2026-09-20 10:13'
labels:
  - admin
  - web
dependencies: []
references:
  - packages/cms/src/admin/templates.ts
  - packages/cms/src/admin/menu.ts
  - packages/cms/admin/layouts
  - packages/cms/src/admin/settings-page.ts
type: task
ordinal: 124800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every admin template sits in one flat `admin/layouts/` directory, except the six settings pages, which have their own folder and a shared `settings/page.njk`. That split is the one place where the filesystem says what the screen is, and it is the part that reads well. Everywhere else, `media.njk`, `comments.njk`, `users.njk` and `user.njk` sit beside `base.njk`, `shell.njk`, `_flash.njk` and `_fields.njk`, so a screen, the chrome it renders inside, and a macro it calls are all the same kind of thing as far as the directory is concerned.

Give the whole admin the shape the settings pages already have, in three siblings under `packages/cms/admin/`:

    pages/       one folder per menu section, a file per screen
    layouts/     the chrome a page extends: base, shell, the settings page shell
    components/  what a page imports or includes: the field macros, the flash

`pages/` follows ADMIN_SECTIONS (admin/menu.ts) — dashboard, documents, media, comments, messages, appearance, users, settings, federation — plus `account/` for the four screens that have no menu because nobody is signed in yet: login, setup, forgot and reset.

Posts, Pages, Categories and Tags are four menu entries over the same three templates, so they share one `pages/documents/` folder holding list, editor, conflict and taxonomy. That is the one place the tree does not mirror the menu, and it is deliberate: the alternative is two copies of a template or a re-export that exists only to make a directory look tidy. Say so in a comment where somebody looking for `pages/posts/` would land.

Splitting `users.njk` into `users/list.njk` and `users/new.njk` is part of this: it is two screens out of one template behind an `adding` flag, and the menu already calls them two things. `user.njk` becomes `users/edit.njk`.

This is a move, not a rewrite. Names in ADMIN_TEMPLATES, `{% extends %}`, `{% import %}` and `{% include %}` all change; rendered HTML does not. The loader root stays `PACKAGED_ADMIN_DIR`, so no theme can reach any of it, and `package.json` already ships `admin` whole.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/cms/admin holds pages, layouts and components, with no template left in the old flat layouts directory
- [x] #2 pages holds one folder per admin menu section, plus account for the signed-out screens, and every screen is at the path its menu entry would suggest
- [x] #3 users.njk is split into users/list.njk and users/new.njk, and user.njk becomes users/edit.njk, with the adding flag gone from the template
- [x] #4 ADMIN_TEMPLATES, every extends, import and include, and every test that names a template path, all point at the new paths, and nothing references the old ones
- [x] #5 The rendered HTML of every admin screen is unchanged, proven by the existing tests passing with no assertion edited
- [x] #6 A comment where pages/posts would be says why Posts, Pages, Categories and Tags share pages/documents
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Baseline: run the admin tests (pnpm --filter @geekity/cms test) and record the count, so every later run is compared against it.
2. Move the chrome and the shared bits first, updating every referrer in the same step: layouts/_fields.njk -> components/fields.njk, layouts/_flash.njk -> components/flash.njk, layouts/settings/page.njk -> layouts/settings-page.njk. base.njk and shell.njk stay put. Run the tests.
3. Move the screens section by section with git mv, one section per step, fixing that file's extends/import and its entry in ADMIN_TEMPLATES, then running the admin tests: dashboard/home, documents/{list,editor,conflict,taxonomy}, media/library, comments/all, messages/all, appearance/themes, settings/*.njk, federation/followers, account/{login,setup,forgot,reset}.
4. Split users.njk: git mv to pages/users/list.njk, keep the listing half verbatim and drop the adding branch; write pages/users/new.njk with the add-form half verbatim; git mv user.njk -> pages/users/edit.njk. Add ADMIN_TEMPLATES.usersList / usersNew (dropping .users), and have mountUsers pick the template: GET /admin/users -> list, GET+POST /admin/users/new -> new. The 'adding' flag and the 'child: new' stay in addScreen's context minus 'adding'.
5. Decide placeholder.njk's home and say why in a comment on the file.
6. Add the comment that says why Posts, Pages, Categories and Tags share pages/documents, where somebody looking for pages/posts would land.
7. Sweep: grep the whole repo (src, tests, README.md, packages/cms/README.md, docs) for the old paths; update the two test files that name template paths as strings (fields.test.ts, styles.test.ts) and theme-choice.test.ts's shadowing fixture, and any prose.
8. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, with the test count matching the baseline and no assertion edited.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**The tree.** `packages/cms/admin/` is now three siblings. `layouts/` keeps base.njk, shell.njk and the settings page shell, renamed `settings-page.njk` now that it has no folder to sit in. `components/` holds fields.njk and flash.njk, which lost their underscores: the folder says what they are. `pages/` holds dashboard/home, documents/{list,editor,conflict,taxonomy}, media/library, comments/all, messages/all, appearance/themes, users/{list,new,edit}, settings/{general,reading,permalinks,discussion,email,federation}, federation/followers and account/{login,setup,forgot,reset}. Every move was `git mv`, so history follows each file.

**placeholder.njk went to `pages/placeholder.njk`**, at the top of pages/ rather than in a section folder. It is a screen — it extends the shell and has a heading — so it is not chrome and not a component; but it is not any one section's screen either. It is whichever section has nothing built yet, headed by whatever the route hands it, so a section folder would be a lie about which one. The reason is in a comment on the file, kept inside `{% block content %}` where the old comment was, because moving it above `{% extends %}` changed the whitespace of the rendered page.

**users.njk was two screens.** `pages/users/list.njk` is the table and `pages/users/new.njk` is the add form, each with its own title block; the `adding` flag is gone from both templates and from `addScreen` in src/admin/users.ts, and `mountUsers` picks the template — usersList on GET /admin/users, usersNew on GET and on the refused POST of /admin/users/new. `user.njk` became `pages/users/edit.njk`. ADMIN_TEMPLATES.users and .user are now .usersList, .usersNew and .usersEdit, matching the settingsGeneral/settingsReading naming already there.

**Proof the HTML did not change.** Beyond the suite, both admin trees were rendered side by side: the old tree was extracted from HEAD with `git archive`, both loaded into the admin's own Nunjucks options (autoescape, trimBlocks, lstripBlocks, the date filter), and each of the 22 one-to-one templates rendered over one shared context. All 22 came out byte-identical. users.njk was compared the same way against list.njk and new.njk over three contexts — the listing, the add form with every field refused and filled, and the clean add form — and all three were byte-identical too. Two whitespace regressions were found this way and fixed before they landed: the blank line before `{% endblock %}` in users/list.njk, and the placeholder comment's own line.

**Non-template files changed:** src/admin/templates.ts (every path in ADMIN_TEMPLATES, the three renamed users keys, and doc comments describing the three siblings and the documents folder), src/admin/users.ts (the four render calls and addScreen), src/admin/fields.test.ts, src/admin/styles.test.ts and src/web/theme-choice.test.ts (template paths named as strings only — no assertion touched), README.md (the workspace layout block now names pages/, layouts/ and components/) and doc-5 via `backlog doc update` (the Settings seam sentence pointed at admin/layouts/settings/). Historical task files that mention the old paths were left alone: they are a record of what was true then.

**Validation:** pnpm build, pnpm test (2008 package + 30 demo, 0 failures — the same 2008 as before the first move), pnpm typecheck, pnpm lint and pnpm format:check all pass. `npm pack --dry-run` lists all 29 templates under admin/{pages,layouts,components}, and a script over the built dist confirms all 24 ADMIN_TEMPLATES paths exist on disk.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reshaped packages/cms/admin into pages/, layouts/ and components/: every screen moved with git mv into a folder named after its admin menu section (plus account/ for the four signed-out screens), base.njk and shell.njk stayed as the chrome, settings/page.njk became layouts/settings-page.njk, and _fields.njk and _flash.njk became components/fields.njk and components/flash.njk. users.njk was two screens behind an 'adding' flag: it is now users/list.njk and users/new.njk with the flag gone from the template and from addScreen, and mountUsers picks which to render; user.njk became users/edit.njk. ADMIN_TEMPLATES, every extends, import and include, and the three test files that name a template path as a string all point at the new paths. placeholder.njk sits at pages/placeholder.njk, outside any section folder, because it stands in for whichever section has nothing built yet. Comments in pages/documents/list.njk and on ADMIN_TEMPLATES say why Posts, Pages, Categories and Tags share pages/documents. Verified by rendering the old tree (git archive of HEAD) and the new one side by side over one shared context: all 22 one-to-one templates byte-identical, and users.njk byte-identical to list.njk and new.njk over three contexts; plus pnpm build, test (2008 package + 30 demo, the same 2008 as the baseline and no assertion edited), typecheck, lint and format:check all green, and npm pack --dry-run showing all 29 templates shipped.
<!-- SECTION:FINAL_SUMMARY:END -->
