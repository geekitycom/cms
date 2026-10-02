---
id: TASK-218
title: Admin screen to manage syndication targets
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 17:46'
updated_date: '2026-10-02 17:59'
labels:
  - syndication
  - admin
milestone: m-25
dependencies:
  - TASK-155
  - TASK-156
priority: medium
type: feature
ordinal: 234800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Syndication targets (TASK-155, per-language fields from TASK-156) live in content/_data/syndicationTargets.json, and today the only way to add, change or remove one is to edit that JSON by hand. A bad entry is reported only in the boot log, which a site owner without shell access never sees. M26's breaking change tells owners to declare an IndieNews target to keep the old indienews link, so they need a way to do that from the admin. Follow the Navigation screen's precedent (packages/cms/admin/pages/navigation, src/admin/navigation.ts), which writes content/_data/site.json from the admin. The file stays the source of truth (decision-9, decision-26); the screen reads and writes it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An admin screen lists the declared targets and lets an administrator add, edit and remove one: id, name, url (with {lang}), optional tag and optional languages
- [x] #2 A save validates with the same rules parseSyndicationTargets uses (id pattern, http(s) url, unique ids, tag, language tags) and shows each problem on the form, leaving the file unchanged
- [x] #3 A save writes content/_data/syndicationTargets.json atomically and the change is offered at once in the post editor's Syndicate to checkboxes and Micropub q=syndicate-to
- [x] #4 Entries in the file that do not parse are shown on the screen with their problem, instead of only in the boot log
- [x] #5 Only users allowed to change site settings can reach the screen; others get the admin's usual refusal
- [x] #6 The screen is reachable from the admin navigation and documented in packages/cms/README.md's Syndication targets section
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Refactor src/webmention/syndication.ts: replace targetOf with exported checkSyndicationTarget(record) -> { target } | { problems: Partial<Record<field, sentence>> }, and syndicationEntries(text) that keeps every entry with its target or its problems. parseSyndicationTargets builds its log lines from them, so the file and the form share one validator.
2. New src/admin/syndication-targets.ts + admin/pages/documents/syndication.njk at /admin/syndication, registered as Posts > Syndication in menu.ts (beside Categories and Tags; Settings' children are the settings pages only, which settings-pages.test.ts enforces) and mounted in routes.ts behind the admin guard.
3. Screen: one panel per entry in file order, valid or not; a broken entry shows its problem. Each panel saves or removes by index, guarded by the entry's JSON as read. Add appends. A file that is not a JSON list is shown with its problem and never written.
4. Save: checkSyndicationTarget plus an id no other entry declares; problems re-render 400 with field errors and the file untouched; otherwise written under withFileLock with writeFileAtomicallySync, keeping unknown keys of the edited entry.
5. Tests first: src/admin/syndication-targets.test.ts over HTTP, unit tests in syndication.test.ts, form-errors/styles/menu tests extended.
6. README Syndication targets section; full checks; drive the form with curl against a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Placement: Posts > Syndication at /admin/syndication, not Settings. settings-pages.test.ts holds that Settings' children are exactly the settings pages, and Categories/Tags set the precedent that what is only about posts lives under Posts. Access is unchanged by this: the admin has one role, so any signed-in user may change site settings and the guard sends everyone else to the login form.
Validator: targetOf became checkSyndicationTarget (one sentence per bad field) and syndicationEntries (every entry with its target or problems, first id wins). parseSyndicationTargets, the boot log and the screen all use them. Boot log lines now read: '_data/syndicationTargets.json entry 2 ("bad") was ignored. The url must be ...'.
Concurrency: each panel carries its index and its entry's JSON as drawn; a save or remove re-reads the file under withFileLock and is refused with a flash when that JSON is no longer at that index. A file that is not a JSON list is never written over.
Unknown keys of an edited entry are kept. An empty tag or languages box removes the key.
Validation: pnpm build && pnpm test (3426 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Mutation checks: removing the uniqueness check, the stale guard, or the unknown-key merge each fails a test.
HTTP walk on a scratch site (port 3917, stopped after): anonymous GET and POST get 302 to /admin/login; bad add returns 400 with four field errors and no file written; add IndieNews with {lang} and languages writes the file and the editor offers syndicate-to-indienews; edit, remove, hand-broken entries shown with their problems, stale remove refused, invalid JSON file shown with its problem; Micropub q=syndicate-to listed bluesky on the request after it was added (token issued with issueTokens).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Posts > Syndication (/admin/syndication), an admin screen that lists, adds, edits and removes the syndication targets in content/_data/syndicationTargets.json. The file stays the source of truth. Validation is one shared function (checkSyndicationTarget plus syndicationEntries in src/webmention/syndication.ts) used by the file parser, the boot log and the form, so each problem shows on its field and a refused save leaves the file alone. Saves are atomic under the file lock, guarded against a change made elsewhere, and keep unknown keys. Entries that do not parse are drawn with their problem and can be fixed or removed. The README's Syndication targets section describes the screen and how to declare IndieNews. Verified with src/admin/syndication-targets.test.ts (15 HTTP tests, one per AC behavior, including editor checkboxes and Micropub q=syndicate-to seeing a save on the next request), the full build/test/typecheck/lint/format run, and a curl walk of the form against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
