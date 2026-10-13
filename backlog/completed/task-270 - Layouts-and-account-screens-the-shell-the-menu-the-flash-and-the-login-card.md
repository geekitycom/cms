---
id: TASK-270
title: 'Layouts and account screens: the shell, the menu, the flash and the login card'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 02:08'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-266
  - TASK-268
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 229800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: the chrome every screen is drawn inside is redrawn with DaisyUI, as its own layout rather than the WordPress one. layouts/base.njk, shell.njk and settings-page.njk, components/flash.njk and the four account screens (login, setup, forgot, reset) compose the macros from TASK-266 under the new bar from TASK-268. The section menu stays server-rendered from the registry in src/admin/menu.ts: the open section is a nested list, the current screen carries aria-current, and no script is needed to expand anything; on a narrow screen the menu stacks or sits in a drawer. The MCP server's page architect (pages/sign-in, pages/settings-page, pages/admin-dashboard) is worth consulting for the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Signed-in screens are drawn in a DaisyUI shell: a side menu (menu component) rendering the registry with the open section as a nested list and aria-current on the current screen, and a main column; navigation.test.ts and menu.test.ts pass
- [x] #2 On a narrow viewport the menu stacks above the screen or opens from a drawer without JavaScript deciding which section is open
- [x] #3 The flash is a DaisyUI alert in the semantic colour of its kind (notice, error, warning), and the login, setup, forgot and reset screens are one centred card each
- [x] #4 The skip link, the focus ring and every keyboard test in keyboard.test.ts pass in the new shell, and the shell carries no legacy admin-* class
- [x] #5 The settings page layout (heading, summary, form, panels) renders through the macros and every settings page still saves
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape. The shell takes navigation (adminMenu's sections: label, url, open, children with current), flash (kind notice|warning|error, message), and the bar's context (me, logoutUrl, csrfToken, barScheme, cspNonce, assetPrefix, viewUrl/kind) from render(). It keeps base.njk's blocks: title, chrome (the bar, a direct child of body), main (overridden), content (the page).

1. daisyui/layouts/shell.njk: chrome draws the bar as the old shell does; main is a DaisyUI drawer, lg:drawer-open. A checkbox drawer-toggle, then drawer-side holding <nav aria-label="Sections"> with the menu macro over navigation (open section nested, current child aria-current, all server-rendered), then drawer-content with <main id="main">, a Menu drawer-button shown below lg, the flash and the content block. The side sits under the fixed bar by --geekity-admin-bar-height. No script decides anything: the checkbox only shows or hides the drawer on a narrow screen.
2. components/menu.njk: menu links get a visible focus-visible outline in base-content, since DaisyUI's menu replaces the outline with a 10% tint and none at all on the current item.
3. components/alert.njk gains polite=true for role=status; daisyui/components/flash.njk draws each entry as an alert, notice success, warning warning, error error, role=status so a refused form's summary stays the one role=alert.
4. base.njk's main centres its column; pages/account/{login,setup,forgot,reset}.njk are one card each with an h1 card-title, the fields, a block primary submit button and links as DaisyUI links.
5. daisyui/layouts/settings-page.njk: h1, the summary, the form (max-w-2xl column, fields, a primary Save settings button), then the panels block.
6. keyboard.test.ts: the skip-link check accepts whichever admin is served; the old focus-ring contrast test reads the old admin's own stylesheet so it holds with the switch on; a new focus test holds the DaisyUI menu's ring. daisyui.test.ts's unconverted-screen check moves off the old shell's class.
7. Tests first: shell.test.ts renders the new shell, settings layout, flash and account screens with the daisyui roots, and a child-process probe with GEEKITY_ADMIN=daisyui saves every settings page and reads the account screens over HTTP.
8. Verify: pnpm build/test/typecheck/lint/format:check, the suite with the switch on for navigation, menu, keyboard, settings, form-errors; headless Chrome over CDP at 1280 and 390 in light and dark: menu, aria-current, drawer, the four account screens, each flash kind, a settings save. doc-5 updated through backlog doc for the menu and the shell.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape. The shell reads navigation (adminMenu's sections with open, and children with current), flash ({kind: notice|warning|error, message}) and the bar's context from render(); it keeps base.njk's blocks (title, chrome, main, content) and overrides chrome (the bar, a direct child of body) and main.

Shell (daisyui/layouts/shell.njk): a DaisyUI drawer, lg:drawer-open. The checkbox drawer-toggle (autocomplete=off so back navigation does not reopen it), then drawer-side holding <nav aria-label="Sections"> with the menu macro over navigation, then drawer-content with a Menu drawer-button (lg:hidden) and <main id="main">, the flash and the content block. The side comes before the content in the DOM, so a keyboard meets the menu first as in the old shell; DaisyUI places the two by grid column. From lg the side is sticky at lg:top-(--geekity-admin-bar-height) with height 100dvh minus the bar; below lg the panel is fixed from the top with pt-(--geekity-admin-bar-height) so its first link starts under the bar. The open section and aria-current are server-rendered either way; the checkbox only shows or hides the panel.

Menu macro: every link now carries focus-visible:outline-2/-offset-2/-solid/outline-base-content. DaisyUI's menu replaces the outline with a 10% tint on focus, and none on the current (menu-active) item, so a keyboard user could not see focus on the screen they were on. outline-solid is needed because DaisyUI sets --tw-outline-style:none.

Alert macro gained polite=true (role=status). Flash (daisyui/components/flash.njk): one polite alert per message, notice=success (the old admin drew notices green), warning=warning, error=error, so a refused form's summary stays the page's one role=alert.

Settings layout (daisyui/layouts/settings-page.njk): h1.mb-6.text-2xl.font-bold, the summary in a max-w-2xl box, the form as a max-w-2xl flex column with the fields block and a primary Save settings button from the button macro, then the panels block in a max-w-2xl column. Same blocks as before: settingsProblems, settingsFields, settingsPanels.

Account screens: base.njk's main is now a centred column (mx-auto flex min-h-screen max-w-md flex-col justify-center p-6); login, setup, forgot, reset are one card each (card macro, no title argument, an h1.card-title.text-2xl inside so the page keeps its h1), fields through the field macros, a block primary submit button, links as DaisyUI link; reset's expired-link message is an error alert.

Tests. New src/admin/shell.test.ts renders the shell, settings layout, flash and the four account screens from daisyui/ over admin/, and through __testing__/shell-probe.ts (child process, GEEKITY_ADMIN=daisyui) reads the four account screens over HTTP, saves every settings page and follows each save to its success alert, and refuses a test email for an error alert. keyboard.test.ts: the skip-link check now expects the opening tag the served base.njk writes, so it holds for either admin; the old focus-ring contrast test reads the old admin's stylesheet by its own path; a new test holds the DaisyUI menu's ring on every link, the current one included. daisyui-bar.test.ts found the first rule mentioning geekity-admin-bar, which is now the pt-(--geekity-admin-bar-height) utility; it now looks for the :has() rule itself. Tests that pinned the old shell's markup with the switch on (routes, appearance, media, users, dashboard, settings-privacy, alt-text, connected-apps) now match the menu by aria-label=Sections and aria-current, the heading as <h1 ...>, and the flash through __testing__/flash.ts, which reads either admin's flash and goes at the flip.

DaisyUI quality inspector (workflow m30-admin-shell): two findings, both false positives. menu-active{% is the inspector reading through a Nunjucks tag inside the class attribute (styles.test.ts confirms menu-active has a rule); card-title 'orphan' is because the card root comes from the card macro in another file.

Validation. From the repo root: pnpm build, pnpm test (4384 + 30 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all pass. With GEEKITY_ADMIN=daisyui the package suite has 8 failures, down from 52 before this task, all present in the baseline and none new: the At a glance grid tests (TASK-271), the assets cache header, admin-theme's old-admin block, the public admin-bar margin test, rebuild and federation records. navigation.test.ts, menu.test.ts, keyboard.test.ts, settings.test.ts, form-errors.test.ts and shell.test.ts pass under both admins.

Browser proof: headless Chrome over CDP against a sandbox site with GEEKITY_ADMIN=daisyui, prefers-color-scheme light and dark, 1280 and 390 wide. At 1280 the drawer-side is visible and 256px wide, the toggle and Menu button are display:none, main starts at x=256, the first menu link sits at y=48 under the 40px bar and stays there after scrolling 670px. The open section on /admin/settings is Settings with General..Privacy nested and aria-current on General only. Tabbing to General gives :focus-visible with a solid 2px outline in --color-base-content (light oklch(.21...), dark oklch(.978...)), offset 2px. The skip link is the first Tab stop on /admin and /admin/forgot, at y=0 and on top of the bar (elementFromPoint). At 390 the side is visibility:hidden and off-screen, the Menu button shows, no horizontal overflow; clicking it slides the panel in (visible, same open section and aria-current), the overlay closes it; by keyboard the checkbox takes focus with the Menu button outlined, Space opens it and the next Tab lands on Dashboard in the panel. Saving General redirects back with a role=status alert-success in --color-success; a refused test email shows alert-error; publishing a post with an undescribed image shows alert-success then alert-warning. Setup, login, forgot, reset (valid token) and reset (expired) are one card each with the h1 inside, centred to 0px, no overflow, at both widths and schemes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Drew the DaisyUI admin's chrome. daisyui/layouts/shell.njk puts the section menu (the menu macro over the registry, open section nested, aria-current on the current screen) in a DaisyUI drawer that is open from lg up and slides in from a Menu button below that, with a checkbox and no script; the menu precedes main for keyboard order and its links gained a visible focus ring. daisyui/components/flash.njk draws each flash as a role=status alert in its kind's colour, through the alert macro's new polite option. daisyui/layouts/settings-page.njk draws the heading, summary, a max-w-2xl form with a primary Save button and the panels through the macros. Login, setup, forgot and reset are one centred card each. Tests: new shell.test.ts (render plus an HTTP probe with the switch on that saves every settings page), keyboard.test.ts holding both admins and the new ring, and the old-shell markup assertions elsewhere made admin-agnostic. Verified with the full build, test, typecheck, lint and format run, the suite with the switch on (52 failures down to 8, none new) and headless Chrome at 1280 and 390 in light and dark.
<!-- SECTION:FINAL_SUMMARY:END -->
