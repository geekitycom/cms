---
id: TASK-275
title: >-
  Flip to the DaisyUI admin: prove daisyui/ complete, rename it to admin/,
  remove the switch, retarget the tests and docs
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 06:33'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-271
  - TASK-272
  - TASK-273
  - TASK-274
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: chore
ordinal: 234800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30, last step. A test proves the daisyui/ folder stands alone: every template the admin asks for by name (ADMIN_TEMPLATES), and everything those templates extend, import or include, resolves inside daisyui/ with no fallthrough, and every static file the templates reference is there (editor.js and the other scripts move with it). With that green, delete packages/cms/admin/, rename daisyui/ to admin/, remove the GEEKITY_ADMIN switch and its mentions, and point the loader, the asset roots, the build scripts, the gitignore and the package files entry at the one folder. The tests that read the old stylesheet as text are retargeted or removed, doc-5 is rewritten to describe the DaisyUI admin (the shell, the component library, the theme choice, the bar), and the READMEs follow. Finish with a screenshot pass of every screen in a light and a dark theme at phone and desktop widths, and the deslop and no-comments passes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A completeness test resolves every ADMIN_TEMPLATES entry and everything it extends, imports or includes, and every referenced static file, inside the new folder alone, and it passes before the rename
- [x] #2 packages/cms/admin/ is the renamed daisyui/ folder, the old admin is deleted, GEEKITY_ADMIN is gone from the code, the tests, the READMEs and the Docker files, and the package files entry names admin only
- [x] #3 No legacy admin-* rule remains anywhere; the only authored selectors are the bar stylesheet, the CodeMirror surface rules and what DaisyUI syntax requires; the whole suite, typecheck, lint and format check pass
- [x] #4 doc-5 describes the DaisyUI admin: the shell, the component library and its two rules, the per-user theme, the shadow-rooted bar on both sides; the README and package README no longer promise a plain-CSS admin or mention the switch
- [x] #5 Every admin screen was screenshotted in one light and one dark built-in theme at 390 and 1280 wide with no horizontal overflow, clipped text or unstyled element, and the screenshots are attached to the task or linked from it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Completeness test (src/admin/admin-folder.test.ts): walk every ADMIN_TEMPLATES entry and its extends/import/include/from targets and every {{ assetPrefix }} file inside daisyui/ alone; red on slug.js and location.js, green after copying them into daisyui/static/. Full suite.
2. Fix the seven tests that fail under GEEKITY_ADMIN=daisyui so the suite passes in both modes.
3. Flip: git rm admin/, git mv daisyui/ admin/, delete the switch (adminDirectories, DAISYUI_ADMIN_DIR, ADMIN_DIRS, ADMIN_STATIC_DIRS), point the loader and asset root at the one folder, keep PACKAGED_ADMIN_DIR exported. Build script writes one editor bundle; drop CLASSIC and ADMIN_LOOK. Collapse the two-admin tests and helpers, delete the probes, retarget gitignore, prettierignore, eslint, package files, Dockerfile comment, READMEs, doc-5. Gates: build, test, typecheck, lint, format:check, npm pack --dry-run.
4. Prove no legacy admin-* class or rule remains outside the bar; state it in styles.test.ts.
5. Screenshot every screen in a light and a dark theme at 390 and 1280 over CDP; check overflow, clipping, unstyled elements; fix findings.
6. deslop and no-comments over the branch diff against main.
7. Check criteria with evidence, notes, summary.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Unit 1 (completeness test, AC #1): src/admin/admin-folder.test.ts walks every ADMIN_TEMPLATES entry and every extends/import/include/from target by reading the template text, and every {{ assetPrefix }}name file, inside one folder with no fallthrough. Against daisyui/ it went red on slug.js and location.js only (and a mutation that hid components/theme-choice.njk turned the template half red); copying the two scripts into daisyui/static/ made it green, and the default suite passed (4684/4684) before the rename. After the rename it guards PACKAGED_ADMIN_DIR.

Unit 2 (the seven tests that failed with GEEKITY_ADMIN=daisyui): assets.test.ts now recognises the compiled sheet by its [data-theme] rules; records.test.ts and rebuild.test.ts strip the per-response CSP nonce on the bar's <style> as well as the CSRF token before comparing screens; web/admin-bar.test.ts asserts the bar loads /admin/_static/admin-bar.js and that the served script measures the bar; webmention/send.test.ts pins the copy link with its link class. All five green under the switch. admin-theme.test.ts:106 (the old admin draws no theme) was deleted with the old admin, and dashboard.test.ts:367 collapsed to the stat counts at the flip. Decision: I did not make these five pass in both modes, since the old admin was deleted in the next unit and dual-mode branches would have been thrown away (outcome-oriented execution); the post-flip suite is the gate.

Unit 3 (flip, AC #2): git rm -r packages/cms/admin, git mv packages/cms/daisyui packages/cms/admin. Removed adminDirectories, DAISYUI_ADMIN_DIR, ADMIN_DIRS, ADMIN_STATIC_DIRS and the roots option; templates.ts and assets.ts read the one folder. editor/look.ts keeps one LOOK (CLASSIC and the ADMIN_LOOK define are gone), scripts/build-editor.js builds one bundle to admin/static/editor.js (identical to main's). build:admin compiles admin/src/admin.css to admin/static/admin.css, now gitignored. package.json files lists admin only; .gitignore, .prettierignore and eslint.config.js name admin/ only; the Dockerfile is back to main's text. Probes deleted (dashboard, list, remaining, editor, shell, fields, bar, theme, overlay) and their bodies inlined in process; the two-admin halves dropped; the editor equivalences (status per screen, groups per screen, the filled form) pinned as fixed values captured from the DaisyUI admin, which the old comparison had already proven equal. Helpers flash.ts, statuses.ts, citedCard, the UNREAD and dashboard-count regexes, appearance cards(), users hidden-label and media Nothing regexes collapsed to the DaisyUI form; admin-files.ts deleted. READMEs and doc-5 rewritten (doc-5 through backlog doc update).

Gates after the flip: pnpm build, pnpm test (4580 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all green. npm pack --dry-run ships admin/src/admin.css, admin/static/{admin.css,admin-bar.css,admin-bar.js,copy.js,editor.js,location.js,slug.js} and nothing under daisyui/.

Unit 4 (AC #3): styles.test.ts now holds that no admin template but components/admin-bar.njk writes an admin-* class, editor/look.ts writes none, and no stylesheet under admin/ (static/ and src/) has an .admin-* rule but static/admin-bar.css. Mutations (an admin-hint class on pages/error.njk, an .admin-nav rule in src/admin.css) each turned it red. The existing authored-rules test in daisyui.test.ts already limits src/admin.css to the bar offset and the #editor-surface .cm-* rules.

Unit 5 (screenshots, AC #5): /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/df5f3e8d-23eb-5ba4-a33f-f98b4304a0b8/scratchpad/screenshots/ holds 212 full-page PNGs named <screen>-<theme>-<width>.png and report.json, written by scratchpad/shots.mts (rerun instructions at its top). Themes: cupcake (light) and dracula (dark), set as the user's admin theme with prefers-color-scheme emulated to match; the screens that follow the system (setup, login, forgot, reset, the error page) drew in light and dark. Widths 390 and 1280. Screens (53): setup, login, forgot, reset; dashboard; posts, postDrafts, postTrash, postsPageTwo, pages, tags, categories, users, apps, activity, activityFailures, activityEntry, media, followers, syndication; editorNewPost, editorNewPage, editorFilled, editorTrashed, editorRefused, conflict; comments, commentsApproved, commentsSpam, messages, messagesSpam, themes, navigation, navigationRefused, settingsGeneral, settingsReading, settingsPermalinks, settingsDiscussion, settingsEmail, settingsPrivacy, federationSettings, tools, toolsConfirm, personalData, personalDataFound, usersEdit, usersEditOther, usersNew, consent, refused, error, placeholder (rendered, it has no route), publicAdminBar (a public post with the bar). Scripted checks per shot: document width equals window width, no element with hidden/clip overflow whose text overflows it, no element past the right edge outside a sideways-scrolling wrapper, every button/input/select/textarea carries a DaisyUI control class, admin.css loaded, the bar fixed with its shadow root styled, no admin screen answered with the 500 page. Result: 0 findings. The first run flagged publicAdminBar-cupcake as a 500; that was Chrome reusing a kept-alive connection to the previous site's closed server on the same port (the page title was the other site's), fixed in the script by giving each site its own port. Checked by eye: dashboard-cupcake-1280, posts-dracula-390 (the table scrolls inside its wrapper by design), editorFilled-dracula-390 and -cupcake-1280, login-dracula-390, comments-cupcake-390, settingsEmail-dracula-1280, publicAdminBar-dracula-1280, themes-dracula-390. In full-page captures of tall screens the drawer column ends at the viewport height because it is sticky; in a browser it stays in view while scrolling.

Open at handback: the deslop review (report-only) and the comment-sicko pass over the whole branch diff were launched but had not reported when this agent handed back. The comment-sicko agent edits comments in the working tree directly, so comment-only unstaged changes may appear after this note. The task stays In Progress until both passes are reviewed and the gates rerun.

Both passes ran over the whole branch diff against main after the flip. Comment review (comment-sicko): 63 edits in 42 files accepted, all inside the branch diff; its four MUST KILL findings landed as code in ce206df (adminSecurityHeaders reuses a nonce already minted for the request, with a test registering it twice; the bar template emits the offset stylesheet on both sides and OFFSET_STYLE plus the admin.css :root:has rule are gone; one HOST_STYLE for the public host's style attribute and the shadow root's :host rule; the skip link sits under the bar by the bar-height token instead of z-[100000]). Deslop: duplicated test readers shared in src/admin/__testing__/markup.ts, the look table's empty entries and the classic-era helpers dropped, findAsset's roots back to main's type, in ef36d97. Gates green after each: pnpm build, pnpm test (4580 + 30), pnpm typecheck, pnpm lint, pnpm format:check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Flipped the admin to DaisyUI: a completeness test proved every ADMIN_TEMPLATES entry, everything it extends, imports or includes, and every referenced static file resolve inside daisyui/ alone; then the old admin/ was deleted, daisyui/ renamed to admin/, the GEEKITY_ADMIN switch, the two-admin tests, the probes and the second editor bundle removed, the package files entry, build scripts, gitignore, Dockerfile, READMEs and doc-5 retargeted. A styles test holds that no admin-* rule or class remains outside the bar's own sheet. Verified by the full gates (4580 + 30 tests, typecheck, lint, format), npm pack --dry-run shipping admin/ only, and 212 screenshots over 53 screens in cupcake and dracula at 390 and 1280 wide with scripted overflow, clipping and unstyled-control checks finding nothing (scratchpad/screenshots/, report.json). The deslop and no-comments passes ran over the whole branch and landed as ce206df and ef36d97.
<!-- SECTION:FINAL_SUMMARY:END -->
