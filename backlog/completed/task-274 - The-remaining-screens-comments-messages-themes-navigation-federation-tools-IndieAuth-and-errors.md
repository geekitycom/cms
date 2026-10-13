---
id: TASK-274
title: >-
  The remaining screens: comments, messages, themes, navigation, federation,
  tools, IndieAuth and errors
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 04:08'
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
ordinal: 233800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: everything not covered by the list, dashboard and editor tasks is redrawn through the macros: Comments and Messages (cards per row with their actions and the folded reply box), Appearance > Themes (one card per theme, the active one marked), Navigation > Menus (one panel per menu with the add and delete forms), Federation > Settings and the settings panels (mail state and test message, Akismet state, permalink redirects, personal data), Tools, the IndieAuth consent and refused screens, the error page and the placeholder. Each keeps its behaviour and its test file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Comments and Messages rows are cards with the author line, the body, the where line and the action row; unread is marked by more than colour; the reply box still folds; comments.test.ts and messages.test.ts pass
- [x] #2 Themes are cards with the active one marked and Activate on every other; Navigation is one card per menu with add and delete working; appearance.test.ts and navigation.test.ts pass
- [x] #3 The federation settings, the mail, Akismet, permalink and personal-data panels, Tools, the IndieAuth consent and refused screens, the error page and the placeholder render through the macros and their test files pass
- [x] #4 None of these templates carries a legacy admin-* class
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape first. Comment and message rows are one card each: an author line (name, site or mailto, status badges), the where line (time, on/from what, address hash), the body, and an action row of small ghost buttons; the comment reply box is the collapse macro (a details element) holding the reply form. Unread is a status badge word plus a bold author line; new states (unread, connected, unreachable, disconnected) go into the one STATUSES map in badge.njk. A theme is a card with the Active badge and an Activate primary button on every other; a menu is a card with its menus.NAME code, an items badge, the items form and, for a kept menu, the Delete form in cardActions; Add a menu is a card. Each settings panel (archive redirects, Akismet, mail credentials, WordPress paths, personal data, rebuild) is one card; tables go through the table macro. Consent, refused, error and placeholder are one card each (base layout pages in the centred column). users/edit.njk and users/new.njk become cards per form. No route changes: every context is already the macros' input.
2. A probe like list-probe: __testing__/remaining-screens.ts seeds one site with every state those screens draw (pending, approved, spam and webmention comments; read, unread and spam messages; packaged, site and broken themes; an area menu and a kept menu; archive redirects; Akismet key; mail credentials; an IndieAuth consent request and a refused one; the user edit and new screens) and returns each screen's HTML; remaining-probe.ts prints them under GEEKITY_ADMIN=daisyui; remaining-screens.test.ts asserts per screen: the same words under both admins, and under DaisyUI rows and panels are cards, unread is a badge word plus weight, the reply box is a details collapse, themes mark Active and offer Activate on the rest, menus are cards with add and delete forms, tables are the table macro's, no admin-* class outside the bar. The error page and placeholder render through createAdminTemplateEnvironment with the DaisyUI roots. Failing first.
3. Convert one screen at a time under daisyui/pages/, running its own test file under both admins before the next: comments, messages (closing TASK-272 AC #2: tabs and pagination), themes, menus, settings general/reading/permalinks/discussion/email/privacy, federation settings, tools content index and personal data, indieauth consent and refused, error, placeholder, users edit and new. Loosen old-markup regexes to the attribute they assert; fix the two dashboard checks in comments.test.ts and messages.test.ts that pin the old counts.
4. daisyui.test.ts: the unconverted-screen check (Themes) is replaced by its opposite: Themes is drawn from daisyui/ with no old-admin class.
5. Verify: pnpm build, test, typecheck, lint, format:check; the criteria test files under both admins; headless Chrome over CDP at 1280 and 390 in light and dark: comments reply folding, themes Activate, menu add and delete, a settings panel action, the IndieAuth consent, the error page. Update doc-5 Components with the new states and screens.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built under packages/cms/daisyui/pages/: comments/all.njk, messages/all.njk, appearance/themes.njk, navigation/menus.njk, settings/{general,reading,permalinks,discussion,email,privacy}.njk, federation/settings.njk, tools/{content-index,personal-data}.njk, indieauth/{consent,refused}.njk, error.njk, placeholder.njk, users/{edit,new}.njk. The old admin's files are untouched. Every template the admin has now exists under daisyui/.

Data shape: a comment or message is one card (author line with status badges, where line, body, one line of xs ghost buttons, each its own form); a comment's Reply is the collapse macro (details, folded) holding the reply form. Unread is status('unread','Unread') plus a bold name (a read row's name is font-medium). A theme is a card (Active badge, Activate primary in cardActions on every other); a menu is a card (menus.NAME, item-count badge, items form, Delete in cardActions on a kept menu); Add a menu is a card. Each settings panel is one card: Archive redirects and WordPress paths through the table macro; Spam checking and Mail credentials open with a status badge. Tools, Personal data and the user forms are cards; consent, refused and error are one card in base.njk's centred column with the h1 as card-title. No route changed.

STATUSES in components/badge.njk gained unread (primary), connected (success), unreachable (warning) and disconnected (ghost). Akismet: valid Connected, invalid Not recognised (rejected), unchecked Not checked (unreachable), none Not connected (disconnected). Mail: Configured (connected), Not sending (disconnected), Not configured (missing). Notice switches on users/edit: On (active), Off (hidden).

Tests: new remaining-screens.test.ts with __testing__/remaining-screens.ts (seeds one site with every state: pending, approved x26, spam and webmention comments; 26 messages with one unread and a spam one; a site theme and a broken one; an area menu and a kept one; an archive redirect; an invalid Akismet key; SMTP plus a stored Brevo key; a WordPress actor id; an IndieAuth request and a refused one; /admin/broken throwing) and remaining-probe.ts (the DaisyUI admin in a child process). It holds the same words in both admins and, under DaisyUI, cards, badges, the folded reply collapse, tabs, pagination, the table macro, at most one role=alert ahead of autofocus, and no admin-* class on any of 25 screens plus the placeholder rendered through createAdminTemplateEnvironment. Before the templates existed it failed 49 of 121 (for example, carries no class of the old admin on themes: admin-themes, admin-theme, admin-status). Loosened old-markup pins without dropping what they prove: comments.test.ts and messages.test.ts dashboard counts (they were the two baseline failures under the switch), messages unread mark, appearance cards and the broken-theme list, navigation headings and the delete form (by action), mail.test.ts panel (sliced from the Mail credentials heading), users.test.ts h2 headings, server-error.test.ts dashboard link. form-errors.test.ts: comments/all.njk joins NEVER_REFUSED (an empty reply is a flash over the list). daisyui.test.ts: the unconverted-screen check is replaced by its opposite (Themes is drawn from daisyui/ in the shell with no admin-* class token); overlay-probe.ts names it themes.

The error page is rendered by src/web/errors.ts outside render(), so it never reads the session and always follows the system (no data-theme, confirmed in Chrome).

Verification: pnpm build, pnpm test (4682 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Full suite with GEEKITY_ADMIN=daisyui: 4679 pass, 7 fail, every one a baseline failure from screens converted before this task (admin-theme.test.ts:106, assets.test.ts:30, dashboard.test.ts:367, federation/records.test.ts:655, rebuild.test.ts:349, web/admin-bar.test.ts:371, webmention/send.test.ts:617); the baseline before this task had those 7 plus the two in comments.test.ts and messages.test.ts, now fixed. Criteria files under both admins: comments, messages, appearance, navigation, settings-*, settings, akismet, mail, tools, personal-data, settings-federation, users, form-errors, styles, keyboard, daisyui, routes, indieauth/consent, web/server-error, remaining-screens (722 pass under DaisyUI, 719 under the old admin; keyboard.test.ts draws 75 cases for the old admin and 79 for the DaisyUI one, none fail).

Headless Chrome over CDP against the seeded sandbox with the switch on: 20 screens x 1280/390 x light/dark (80 views), no page overflow and no card overflowing its content on any (the first run caught the Not themes card overflowing at 390 on a long themes path; fixed with break-all). Reply box: folded (textarea not visible), opens on its summary, folds again, at 1280 and 390; posting a reply flashed Replied to Ada Lovelace and Approved went 26 to 27. Themes: Activate on Midnight flashed and moved the Active badge to Midnight, Default gaining Activate. Navigation: Add sidebar put a sidebar card in; its Delete this menu removed it. Discussion: Remove key flashed and the panel read Not connected. Consent: Approve redirected to https://app.example/callback?code=...&state=state-123. Error page: one card, no data-theme.

DaisyUI MCP (workflowId m30-admin-remaining) quality inspector: fixed fieldset on the consent scopes and object-cover on the two images. Known false positives left: list-disc (a Tailwind utility; styles.test.ts confirms its rule), card-title on base.njk pages (the card root comes from the card macro call, which the inspector cannot read through), and the workflow step asking for component_syntax_expert (reference, not a gate).

doc-5 Components updated: the new states in the status map, and bullets for records as cards, panels as cards, and the one-card screens.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Redrew the admin's remaining screens in the DaisyUI admin (daisyui/pages/): Comments and Messages as one card per record with a folded Reply collapse and an Unread badge plus bold name, Themes as cards with Active and Activate, Navigation as one card per menu with Add and Delete, every settings panel (archive redirects, Akismet, mail credentials, WordPress paths) as a card with status badges and table-macro tables, Tools and Personal data as cards, the IndieAuth consent and refused screens and the error page as one card in the bare column, the placeholder, and users/edit and users/new. Every admin template now exists under daisyui/. Four states joined the one status map. Verified by the new remaining-screens.test.ts (old admin in process, DaisyUI admin through remaining-probe.ts; red on 49 of 121 before the templates), the criteria test files under both admins, pnpm build/test/typecheck/lint/format:check, and headless Chrome on 80 views at 1280 and 390 in light and dark plus the reply fold, Activate, menu add and delete, Akismet Remove key, consent Approve and the error page.
<!-- SECTION:FINAL_SUMMARY:END -->
