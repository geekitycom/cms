---
id: TASK-98
title: 'One field macro for the admin forms, so a labelled box is written once'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 01:57'
updated_date: '2026-09-20 02:12'
labels:
  - admin
  - web
dependencies: []
references:
  - packages/cms/admin/layouts/settings/page.njk
  - packages/cms/admin/layouts/settings/general.njk
  - packages/cms/admin/layouts/user.njk
  - packages/cms/admin/layouts/shell.njk
  - packages/cms/admin/static/admin.css
  - packages/cms/src/admin/templates.ts
type: task
ordinal: 123800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin is consistent in three layers and by nothing else below them. `layouts/base.njk` is the document, `layouts/shell.njk` is the signed-in chrome, and `layouts/settings/page.njk` gives the six settings pages one heading, one form and two blocks to fill. Under that there are no components at all: the only `{% include %}` in the whole admin is the flash, and there is not one macro. Every one of roughly 75 form fields across 16 templates writes its own `<label for>`, control, `admin-hint` and `admin-field-error` by hand, against a class vocabulary each template has to remember.

That is how /admin/users drifted (TASK-97): it used `admin-visually-hidden` labels no other screen used, and nothing said it was wrong. A field written once cannot drift, and a screen written out of it cannot forget the error line or leave a label unbound.

Add one partial of macros — a text box, a textarea, a select, a checkbox, a password — each taking the id, the name, the label, the value and optional hint, error, and whatever plain HTML attributes that control needs (required, autofocus, readonly, disabled, inputmode, autocomplete, rows, type). Each emits the label bound to the control by id, the control, the hint where there is one, and the field error where there is one, in the order and the classes the admin already uses.

Then write the existing screens out of it, keeping the rendered HTML the same where it is already right: the six settings pages, the user edit page and the add-user form, and the signed-out screens (login, setup, forgot, reset) if their fields fit without contortion. `layouts/document-editor.njk` is expected to stay as it is — its fields are wired to the editor bundle and laid out by it — but say so in the notes rather than leaving it unexplained.

This is a refactor. No screen should look different afterwards, except where a screen was missing a hint or an error line that its neighbours all had, and any such change should be called out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One partial holds the macros, each emitting a label bound to its control by id, the control, an optional hint and an optional field error, in the admin's existing classes
- [x] #2 A test renders every macro and every optional part of it, including a field with an error and one without
- [x] #3 The six settings pages, the user edit page and the add-user form are written out of the macros, with no hand-written label and control pair left in them
- [x] #4 The rendered HTML of those screens is unchanged where it was already right, proven by the existing tests still passing untouched
- [x] #5 Any screen left alone is named in the implementation notes with the reason
- [x] #6 The macros pass through the attributes the existing fields use: required, autofocus, readonly, disabled, inputmode, autocomplete, rows and the input type
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add `packages/cms/admin/layouts/_fields.njk`: macros `text`, `password`, `textarea`, `select` (options via {% call %}/caller()), `checkbox`. Each emits <label for> + control + optional <p class="admin-field-error"> + optional <p class="admin-hint">, in that order, because that is the order every existing screen already uses. It lives under PACKAGED_ADMIN_DIR, whose FileSystemLoader is the admin's only search root, so no site theme can shadow it.
2. TDD: new `packages/cms/src/admin/fields.test.ts` renders the partial through `createAdminTemplateEnvironment()` and covers every macro, every optional part (hint present/absent, error present/absent), the pass-through attributes (required, autofocus, readonly, disabled, inputmode, autocomplete, rows, type, min/step, placeholder, spellcheck), label/control binding by id, and escaping of values and error text.
3. Convert screen by screen, running the matching test file after each: settings/general, settings/reading, settings/permalinks, settings/discussion, settings/email, settings/federation, layouts/user.njk, the add-user form in layouts/users.njk, then login/setup/forgot/reset.
4. Keep attribute emission in the order the existing templates overwhelmingly use (id, name, type, min, step, inputmode, autocomplete, value, placeholder, spellcheck, required, autofocus, readonly, disabled) so the rendered HTML moves as little as possible; report every field whose attribute order does move.
5. Leave layouts/document-editor.njk alone (its fields are wired to the editor bundle) and say so in the notes, along with every other screen not touched.
6. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, with no existing test edited.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

`packages/cms/admin/layouts/_fields.njk` holds five macros — `text`, `password`, `textarea`, `select`, `checkbox` — each emitting, in order: the `<label for>` bound to the control by id, the control, the field error, the hint. Error before hint, because that is the order every existing screen already used; the task description's wording said hint first, and following it would have moved the error paragraph on ten fields for nothing.

A sixth, private `_below` macro emits the two paragraphs, so the ordering is written once. `select` takes its options from the body of a `{% call %}`, because which option is `selected` is the caller's business and an option's label is markup as often as it is a word. An `errorHtml` argument takes the rare second error paragraph a field has — the Reading page's "that page is no longer published" — which is why that screen's output did not move.

`label` and `hint` are written into the page as markup: the admin's labels and hints carry `<code>`, `<em>` and links. They are template literals, and a hint that interpolates a value is captured with `{% set … %}…{% endset %}`, which escapes what it interpolates before the macro sees it. `error` is a message from the server and is escaped.

The partial sits under `PACKAGED_ADMIN_DIR`, which `src/admin/templates.ts` gives the admin environment as its only `FileSystemLoader` root. A site's theme overrides public templates only and cannot reach in here, so no theme can shadow or break a field on the login form (decision-4, decision-15).

## Screens converted

Twelve templates, all now with zero hand-written `<label>`: the six settings pages (general, reading, permalinks, discussion, email, federation), `layouts/user.njk`, the add-user form in `layouts/users.njk`, and the four signed-out screens (login, setup, forgot, reset), whose fields fitted without contortion.

## Screens left alone, and why

- `layouts/document-editor.njk` — as expected. Its fields are wired to the editor bundle and laid out by it: the body is a CodeMirror mount, the slug box is driven by the title box through `slug.js`, the tag and category boxes have controls of their own, and several fields sit in a sidebar grid rather than in the label-over-control column these macros emit.
- `layouts/media.njk`, `layouts/taxonomy.njk`, `layouts/comments.njk` — the boxes inside their table rows carry `admin-visually-hidden` labels on purpose: the column heading is the label the eye reads, and one per row would repeat it down the page. That is the opposite of the TASK-97 drift, where a whole screen of editable fields hid its labels. Media's one full-width field is a file input, which these macros do not cover.
- `layouts/document-conflict.njk` — two readonly textareas with `aria-label`, side by side, and no label to print.
- `layouts/document-list.njk`, `layouts/messages.njk`, `layouts/themes.njk`, `layouts/federation.njk`, `layouts/shell.njk`, `layouts/settings/page.njk` — every box in them is a hidden field inside a button's form. A hidden field is not a labelled box.
- `layouts/dashboard.njk`, `layouts/placeholder.njk`, `layouts/base.njk`, `layouts/_flash.njk` — no fields at all.

## What moved in the rendered HTML

Every one of the thirty screen states below was rendered before and after the refactor through the real HTTP stack — six settings pages, each also in its refused state with every field error showing; Reading again with a homepage and a posts page that are no longer published; General again with baseUrl pinned by the config so the field is readonly and disabled; the users list; the add-user form, clean and refused; a user's own screen with the notice switches showing, somebody else's, and one with the password panel's errors; and login, setup, forgot, reset, each clean and refused. Three things moved, and nothing else:

1. **`value=""` appears on ten boxes that had no `value` attribute** — nine password boxes (login, setup ×2, reset ×2, add-user, and the three on Change your password) and the forgot form's identifier box. The `password` macro always writes `value=""` and offers no way to set one, which is the guarantee: nothing typed into a password box is ever printed back. An absent `value` and `value=""` render identically.
2. **`value` now follows `inputmode` and `autocomplete` instead of preceding them, on four fields** — `settings-base-url`, `settings-notify-server`, `settings-mail-smtp-host`, `settings-mail-smtp-user`. Attribute order only. The macro writes one order; these four were the only fields written the other way round, and the other seventy-odd matched the macro's order exactly.
3. **One deliberate fix, called out as the task asks.** `settings-mail-smtp-secure` on Settings › Email was the one switch in the admin written as `<label class="admin-checkbox">` wrapped round its tick. `admin-checkbox` has no rule in `admin.css` and never had one, so that switch rendered unstyled while every other switch on the site uses `<p class="admin-check">` with the label beside the box. It now looks like its neighbours. This is a visible change, and the only one.

Plus whitespace inside one `admin-hint` paragraph on Settings (the base URL note), which is collapsed by HTML anyway.

No existing test was touched: `git diff --name-only -- '*.test.ts'` is empty.

## Validation

- `pnpm build` clean.
- `pnpm test`: 2008 pass / 0 fail in `@geekity/cms`, 30 pass / 0 fail in the demo. The 52 new tests in `src/admin/fields.test.ts` are part of the 2008.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: clean.
- `grep -c '<label'` is 0 in all twelve converted templates.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added packages/cms/admin/layouts/_fields.njk: five macros (text, password, textarea, select, checkbox) that each write a label bound to its control by id, the control, an optional field error and an optional hint, in the classes and the order the admin already used. It sits under PACKAGED_ADMIN_DIR, the admin environment's only template root, so no site theme can shadow it.

Twelve templates were written out of it and now carry no hand-written label at all: the six settings pages, layouts/user.njk, the add-user form in layouts/users.njk, and login, setup, forgot and reset. layouts/document-editor.njk was left as it is, its fields being wired to and laid out by the editor bundle; every other untouched screen is named in the notes with its reason.

Verified by rendering thirty screen states through the real HTTP stack before and after — every settings page clean and refused, Reading with unpublished pages, General with baseUrl pinned, the user screens with and without the notice panel, and every signed-out form clean and refused — and diffing them. Three things moved: value="" now appears on ten boxes that had no value attribute (nine passwords and the forgot identifier, rendering identically); value follows inputmode/autocomplete rather than preceding it on four fields, an attribute-order change only; and the SMTP TLS switch, the one switch written in admin-checkbox — a class admin.css has no rule for — now uses admin-check like every other switch, so it is styled at last. That last one is the only visible change and is called out in the notes.

pnpm build, typecheck, lint and format:check are clean; pnpm test is 2008 + 30 passing with no existing test edited, and 52 new tests in src/admin/fields.test.ts cover every macro, every optional part, and every pass-through attribute.
<!-- SECTION:FINAL_SUMMARY:END -->
