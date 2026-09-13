---
id: TASK-73
title: >-
  Settings pages: split the settings screen into General, Reading, Permalinks,
  Discussion, Email and Federation under the Settings menu
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:58'
updated_date: '2026-09-13 02:51'
labels:
  - admin
milestone: m-12
dependencies:
  - TASK-72
references:
  - packages/cms/src/admin/settings.ts
  - packages/cms/admin/layouts/settings.njk
  - packages/cms/src/admin/settings.test.ts
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 99700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The settings screen is one form with twelve headings (Site, Navigation, Archives, Comments, Webmentions, Federation, Notifications, Email, Mail credentials, Spam checking, Avatar) and five POST routes, and it grows with every milestone. Split it into pages under the Settings menu from TASK-72, each its own screen with its own form, its own POST and its own tests, all writing site.json through the same updateSiteSettings path so two pages saved at once cannot lose each other and unknown keys survive. The grouping to start from, following WordPress's names where the CMS has the same thing: General (title, tagline, base URL, timezone, language, author, avatar while the site actor exists); Reading (posts per page, navigation, notify server); Permalinks (tag base, category base, the recorded archive redirects); Discussion (comments on or off and the close-after days, webmentions send and receive, spam checking with the Akismet key, the notification digest note); Email (provider, from name and address, reply-to, contact address, the Brevo and SMTP credentials, send test); Federation (actor handle and type while they exist, relays). The validator is split so a page validates only its fields and a refused save re-renders that page with its problems; base URL keeps its read-only rule; the side effects stay where the field is (updating the actor on a profile change, syncing relays after a relay save). Fields M12 later removes are simply removed from their page then. The old single form goes; the settings URL becomes the General page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Settings has six children, General, Reading, Permalinks, Discussion, Email and Federation, each a page with its own form and POST, and /admin/settings is the General page
- [x] #2 Every field the old screen had appears on exactly one page, saving one page changes only its fields, and two pages saved concurrently both land in site.json with unknown keys preserved; a test proves the concurrent case
- [x] #3 A refused save re-renders the page it came from with its problems and writes nothing; the base URL read-only rule and the actor update and relay sync side effects behave as before, proved by the existing settings tests moved to the page they belong to
- [x] #4 The avatar, Akismet and mail credential forms keep their separate POST routes so a bad credential cannot lose an edit to the title, now on their pages
- [x] #5 doc-5 and the package README's admin route table list the pages; settings.ts is split so no one module carries every page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Menu: give the settings section six children — general, reading, permalinks, discussion, email, federation — General first, since the section heading lands on its first child and /admin/settings is General.
2. Machinery: a new settings-page.ts holds what every page shares — a SettingsPage descriptor (child, label, path, template, the SettingsField names it owns, optional panels and after-save effects), and one mount that wires GET and POST for it. The POST overlays only the page's own fields onto the settings re-read inside the atomic write, so two pages saved at once keep each other's work.
3. Validator: settingsProblems becomes a per-field check table and takes the fields to run, so a page validates only what it carries. The two archive bases stay a pair because their rules are about the pair.
4. Six page modules — settings-general.ts (title, tagline, base URL, timezone, language, author, and the avatar's POST), settings-reading.ts (posts per page, menu, notify server), settings-permalinks.ts (tag base, category base, the recorded archive redirects), settings-discussion.ts (comments, closing window, webmentions, and the Akismet POST), settings-email.ts (provider, from, reply-to, contact address, and the mail credential and test POSTs), settings-federation.ts (actor handle and type, relays) — plus one template each under admin/layouts/settings/, extending a shared page template.
5. settings.ts keeps the model alone: SiteSettings, the file's reader and writer, updateSiteSettings, the migration, the panels. mountSettings moves to settings-pages.ts, which is the list of pages and nothing else.
6. Split settings.test.ts the same way: the model and the cross-page facts stay, each page's tests move to its own file, and akismet.test.ts, mail.test.ts, relays.test.ts and delivery.test.ts follow the routes to their new pages.
7. doc-5 and the package README's route table list the six pages.
8. pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Split the one settings screen into six pages under Settings.

What is where now. `src/admin/settings.ts` is the settings themselves and nothing about a screen: the model, `site.json`'s reader and writer, `updateSiteSettings`, the legacy-rows migration, and a validator that is now a per-field check table `settingsProblems(form, fields)` runs for the fields a page names. `settings-page.ts` is what every page is made of — a `SettingsPage` describing itself (child, label, path, template, its fields, optional panels, reads, saved and endpoints) and `mountSettingsPage`, which is the only place a GET and a POST are wired. `settings-pages.ts` is the list of six and the mount. Each page is its own module — settings-general, -reading, -permalinks, -discussion, -email, -federation — beside its own template under `admin/layouts/settings/`, all extending `settings/page.njk`.

The save. A page's POST reads its own fields off the body and every other field off the settings as re-read inside the atomic write, so it writes only what it carries and the second of two concurrent saves is applied to what the first one actually wrote. Checkboxes fall out of that for free: a clear box submits nothing, and only the page's own boxes are read off the body.

Side effects moved to the field. General tells the followers when the title, tagline or avatar changed; Federation tells them about the handle or type and reconciles the relays; the avatar POST is on General, the Akismet POST on Discussion, and the mail credential and test POSTs on Email, each redirecting to its own page.

Tests moved with the fields: settings.test.ts keeps the file and the migration, and settings-general/-reading/-permalinks/-email/-federation.test.ts hold what each page owns. settings-pages.test.ts is the cross-page contract (the six children, every field on exactly one page, one page's save touching only its fields, two pages saved at once, a refusal coming back on its own page). settings-discussion.test.ts is new, because the checkboxes had no test before. akismet.test.ts, mail.test.ts and federation/relays.test.ts follow the routes to their new pages, and `__testing__/settings.ts` is the shared per-page save helper.

Validation: pnpm build, pnpm test (1477 + 14 pass), pnpm typecheck, pnpm lint and pnpm format:check all pass. The Permalinks page was also rendered and read by hand to check the menu marks the child it is on and the recorded-renames table draws.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Settings is six pages now — General, Reading, Permalinks, Discussion, Email and Federation — each its own form, its own POST and its own tests, with /admin/settings the General page. Each page writes only the fields it carries, onto content/_data/site.json as re-read inside the atomic write, so two pages saved at once both land and keys the settings do not model survive; each validates only its own fields, and a refusal comes back on the page it was sent from having written nothing. The avatar, the Akismet key and the mail credential keep their own POST routes, on General, Discussion and Email. settings.ts is the settings alone; settings-page.ts is what a page is made of, settings-pages.ts is the list, and each page is its own module and template. Verified by pnpm build, pnpm test (1477 + 14 pass, including the new settings-pages, settings-discussion and five moved per-page suites), pnpm typecheck, pnpm lint and pnpm format:check, and by reading a rendered page.
<!-- SECTION:FINAL_SUMMARY:END -->
