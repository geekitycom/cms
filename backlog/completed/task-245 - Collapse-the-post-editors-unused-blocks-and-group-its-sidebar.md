---
id: TASK-245
title: Collapse the post editor's unused blocks and group its sidebar
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:52'
updated_date: '2026-10-03 19:00'
labels:
  - admin
  - accessibility
dependencies: []
references:
  - packages/cms/admin/pages/documents/editor.njk
  - packages/cms/admin/static/admin.css
priority: medium
type: enhancement
ordinal: 260800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The post editor (packages/cms/admin/pages/documents/editor.njk) shows every block at full size: in the main column Photos (with an empty 'Add a photo' row), Location (six boxes) and Recording (with 'Other versions' and an empty 'Add a version' row); in the side column about twenty fields in one flat list (Slug, Permalink, Date, Tags, Categories, In reply to, Like of, Repost of, Bookmark of, Read, Description, Language, Author, Draft, Visibility, Pinned, Syndicate to, Comments, Hide from collections, Contact form). Most posts use few of them, so the page is mostly empty boxes.

Use native <details>/<summary> so it works without JavaScript and stays keyboard and screen-reader accessible (the accessible-by-default milestone). A block or group is open when any field in it has a value or a validation error, and collapsed when it is empty, so nothing filled in is ever hidden and an error-summary link always lands on a visible field. Proposed sidebar groups: Publishing (Draft, Date, Visibility, Pinned, Author; open by default), Tags and categories (open by default), Address (Slug, Permalink), Responding to (In reply to, Like of, Repost of, Bookmark of), Read, Summary and language (Description, Language), Syndicate to, Display and discussion (Comments, Hide from collections, Contact form). Pages show only the groups that apply to them. The Read status option 'Not a read' becomes 'Not a read post'; the others stay Want to read, Reading, Finished.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Photos, Location and Recording (and Recording's Other versions, and each empty Add a photo / Add a version row) are collapsed when empty and open when any field in them has a value
- [x] #2 The sidebar fields are grouped as described, each group collapsed when empty except Publishing and Tags and categories, which start open
- [x] #3 A save refused with a field error re-renders with that field's block or group open, and the error summary link reaches it
- [x] #4 Everything works without JavaScript; summaries are reachable and operable by keyboard and announce their open state (native details/summary)
- [x] #5 The Read status option reads 'Not a read post'
- [x] #6 Existing editor tests pass; new tests cover open/closed state for an empty post, a filled post and a refused save; styles.test.ts covers any new classes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Refusals name the field they are about: writeDocument's refused outcome gains an optional field (the editor control's id); the read, recording, photo and location resolvers return the id of the box their error is about. Micropub keeps reading only the message.
2. One view model decides what is open: src/admin/editor-layout.ts maps each editor group (photos, location, recording, other versions, publishing, taxonomy, address, responding, read, summary, syndication, display) to whether it has a value or owns the refused field; Publishing and Tags and categories are always open. Rows of photos and versions open when they hold an address.
3. editor.njk: every block and sidebar group is a native details/summary (one macro), with a fieldset and visually hidden legend inside so fields keep their group name; groups render only for the kinds they apply to. The refused save uses the shared error summary (field.summary/problem) linking to the field, which carries aria-invalid and its error line.
4. Read status option reads 'Not a read post'.
5. CSS for the new group classes; editor.njk joins styles.test.ts SCREENS and form-errors.test.ts covers it automatically.
6. Tests first: empty post, filled post, refused save (per group) open/closed state over HTTP; then build, test, typecheck, lint, format, and a Playwright pass with screenshots.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Refusals now name their box: writeDocument's refused outcome is Refusal {message, field?}, field being the editor control's id (EditorField). The read, recording, photo and location resolvers return FieldError {error, field}; Micropub still reads only the message. src/admin/editor-layout.ts holds the one table of groups (what fills each, which box ids it owns) and openGroups(form, refusedField); renderEditor passes its result as open. editor.njk draws every block and group through one group() macro: details/summary with a fieldset and visually hidden legend inside, so each box keeps its group name for a screen reader. Photo and version rows open when they hold an address, the same condition that already names them Photo n / Add a photo. The refused editor now uses the shared field.summary/field.problem, marks the box aria-invalid with its error line, so form-errors.test.ts covers editor.njk automatically. tiedErrors (src/__testing__/form-errors.ts) now lets a control's aria-describedby name a hint beside its error: a valid control may point at hints but at no *-error id; an invalid one names exactly one. Address is open on every saved document, since slug and permalink always hold a value there. posts.test.ts asserted <legend>Photos/Add a photo/Recording</legend>; those three assertions now read <summary>.

Validation: pnpm build && pnpm test (3822 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. New src/admin/editor-layout.test.ts: empty post, page, filled post, nine refusal kinds over HTTP plus an openGroups unit test; mutation check (dropping the refused-field clause) fails the unit test. Chromium 1234 via playwright-core with JavaScript off: empty post folds all but Publishing and Tags; filled post opens every group and keeps Add a photo / Add a version folded; a save refused for Language comes back 400 with the summary focused, Summary and language open, Tab then Enter on the link lands on #editor-lang (visible, aria-invalid, described by error and hint). Tab reaches a summary; Enter opens, Space closes; CDP accessibility tree reports DisclosureTriangle expanded false then true, and the Language box sits in a group named Summary and language. With JavaScript on, CodeMirror loads and all 14 disclosures render.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The post editor folds what a post does not use. Photos, Location and Recording (with Other versions and each blank Add a photo / Add a version row) and the side column's new groups (Publishing, Tags and categories, Address, Responding to, Read, Summary and language, Syndicate to, Display and discussion) are native details/summary, open when they hold a value or the refused box; Publishing and Tags and categories always start open, and a page shows only Publishing, Address, Summary and language and Display and discussion. Open state is one table in src/admin/editor-layout.ts. A refused save now names its box: the shared error summary links to it, the box is aria-invalid with its error line, and its group is open. The read status option reads Not a read post. Verified by the full suite, typecheck, lint, format check, and a JavaScript-off Chromium run over an empty post, a filled post, a refused save and keyboard operation of a summary.
<!-- SECTION:FINAL_SUMMARY:END -->
