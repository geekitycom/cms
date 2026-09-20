---
id: TASK-109
title: 'Federation''s settings live under Federation, not under Settings'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 12:36'
updated_date: '2026-09-20 16:00'
labels:
  - admin
  - federation
milestone: m-16
dependencies: []
references:
  - packages/cms/src/admin/settings-federation.ts
  - packages/cms/src/admin/menu.ts
  - packages/cms/src/admin/settings-page.ts
  - packages/cms/src/admin/settings-pages.ts
  - packages/cms/src/admin/federation.ts
  - packages/cms/admin/pages/federation/settings.njk
type: task
ordinal: 134800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin has two menu entries called Federation. One is the top-level section, holding Followers. The other is a child of Settings, holding the relays a site follows and the WordPress ActivityPub compatibility switch. Neither says the other exists, and a person looking for relays has no reason to prefer one over the other.

Move the settings page under the section it belongs to, so Federation holds everything about federation: its followers, its relays and its compatibility switch.

The move is mostly a path and a menu entry. `SettingsPage.path` is a free string and `settingsPagePath()` is only a helper for the Settings children, so the page can live under `/admin/federation/` and keep the whole settings-page abstraction — its fields, its save, its endpoints and its refusals — without a rewrite. The template moves with it, into `pages/federation/` beside the followers screen (TASK-99's tree).

Decide and write down which child the section lands on, because a menu heading goes to its first child: Followers is what somebody opens the section to look at, and the settings are what they open it to change.

The old URL should redirect rather than 404: it is in the README, and it is where a bookmark points.

Worth checking while in there: whether any other Settings child is really a section's own screen wearing the Settings label. Discussion and Email are site-wide; Reading is about to lose its Navigation box to TASK-108, which is the same shape of problem — a screen filed where the fixed menu had room rather than where its subject lives.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Federation's relays and the WordPress compatibility switch are reached from the Federation section, and Settings no longer lists Federation, proven by a test
- [x] #2 The page keeps the settings-page machinery: its fields save, its refusals stand, and its panels work, proven by the existing settings-federation tests passing with only their paths changed
- [x] #3 The section's first child is a deliberate choice, named in the implementation notes with the reason
- [x] #4 The old /admin/settings/federation redirects to the new URL rather than answering 404, proven by a test
- [x] #5 The README, the admin doc and any other prose naming the old path are updated
- [x] #6 Any other Settings child that is really a section's own screen is named in the implementation notes, moved or with a reason not to
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. A settings page learns which section files it. `SettingsPage` gains an optional `section` (default 'settings') and an optional `heading` (default `label`, so the h1, the title and the saved flash stay 'Federation ...' while the menu calls the page 'Settings'). `settingsScreen` renders those instead of the hard-coded 'settings'.
2. Move the page: `FEDERATION_SETTINGS` becomes section 'federation', child 'settings', label 'Settings', heading 'Federation', path `FEDERATION_SETTINGS_PATH = /admin/federation/settings` (exported from `federation.ts` beside `FEDERATION_PATH`, so no module has to build the section's URL twice).
3. Menu: drop the `federation` child from Settings; give the Federation section a second child, Settings, after Followers — the heading still lands on Followers, which is what somebody opens Federation to look at.
4. `settings-pages.ts`: `SETTINGS_PAGES` is the five children of Settings; a new `ALL_SETTINGS_PAGES` adds the Federation page, and `mountSettings` mounts all of them, so the 'every field is on exactly one page' invariant still has a list to check.
5. Redirect: the page's own `endpoints` registers a 301 from `/admin/settings/federation` to the new URL — it is in the README and it is where a bookmark points.
6. Template moves with the page: `git mv admin/pages/settings/federation.njk admin/pages/federation/settings.njk`, and `ADMIN_TEMPLATES.settingsFederation` becomes `federationSettings`.
7. Tests, one slice at a time: the Settings children are five and no longer include Federation; Federation reads Followers then Settings and lands on Followers; the relay and WordPress tests pass with only their paths changed; the old URL 301s to the new one. `routes.test.ts` walks ADMIN_SECTIONS unedited and is the proof a 200 sits behind the moved child.
8. Prose: packages/cms/README.md, doc-5's menu table and screen list, doc-4's three mentions of Settings > Federation, and the template's own header comment.
9. Sweep the other Settings children for the same shape of problem and write what it found in the notes (AC #6).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Settled by the maintainer on 2026-09-20: the child is labelled Settings, not General, and it is second. The section lands on Followers, which is what somebody opens Federation to look at; the settings are what they open it to change, and that is the rarer errand.

So the section reads Federation > Followers, Federation > Settings, and the new path follows that label.

## What moved

Federation's settings page is `/admin/federation/settings`, the second child of the Federation section. The section now reads **Federation > Followers**, **Federation > Settings**, and the heading still lands on Followers — the decision on this task, and the reason for it stands in the code: Followers is what somebody opens the section to look at, the settings are what they open it to change, and that is the rarer errand (AC #3). Settings lists five children and no Federation.

The template moved with it, `git mv admin/pages/settings/federation.njk` -> `admin/pages/federation/settings.njk`, beside the followers screen (TASK-99's tree), and `ADMIN_TEMPLATES.settingsFederation` became `federationSettings`.

## The seam it needed

A settings page could only be a child of Settings, because `settingsScreen` wrote `section: 'settings'` itself. `SettingsPage` now carries two optional fields:

- `section`, defaulting to `'settings'`, which is what the screen tells the menu.
- `heading`, defaulting to `label`, which is what the page is headed and what the flash calls it. The Federation page is labelled **Settings** in the menu and headed **Federation**, so the h1, the `<title>` and the flash read exactly as they did before — 'Federation settings saved.' rather than 'Settings settings saved.'

Nothing else about the page changed: the same fields, the same save, the same 400-with-problems, the same relay reconciliation and the same WordPress panel. `settings-pages.ts` now holds two lists — `SETTINGS_PAGES`, which the Settings menu has to agree with, and `ALL_SETTINGS_PAGES`, which `mountSettings` registers and which the 'every setting is on exactly one page' test is checked against.

The old URL is a 301 to the new one, registered from the page's own `endpoints` hook, which is where a page's extra routes already live (AC #4).

## The sweep of the other Settings children (AC #6)

Nothing else is a section's own screen wearing the Settings label, so nothing else moved. Named, with the reason each stays:

- **Discussion** is the closest thing to the same shape, and the one a later task could reasonably take: a Comments > Settings would mirror Federation > Settings exactly. It stays because its fields are wider than the Comments screen — webmentions the site *sends* are about its own posts going out, not about anything on that screen — and because the spam checker and the closing window are site policy rather than a view of what is in the comment list. Worth revisiting if Comments ever grows a second child.
- **Permalinks** carries the tag and category bases, and the archive redirects the taxonomy screens recorded, so it reads like a Posts > Terms screen at first. It stays: it is the shape of the site's URLs, and the section it would land in is Posts, whose children are lists of documents rather than terms — the two bases would be filed under a heading about posts while one of them is for categories.
- **Reading** picks the homepage and the posts page out of the site's pages, which is not the Pages section's business either: it is what a visitor is shown at `/`, and the Pages list already marks the two rows Front Page and Posts Page. It stays. (It lost its Menu box to TASK-108, which was this same problem.)
- **General** and **Email** are site-wide by construction — what the site is called and where it lives, and how it sends mail at all. Neither belongs to a section. `contactEmail` on Email is the nearest edge, but the credential beside it serves notifications and password recovery too, so the page is not the Messages screen's.

Two earlier moves are the same argument and are already done: the theme went to Appearance (decision-15) and the menus to Navigation (TASK-108).

## Prose

packages/cms/README.md (five path mentions, the route table row moved beside the other `/admin/federation` routes, and the Settings section now says five pages plus the sixth filed under Federation), doc-5 (the menu table, the screens table, the Settings section, the code seam) and doc-4 (the three Settings > Federation mentions, plus a pointer to where the relay list is edited). Two stale lines from TASK-108 were fixed in passing, both on sentences this task was rewriting anyway: the package README said eleven sections and left Navigation out of the list, and doc-5 still gave Reading a site menu.

## Verification

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all clean. `pnpm test`: 2102 + 30 pass, 0 fail. `pnpm test:11ty`: 16 + 5 pass.
- `src/admin/routes.test.ts` is unedited and walks `ADMIN_SECTIONS` demanding a 200 behind every child that marks itself, so it is the proof the moved screen is a real screen in its new place.
- Over real HTTP, against a throwaway site on :4177 (signed in through /admin/setup, server stopped afterwards):
  - `GET /admin/settings/federation` -> `301`, `location: /admin/federation/settings`.
  - `GET /admin/federation/settings` -> `200`, `<h1>Federation</h1>`, `<title>Federation settings</title>`, the menu showing Federation > Followers and Settings with `aria-current="page"` on Settings, and no link anywhere to the old URL.
  - `GET /admin/settings` -> the Settings section lists General, Reading, Permalinks, Discussion, Email and nothing else.
  - A save of relays + the WordPress switch -> `303`, flash 'Federation settings saved. A follow has been sent to one new relay; the Followers screen says where each stands.', and `content/_data/site.json` holding `relays` and `wordpressActivityPub: true`.
  - A save of `relays=not-a-url` -> `400`, the problem on the field, and the form that came back posting to `/admin/federation/settings`.
  - The WordPress panel rendered its 'No user carries a WordPress actor id' case.

## Tests changed, and why

- `settings-federation.test.ts`: every path is the new one (AC #2 — only the paths changed), plus a new suite for where the page lives: the Federation section's two children in order, the screen marking itself under Federation, and the 301 from the old URL.
- `settings-pages.test.ts`: the Settings children are five and no longer include Federation, and the two walks that mean 'every settings page' now use `ALL_SETTINGS_PAGES` so the relay and WordPress fields are still covered by 'each on exactly one page'.
- `__testing__/settings.ts`: `settingsPageUrl` looks in `ALL_SETTINGS_PAGES` and keys a page by its section when it has one, so a test still asks for 'federation'.

## Breaking

`ADMIN_TEMPLATES.settingsFederation` is now `ADMIN_TEMPLATES.federationSettings`, `SETTINGS_PAGES` no longer contains the Federation page (`ALL_SETTINGS_PAGES` does), and `/admin/settings/federation` is a redirect rather than a screen. Commit type: `feat(cms)!`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Federation's settings are Federation > Settings at /admin/federation/settings, the second child of the section, which still lands on Followers; Settings lists five children and no Federation. The page kept the whole settings-page machinery — a SettingsPage now names the section that files it and, where the menu label is not the page's name, the heading it is written under, so the fields, the save, the refusals, the relay reconciliation and the WordPress panel are untouched and the flash still reads 'Federation settings saved.' The template moved to admin/pages/federation/settings.njk, /admin/settings/federation answers a 301 to the new URL, and the README, doc-5 and doc-4 say the new place. Verified by the full suite (2102 + 30 + 16 + 5 passing, with routes.test.ts unedited and still demanding a 200 behind every menu child) and over real HTTP: the 301 from the old URL, a 200 on the new one marking itself under Federation, a save that wrote relays and the WordPress switch to site.json with the right flash, and a refused save returning 400 on the new URL.
<!-- SECTION:FINAL_SUMMARY:END -->
