---
id: TASK-273
title: 'The editor on DaisyUI: layout, groups, tabs, buttons and the cited card'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 03:43'
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
ordinal: 232800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: the editor (documents/editor.njk, 497 lines, and the markup editor/main.ts builds at runtime) is laid out with utilities and the macros: the writing column and the side column, the collapsible groups, the Write/Preview tabs, the buttons (Save draft, Publish, Update, Move to trash, View), the upload control and status line, the cited-page card with its Remove toggle and alt-text field, and the conflict screen with its two versions side by side. The CodeMirror surface is the one authored exception: its .cm-* rules stay in the stylesheet source and read the theme's base tokens so the surface follows the chosen theme. Uploads, drag-and-drop, preview and the file-hash conflict check behave exactly as before. The MCP server's page architect has pages/cms-content-editor for the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The editor renders through the macros with a two-column layout that stacks on a narrow screen, and editor.test.ts, editor-location.test.ts, editor-geolocation.test.ts, cited-preview.test.ts and cited-image-alt.test.ts pass
- [x] #2 Write and Preview are DaisyUI tabs with aria-selected, the upload control and status line are drawn with the macros' classes from editor/main.ts, and the CodeMirror surface follows the chosen theme in light and dark
- [x] #3 The cited-page card is a card with its Remove toggle and alt-text field working as before, and the conflict screen shows both versions readable side by side
- [x] #4 The editor and conflict templates carry no legacy admin-* class; the only authored rules left for them are the .cm-* ones
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: the context renderEditor and renderConflict already pass (heading, kind, form, actions, open, citedPreviews, errorField/error, viewUrl, saveUrl, previewUrl, uploadUrl, cspNonce; submitted, current, freshHash, action) is unchanged; the conversion is templates, macros and the editor bundle.

1. Tests first: an editor probe (child process with GEEKITY_ADMIN=daisyui) over one seeded site serving a new post, a filled post with a cited card and a described image, a page, a refused save, a trashed post and a file-hash conflict; editor-daisyui.test.ts holds the DaisyUI markup (grid columns, collapse groups, buttons by action, card, conflict side by side, no admin-* class). Loosen the old tests that pin old markup (cited-preview, cited-image-alt, editor-geolocation, the save-URL regex in posts/pages/dashboard/indexnow/reply-context) to the attributes they assert, and run the named editor tests under both admins.
2. Components: collapse.njk (details/summary collapse, optional fieldset legend); fields.njk gains list, maxlength and hintId (hint id named by aria-describedby); button gains id, hidden, formtarget, formnovalidate; textarea name optional. components.test.ts covers each.
3. daisyui/pages/documents/editor.njk: writing column and side column in one grid, two columns from xl and stacked below; groups as collapses; action buttons in a card at the top of the side column (Publish/Update primary, Move to trash error ghost, View ghost link); notes as polite alerts.
4. Cited card: card macro with the remove checkbox as a peer, the X label, the removed note and the alt-text field.
5. editor/look.ts: the class names main.ts writes, CLASSIC and DAISYUI; scripts/build-editor.js builds main.ts twice with ADMIN_LOOK defined, to admin/static/editor.js (classic) and daisyui/static/editor.js (daisyui, gitignored). main.ts writes tabs as role=tablist/tab with aria-selected and aria-controls, panels as tabpanels, an upload button and a status line with an error tone, and in the DaisyUI build a HighlightStyle that names .cm-md-* classes. Tailwind sources editor/look.ts; styles.test checks every DAISYUI class has a rule.
6. CodeMirror: .cm-* rules in daisyui/src/admin.css scoped under #editor-surface (beats CodeMirror's later, unlayered theme) reading --color-base-*, --color-primary.
7. daisyui/pages/documents/conflict.njk: an error alert, both versions as read-only textareas in cards side by side from lg, the discard link and the overwrite button.
8. doc-5: the editor section and the components table (collapse, button/fields additions).
9. Verify: pnpm build/test/typecheck/lint/format:check; full suite under GEEKITY_ADMIN=daisyui against the baseline; CDP at 1280 and 390 in light and dark, tabs, upload, cited card, save and conflict.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: no change to the editor or conflict context (documents.ts renderEditor/renderConflict); the conversion is templates, macros and the editor bundle.

Built:
- daisyui/pages/documents/editor.njk: one grid form, writing column (card with Title, Body, tools; then Photos, Location, Recording) and side column (card of action buttons at the top, then the groups); xl:grid-cols-[minmax(0,1fr)_20rem], stacked below xl. Groups are the new collapse macro (details/summary, fieldset with sr-only legend). Publish/Update primary, Move to trash error ghost, View ghost link. Trashed/scheduled notes are polite alerts so the refused summary stays the only role=alert. Cited card is the card macro with a peer sr-only checkbox, an X label (btn-circle), peer-checked dimming and note, and the alt-text field.
- daisyui/pages/documents/conflict.njk: soft error status alert, two cards with read-only textareas side by side from lg, discard link, overwrite button; body posted from a hidden textarea.
- Macros: components/collapse.njk (new, icon modifier arrow/plus); button gains id, hidden, formtarget, formnovalidate; fields text gains list, maxlength; text/textarea/select/checkbox gain hintId (hint id named in aria-describedby after the error); textarea name optional.
- Editor bundle: editor/look.ts holds CLASSIC and DAISYUI class sets; scripts/build-editor.js builds main.ts twice with esbuild define ADMIN_LOOK, to admin/static/editor.js and daisyui/static/editor.js (gitignored, eslint/prettier ignored). main.ts: tabs are role=tablist/tab with aria-selected, aria-controls, tabpanels, roving tabindex, arrows/Home/End (both bundles); preview frame lives in a #editor-preview panel; status line has an error tone; DaisyUI build adds a HighlightStyle that names .cm-md-* classes. devDependencies @codemirror/language and @lezer/highlight added (already in the lockfile through codemirror).
- daisyui/src/admin.css: @source now editor/look.ts; .cm-* rules under #editor-surface (id outranks CodeMirror's later unlayered injected theme) reading --color-base-100/200/300, --color-base-content, --color-primary and friends.
- Tests: editor-daisyui.test.ts (probe editor-probe.ts over __testing__/editor-screens.ts; old admin in process) holds both admins to the same posted form and group states on five editor screens, and the DaisyUI markup (grid, collapses, buttons by action, card, conflict side by side, no admin-* class). __testing__/editor-form.ts shares fieldsOf, saveUrlOf, citedCard. Loosened to attributes: cited-preview, cited-image-alt, editor-geolocation, posts (lang, pinned, syndication, summaries), comments (select), and the save-URL regex in posts/pages/dashboard/indexnow/reply-context. form-errors.test lists conflict.njk among never-refused screens. daisyui.test: overlay serves daisyui/static/editor.js, fall-through retargeted to slug.js, the two bundles carry their own classes, authored CSS is only the bar offset and #editor-surface .cm-* rules in theme tokens. styles.test: every DAISYUI look class has a rule. components/fields tests for the macro additions.

DaisyUI MCP (workflow m30-admin-editor): quality inspector flagged a hidden textarea without a label on the conflict screen (hidden from the accessibility tree, a false positive) and a workflow bookkeeping finding about unretrieved page-architect components; it is a reference, not a gate.

Validation: pnpm build && pnpm test (4523 pass, 0 fail) && pnpm typecheck && pnpm lint && pnpm format:check from the root, exit 0. The full suite with GEEKITY_ADMIN=daisyui fails the same 9 tests it failed before this task (dashboard stats, Themes data-theme, comments/messages/records dashboard counts, admin-bar offset, rebuild, webmention resend) and nothing else; the five named editor tests plus editor-layout, posts, pages, cited-title-slug, alt-text, syndication-targets pass under both admins. Headless Chrome over CDP against a sandbox site with the switch on: editor at 1280 and 390 in light and dark, page scrollWidth equals the viewport, columns side by side at 1280 (616px and 320px) and stacked at 390; .cm-editor background equals the card's base-100 and gutters the base-200 in both schemes, Markdown marked .cm-md-* in base-content with primary link underline; Preview click flips aria-selected, hides the surface and renders the post in the frame, ArrowLeft/End move and focus the tabs; Add file uploads a PNG (status Uploading… then empty, markdown inserted), an .exe is refused with the status in text-error, a CDP drag-and-drop of a PNG onto the surface uploads it; the cited card's X toggles the checkbox, dims the image to 0.4 and shows the note; an Update writes the typed text, preview: false and the alt text; editing after the file changed on disk shows both versions side by side at 1280 and stacked at 390, and Keep mine overwrites. The old admin's bundle checked the same way: admin-* classes, preview and upload working.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The editor and the conflict screen are drawn in DaisyUI in the overlay (daisyui/pages/documents/editor.njk, conflict.njk): a writing column and a side column side by side from xl and stacked below, every group a new collapse macro, the buttons a card at the top of the side column with Publish/Update primary and Move to trash in the error colour, the cited page a card with its Remove toggle and alt-text field, and the conflict's two versions side by side from lg. editor/main.ts writes its classes from editor/look.ts and is built twice (admin/static/editor.js classic, daisyui/static/editor.js DaisyUI); Write/Preview became an ARIA tablist DaisyUI draws by aria-selected, the status line gained an error tone, and the DaisyUI build marks Markdown with .cm-md-* classes. The .cm-* rules in daisyui/src/admin.css read the theme's tokens, so CodeMirror follows the theme. The old admin is unchanged. Verified with the full gate, the suite under GEEKITY_ADMIN=daisyui against its baseline, a new two-admin editor test, and CDP runs at 1280 and 390 in light and dark covering tabs, uploads, drag-and-drop, the cited card, a save and a conflict.
<!-- SECTION:FINAL_SUMMARY:END -->
