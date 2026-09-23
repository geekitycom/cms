---
id: TASK-97
title: >-
  An edit user page: the users list links to one screen per user, with labelled
  fields
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 01:02'
updated_date: '2026-09-20 01:51'
labels:
  - admin
  - web
dependencies: []
references:
  - packages/cms/admin/layouts/users.njk
  - packages/cms/src/admin/users.ts
  - packages/cms/src/admin/documents.ts
  - packages/cms/src/admin/menu.ts
  - packages/cms/src/admin/templates.ts
  - packages/cms/admin/layouts/settings
type: feature
ordinal: 122800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
/admin/users puts every editable field of every user in the table itself. One row carries an inline profile form of six boxes, an email form, a switch form per notice and a frequency select, each a separate POST. The labels on all of them are `admin-visually-hidden`, so what a sighted person gets is a grid of unlabelled boxes told apart only by placeholder text, and placeholder text disappears as soon as there is a value in the box. Three Save buttons in one row do three different things. The screen is hard to read and easy to get wrong.

Split it the way the document screens are already split (documents.ts:275 is the pattern: a list, then `basePath/:slug` for one of them).

The list keeps: username with the archive URL under it and the (you) marker, email, created, and an Actions column holding Edit and, where the account can go, Delete. No editable field stays in the table.

A new screen at `/admin/users/<id>` edits one user, with every field labelled and visible:
- Account: the username, not editable, with the stored actor id note where there is one (it is what the fediverse holds and must not change here); the email address.
- Profile: display name, bio, avatar, job title, location, links, each with its own visible label, and the hint about what is public kept with them.
- Email me about: the notice switches and, where the registry says a notice is batched, its frequency.
- Change your password, only on your own page. It is about whoever is signed in, so it does not belong on somebody else's.
- Delete, where the account can go, with the refusal shown where it cannot.

The POST handlers already take the user id in a hidden field and already exist; what changes is where they redirect, which becomes the edit page rather than the list, so a save shows its own result. `/admin/users/new` must keep working as the add screen and must not be read as a user id.

Out of scope: roles, sorting or paging the list, and any change to what a profile means on the public site.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /admin/users lists username, email and created with an Edit link per row, and holds no field that edits a user, proven by a test
- [x] #2 GET /admin/users/<id> renders that user's account, profile and notice settings, every field with a visible label bound to it, proven by a test that finds a label for each input
- [x] #3 Saving the email, the profile, a notice switch or a notice frequency from that page returns to that page and shows what changed, proven by a test for each
- [x] #4 Change your password appears on your own page and on nobody else's, and still signs other browsers out, proven by a test
- [x] #5 Delete is on the edit page where the account can go, and says why where it cannot, proven by a test
- [x] #6 GET /admin/users/new is still the add screen, and an id that matches no user answers 404
- [x] #7 The admin menu still reaches the list, and the edit page renders inside the same chrome with its own title
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add `editUserPath(id)` and an `ADMIN_TEMPLATES.user` (`layouts/user.njk`) beside the existing users template.
2. Register `GET /admin/users/:id` after `GET /admin/users/new`, guarded by a digits-only id so `new` (and the POST-only paths) can never be read as one; an id no user has answers 404.
3. Leave every POST handler's reading and writing alone and change only where it lands: email, profile, notice switch and notice mode redirect to `editUserPath(target.id)`; a refused email redraws there too; delete still lands on the list because the row is gone; change-password redirects to, and redraws its 400 on, the signed-in user's own page.
4. Strip every editable field out of `layouts/users.njk`'s table: username with the archive URL, the (you) marker and the stored actor id note, email, created, and an Actions column holding Edit and — where the account can go — Delete. The add form stays in that template behind `adding`.
5. Write `layouts/user.njk`: Account (username read-only, the stored actor id note, the email field), Profile (display name, bio, avatar, job title, location, links), Email me about (the switch per notice with its description visible, and the how-often select where the registry says batched), Change your password only on your own page, and Delete or the refusal that explains why not. Every input, textarea and select carries a visible `<label for>`; the existing hints move to the fields they are about.
6. Add the CSS the new screen needs to `admin/static/admin.css` and drop what only the old table cells used.
7. Tests first, in `packages/cms/src/admin/users.test.ts`: the list carries no editing field and one Edit link per row; the edit page labels every field (a test that pairs every non-hidden input id with a visible label); each of the four saves returns to the edit page and shows the new value; change-your-password is on your page and not on anybody else's and still ends other sessions; delete is offered or refused on the page; `/new` still adds and an unknown id is a 404; the menu still marks All users and the page has its own title. Existing tests that drove the old inline forms move to the new page.
8. Update the README route table and the prose that says the profile is edited on `/admin/users`.
9. Verify with pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built test-first, one acceptance criterion at a time.

**Routes.** `editUserPath(id)` and `GET /admin/users/:id`, registered last and guarded by a digits-only `pathId`, so `new`, `password`, `email`, `profile`, `notifications` and `delete` can never be read as somebody's id and a typed URL answers 404 rather than `NaN`. Every POST handler's reading and writing is untouched; only where it lands changed. Email, profile, notice switch and notice mode now redirect to `editUserPath(target.id)`, including their refusals, so a Save shows its own result beside the box it is about. Delete still lands on the list, because the row is gone. Change-password redirects to the signed-in user's own page and redraws its 400 there.

**Templates.** `layouts/users.njk` is now a listing: username linking to the edit page with the archive URL under it and the (you) marker, email, created, and Actions with Edit and — where the account can go — Delete. The profile boxes, the email box, the notice switches, the how-often selects, the two hints and the change-password form all left it. `layouts/user.njk` is new: Account (username read-only with the archive link and the stored actor id note, then the email address), Profile (six labelled fields), Email me about (a switch per notice with its description now visible rather than a `title` attribute, and the how-often select behind a visible label), Change your password only on your own page, and Delete or the refusal. The old hints were kept and moved to the fields they are about.

**One bug found by looking at the real screen.** The screen data first called its subject `user`, which is the key `renderAdmin` already uses for whoever is signed in — so the top bar read "Signed in as grace" on grace's page. Renamed to `account`, with a regression test.

**CSS.** `.admin-profile` went with the table cell it was for; `.admin-field-static` and `.admin-notice` came in.

**Docs.** Both READMEs: the route table gains `/admin/users/<id>`, and the prose that said the profile, the stored actor id and the notices are edited on `/admin/users` now points at the user's own screen.

Validation: `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` all pass (1954 + 30 tests). Also booted a throwaway site over temp directories on port 4173 and looked at both screens in a browser with the admin stylesheet on them; server stopped and the scratch files removed.

Follow-up from the maintainer, same day: the notices panel is now headed 'Email <username> about' rather than 'Email me about', which read oddly when you were editing somebody else, and the switches are only drawn once the account has an address. With the box empty the panel keeps its heading and says why there is nothing in it, rather than vanishing: the switches decide what is sent to that address, so without one every switch could be on and the site would still send this person nothing.

Three older tests rendered the switches for a user with no address and had to give it one first; they share a withEmail helper now. One new test covers both states.

Second follow-up: the notices panel is also kept back while the site has no mail provider. A switch there would decide what goes out of a site that can put nothing out at all — c.var.mail.configured() is already on the screen, and the email hint above already said the site sends no mail yet. The panel now names which piece is missing, the address or the provider, and links to Settings > Email for the second.

Tests for the switches needed a site that could really send, so users.test.ts has a siteSendingMail helper: a provider in site.json and a credential on disk. Rendering sends nothing, so the key is never used.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split /admin/users into a listing and one screen per user. The table is now username (linking to the edit page, with the archive URL under it), email, created, and Actions with Edit and Delete — no box on it edits anybody. /admin/users/<id> holds the account and its email address, the public profile, what this person is emailed about, Change your password on your own page only, and the Delete or the sentence saying why this account cannot go, every field with a visible label bound to it. The existing POST handlers were reused unchanged apart from where they redirect, which is now that user's page, so a Save shows its own result. /admin/users/new keeps its URL behind a digits-only id guard and an unknown id answers 404.

Verified with 14 new HTTP tests in packages/cms/src/admin/users.test.ts (one per acceptance criterion, plus a label-for-every-box sweep and a regression test for the chrome's "Signed in as"), the four moved tests that used to drive the inline forms, and pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, all passing. Both screens were also looked at in a browser on a throwaway site.
<!-- SECTION:FINAL_SUMMARY:END -->
