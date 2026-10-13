---
id: TASK-272
title: 'List screens on the DaisyUI table, tabs, badge and pagination macros'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 04:09'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-270
  - TASK-269
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 231800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: every screen that is a table of rows is redrawn through the macros: Posts and Pages (documents/list.njk), Users, Categories and Tags (taxonomy.njk, with its inline rename field), Media library, Followers, Connected apps, App activity and the activity entry, and Syndication. Tables keep their captions (keyboard.test.ts reads them), filters become tabs, page links become pagination, statuses (draft, scheduled, trashed, pending, spam, failed, active, missing) become badges in semantic colours, and row actions stay one readable line. Wide tables scroll inside their wrapper rather than widening the page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each listed screen renders its rows through the table macro inside a horizontally scrolling wrapper, opens with its caption, and its test file passes
- [x] #2 Filters (all / published / drafts / trash, pending / approved / spam, inbox / spam) are DaisyUI tabs with the current one marked, and pagination is the pagination macro
- [x] #3 Every status a row can show is a badge in a semantic colour and never by colour alone: the word is still printed
- [x] #4 The taxonomy rename field, the media copy controls and the alt-text field work as before (their tests pass), and the screens carry no legacy admin-* class
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape first. One status vocabulary in daisyui/components/badge.njk: a status(name, label) macro over a STATUSES map (published, hidden, draft, scheduled, trashed, pending, approved, spam, accepted, rejected, failed, active, missing, decorative, described) resolved through the modifier filter, so an unknown status is a render error and the word is always the label. The modifier filter maps a name whose class is '' to no class, which is how a plain badge is a member of the set. The routes' filter lists ({name,label,url,current}) and activity tabs ({label,url,current,count}) are already tabs items; previousUrl/nextUrl/page/pages are already pagination arguments, so no route changes.
2. A child-process probe (src/admin/__testing__/list-probe.ts) seeds one site with every row state each list screen can show and prints each screen as the DaisyUI admin serves it; list-screens.test.ts asserts per screen: every table is the macro's (scroll wrapper, table class, sr-only caption first), filters are a tabs nav with one current tab, pagination is the join group, every status cell is a badge with its word, and no admin-* class outside the bar. Failing first, then each screen turns it green.
3. Convert one screen at a time under daisyui/pages/, running that screen's own test file under both admins before the next: documents/list (posts, pages), documents/taxonomy, users/list, users/apps, users/activity, users/activity-entry, media/library (with daisyui/static/copy.js selecting [data-copy] instead of .admin-copy-button), federation/followers, documents/syndication. Loosen test regexes that pin old markup to accept both admins; never weaken what they prove.
4. keyboard.test.ts: also read the caption of every {% call table(...) %}, since a converted page has no literal <table>. daisyui.test.ts: move the unconverted-screen check off Followers to a screen still unconverted.
5. Migrate the dashboard's Draft/Published badges onto status() so the map is the one place.
6. Verify: pnpm build, test, typecheck, lint, format:check; CDP over a sandbox site with the switch on at 1280 and 390, light and dark: table wrapper scrolls, tabs mark current, taxonomy rename, media copy and alt text. Update doc-5 Components with status().
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built under packages/cms/daisyui/: pages/documents/list.njk, taxonomy.njk, syndication.njk; pages/users/list.njk, apps.njk, activity.njk, activity-entry.njk; pages/media/library.njk; pages/federation/followers.njk; components/copy.njk (copyField: readonly box joined to a hidden Copy button); static/copy.js (selects button[data-copy] instead of .admin-copy-button, otherwise the old file). The old admin's files are untouched. users/edit.njk and users/new.njk are form screens and were not converted.

Data shape: status(name, label) in components/badge.njk is the one status map (published/approved/accepted/described/decorative plain, active primary, scheduled info, draft/pending/missing warning, failed/rejected/spam error, hidden/trashed ghost). It goes through the modifier filter, so an unknown status is a render error; the filter now maps a name whose class is '' to no class. The dashboard's two badges moved onto it. No route changed: filters/tabs lists and page/pages/previousUrl/nextUrl were already the macros' arguments.

Decisions: row actions are one line of ghost xs buttons (Edit, action, View), Add new the one primary button. Syndication's entries are forms, so the screen gets a Targets table (name, id, URL, Offered/Ignored badge) above one card per entry. Annotations that are not states (None, Not yet, Nothing, Not an image) are plain text; You and Token you created are plain badges. The media alt state is a badge word plus a sentence (Missing / Describe it, or mark it decorative.).

Root-cause fix in components/table.njk: the wrapper gains contain-inline-size. CDP showed /admin/federation at 390 widening the page to 405 because a table's min-content inside a card widened the card past the column; containment keeps every table scrolling inside its wrapper.

Tests: new list-screens.test.ts with __testing__/list-screens.ts (seeds one site with every row state) and list-probe.ts (DaisyUI admin in a child process): same rows in both admins, every table the macro's with caption first, tabs current, pagination, badges with colour and word, no admin-* class. __testing__/statuses.ts reads either admin's status marks. keyboard.test.ts now also reads each {% call table(...) %} caption. daisyui.test.ts's unconverted-screen check moved to /admin/appearance/themes. Loosened old-markup regexes in posts, pages, users, media, federation, connected-apps and activity-log tests without dropping what they prove.

Verification: pnpm build, pnpm test (4461 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Criteria files run under both admins (old / GEEKITY_ADMIN=daisyui): posts 106/106, pages 19/19, users 54/54, taxonomy 16/16, media 20/20, federation 22/22, connected-apps 20/20, activity-log 17/17, syndication-targets 15/15, alt-text 10/10, keyboard 75/79. Headless Chrome over CDP against a sandbox with the switch on: 11 screens x 1280/390 x light/dark (44 views), document scrollWidth equal to the viewport on every one, wide tables scrolling in their wrappers (posts 728/358, media 1069/358 at 390), tabs marking All/Drafts/All (2) with aria-current=page; taxonomy rename flashed Renamed solo to beans; media copy buttons revealed and read Copied after a click (headless clipboard readback was empty, so the copied text itself was not read back); alt text saved and read back as Described.

DaisyUI MCP (workflowId m30-admin-lists) quality inspector: two remaining findings are known false positives: badge-sm{{ (it reads the Nunjucks interpolation as part of the class, as in every earlier macro) and list-disc (a Tailwind utility; styles.test.ts confirms its rule).

Run with GEEKITY_ADMIN=daisyui for the whole file, dashboard.test.ts and assets.test.ts each fail one in-process test that expects the old admin (counts as <dt>, admin-nav in the sheet); those files are built for the default env and were not touched here.

AC #2 left unchecked: it names the pending / approved / spam and inbox / spam filters, which are the Comments and Messages screens. Those screens are not in this task's list and are converted by TASK-274, so there is no proof for them here. For every screen this task converts, the filters are tabs with the current one marked and the page links are the pagination macro (list-screens.test.ts, CDP). The status map already holds pending, approved and spam for TASK-274. Check AC #2 once TASK-274 lands, or move that clause there.

AC #2 checked after TASK-274 converted Comments and Messages. Proof: src/admin/remaining-screens.test.ts, 'draws the pending / approved / spam filters as tabs, the current one marked (TASK-272 AC #2)', 'pages through comments with the pagination macro (TASK-272 AC #2)' and 'draws the inbox / spam filters as tabs and pages with the pagination macro (TASK-272 AC #2)', passing with and without GEEKITY_ADMIN=daisyui; and headless Chrome (TASK-274 notes): Pending, Inbox and Spam tabs marked tab-active and aria-current=page at 1280 and 390, light and dark, with the comments and messages pagination groups rendered. The filters on every screen this task converted were already proven by list-screens.test.ts.

Precision on the Chrome half of that proof: the CDP run read the tab-active class on Pending, Inbox and Spam (aria-current=page is held by remaining-screens.test.ts), and the pagination group (Newer disabled, Page 1 of 2, Older) was seen on the Messages screenshot at 1280 light; the comments pagination is held by the test.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Redrew the admin's list screens in the DaisyUI admin (daisyui/pages/: documents list, taxonomy, syndication; users list, connected apps, app activity and its entry; media library; followers) through the table, tabs, pagination and badge macros, with one status(name, label) map in badge.njk for every row state, a copyField component and a daisyui copy.js for the media copy controls, and contain-inline-size on the table macro's wrapper so a table never widens its card or the page. Verified by the new list-screens.test.ts (old admin in process, DaisyUI admin through list-probe.ts), the criteria test files passing under both admins, pnpm build/test/typecheck/lint/format:check, and headless Chrome at 1280 and 390 in light and dark (no page overflow on 44 views, tabs marked, rename, copy and alt text exercised).
<!-- SECTION:FINAL_SUMMARY:END -->
