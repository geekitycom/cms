---
id: TASK-497
title: >-
  The editor has a distraction-free mode that shows only the title and body,
  fullscreen where allowed
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 10:50'
updated_date: '2026-10-23 12:32'
labels:
  - admin
  - editor
  - accessibility
milestone: m-47
dependencies:
  - TASK-495
references:
  - packages/cms/editor/main.ts
  - packages/cms/admin/pages/documents/editor.njk
  - packages/cms/src/admin/keyboard.test.ts
ordinal: 422800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-62: writing with the admin shell and sidebar in view is noisy. A Write in focus button and Ctrl/Cmd+Shift+F hide everything but the title and body, centred at a reading measure, with a quiet status line (word count and autosave status). There is no save button in this mode: autosave keeps the work and the writer exits to save or publish.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Write in focus button beside the Write/Preview tabs, and Ctrl/Cmd+Shift+F, enter the mode; it exists only when JavaScript runs
- [x] #2 The mode hides the admin shell, the admin bar, the sidebar and every editor section but the title and body, and sets the body in a centred column at about 70ch in the admin theme, in light and dark
- [x] #3 It requests the Fullscreen API where available; when refused or unavailable it fills the window instead; leaving browser fullscreen also leaves the mode
- [x] #4 A status line shows the word count and the TASK-495 autosave status; the mode has an Exit button and no save button
- [x] #5 Escape, the shortcut and Exit leave the mode and return focus to the control that entered it; focus never lands on hidden controls (they are inert while the mode is on)
- [x] #6 Preview tab, upload and video controls either stay usable in the mode or are hidden with it; the editor content and cursor position are unchanged on enter and exit
- [x] #7 Tests cover entering and leaving by each route, inert hidden content, and the no-JS editor being unchanged; a headless-browser check screenshots the mode in a light and a dark admin theme; docs/admin.md describes the mode and shortcut
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pure, DOM-free module src/admin/focus-mode.ts: wordCount/wordsLabel, isFocusShortcut, focusStep reducer (enter by button or shortcut, leave by Escape/shortcut/Exit/fullscreen-left, blocked while the resume banner is up, fullscreen pending/on/refused), and outsideOf (which siblings along the paths to the kept nodes to hide). Tests first in focus-mode.test.ts.
2. editor/focus.ts wires it: a Write in focus button after the Write/Preview tabs (JS only, aria-keyshortcuts), a document keydown for Ctrl/Cmd+Shift+F and Escape (skipped when CodeMirror handled it), a status line (word count, the moved #editor-autosave-status, Exit; no save button), inert + data-focus-hidden on everything but the title and body, Fullscreen API on <html> with the window-filling CSS as the fallback, fullscreenchange leaves the mode, focus returns to the entering control, scroll restored.
3. Banner case: while #autosave-resume is on the page the mode is refused and the editor status says to choose Restore or Discard first; release() is never called.
4. Preview, Add file and Add video are hidden with the mode; entering from Preview switches to Write first. Cursor and content untouched.
5. admin.css: html.editor-focus rules (fixed full-window sheet, centred ~70ch column, generous line height, gutters hidden), in the admin theme.
6. Template test: no-JS editor has no focus button; editor carries the site time zone.
7. Time-zone fix: #editor-enhance carries data-autosave-timezone; the browser-copy banner uses formatInTimezone like the server banner.
8. docs/admin.md: the mode and shortcut.
9. Verify: pnpm build/test/test:11ty/typecheck/lint/format:check; live headless Chromium script on a temp site (port 3497) for every route, inert, cursor, banner, JS off; screenshots light/dark to /tmp/m48-focus/.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pure logic in src/admin/focus-mode.ts (focusStep reducer, isFocusShortcut, wordCount, wordsLabel, outsideOf) with 31 unit tests; page wiring in editor/focus.ts; CodeMirror rules under html.editor-focus in admin.css; docs/admin.md Writing in focus.

Shortcut is a capturing window keydown, stopped there, because CodeMirror on macOS binds Ctrl+Shift+F to select the next character. Escape is a document keydown skipped when CodeMirror already handled it (search panel, completion). Enter switches to Write, sets hidden and inert on everything outside the title field, body field and status line (only what was visible and not inert, so leaving restores exactly), and adds utility classes from look.ts to the card (fixed full-window sheet), the card body (centred 70ch column) and the title. The autosave status element is moved into the status line and back, so there is one live region; the word count is a plain span. Fullscreen is requested on the html element; a refusal keeps the window-filling sheet. Leaving returns focus to the entering control and restores scroll.

Banner: while the resume banner exists the mode is refused and the editor status says to choose Restore or Discard first; release() is never called; after Discard the mode enters. Preview, Add file and Add video are hidden with the mode. The authored-rules check in daisyui.test.ts now allows the html.editor-focus prefix. Side fix (not a criterion): the browser-copy resume banner formats its time with formatInTimezone and the site zone from a new data-autosave-timezone attribute, like the server banner; covered in autosave.test.ts.

Verification: pnpm build, pnpm test (cms 7250 pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check pass. Live check /tmp/m48-focus/scripts/live.mjs on a temp site at port 3497 in headless Chromium, 51 of 51: enter by button, Ctrl+Shift+F, Cmd+Shift+F; leave by Escape (body and title), shortcut, Exit, and document.exitFullscreen (headless granted fullscreen); a forced requestFullscreen rejection fills the window (sheet 1280x860 at 0,0); 19 hidden elements all inert and a Tab lap reaches only title, body and Exit; cursor, selection and document identical across enter and exit; scroll restored; word count 174 to 177 after three typed words, not a live region; autosave status shows Saved a copy inside the status line; Escape closes the CodeMirror search panel first; banner blocks button and shortcut with the message and autosave stays idle; both banners print CDT times; JS off has no button and nothing inert. About 73 monospace characters per line, line height 30.6px at 17px. Screenshots in /tmp/m48-focus: focus-light.png, focus-dark.png, focus-nord.png, focus-narrow.png.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the editor's distraction-free mode: a Write in focus button beside the Write/Preview tabs and Ctrl/Cmd+Shift+F hide everything but the title and body (hidden and inert), set them in a centred ~70ch sheet in the admin theme with a status line of word count, autosave status and Exit (no save button), request fullscreen with a window-filling fallback, and leave by Escape, the shortcut, Exit or leaving fullscreen with focus returned to the entering control. Refused while the resume banner waits for a choice. Pure logic in src/admin/focus-mode.ts with unit tests; wiring in editor/focus.ts; docs in docs/admin.md. Also made the browser-copy resume banner print its time in the site zone. Verified by the full pnpm gate and a 51-check headless Chromium run with light, dark and nord screenshots.
<!-- SECTION:FINAL_SUMMARY:END -->
