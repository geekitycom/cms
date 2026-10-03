---
id: TASK-243
title: Accept a Micropub visibility value in any case
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:39'
updated_date: '2026-10-03 16:56'
labels:
  - micropub
  - interop
dependencies: []
references:
  - 'https://github.com/gRegorLove/indiebookclub'
  - packages/cms/src/micropub/create.ts
priority: medium
type: bug
ordinal: 258800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
indiebookclub (0.18.0 on shll.me) posted a read with visibility 'Public' and got 400 'visibility is public or unlisted, not Public.' It builds its Visibility select from q=config's visibility list but ucfirsts each value and submits the label (get_visibility_options in app/Helper/Utils.php, gRegorLove/indiebookclub), so it always sends Public or Unlisted. Every indiebookclub post fails until this is fixed.

Compare a Micropub visibility value case-insensitively at the boundary (create and update in packages/cms/src/micropub/) and store the lowercase value. Front matter stays strict: a hand-typed visibility: Public in a file is still unrecognized and hides the post, as the TASK-227 store test pins. q=config keeps advertising lowercase values.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Micropub create or update with visibility Public, PUBLIC or Unlisted is accepted and stores public (no key) or unlisted
- [x] #2 A value that is not public or unlisted in any case is still refused with its message; private keeps its own message
- [x] #3 Front matter with visibility: Public still reads as unrecognized
- [x] #4 indiebookclub's request as App activity recorded it (summary, read-status finished, read-of h-cite, post-status published, visibility Public, category books) answers 201 in a test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests first in packages/cms/src/micropub/quill.test.ts (visibility block): Public, PUBLIC and Unlisted on a create and an update store no key or unlisted; Private keeps the private message; Followers keeps its message with the value as sent.
2. Failing test in indiebookclub.test.ts replaying the App activity request (summary, read-status finished, h-cite read-of, post-status published, visibility Public, category books) and expecting 201.
3. In createForm (create.ts) lowercase the visibility text before isVisibility and the private check; the error echoes the value as sent. updateForm runs through createForm, so update follows.
4. Leave visibilityOf (front matter) strict; the TASK-227 store test row 'Public' stays as the AC #3 proof.
5. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
createForm (packages/cms/src/micropub/create.ts) lowercases the visibility text before it checks it, so Public, PUBLIC and Unlisted are accepted and stored as no key or unlisted. updateForm builds its fields through createForm, so update follows without its own change. A refusal still echoes the value as sent ('not Followers.'), and Private gets the private message. visibilityOf in content/visibility.ts is untouched, so front matter stays strict.
Tests written red first: quill.test.ts visibility block (Public, PUBLIC, Unlisted on a create and on an update; Private and Followers refused with their messages) and indiebookclub.test.ts (the App activity request: summary, read-status finished, h-cite read-of, post-status published, visibility Public, category books -> 201, no visibility key, tags [books]). The test rebuilds the request from the fields the AC lists, not from a byte-for-byte capture.
AC #3 proof: the TASK-227 store.test.ts row 'Public' (not served, not listed) still passes.
Validation: pnpm build && pnpm test (3672 + 30 pass, 0 fail) && pnpm typecheck && pnpm lint && pnpm format:check, all exit 0. Not checked against shll.me; indiebookclub on the live site works after this ships in a release.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Micropub now accepts a visibility value in any case and stores it lowercase. indiebookclub sends ucfirst labels (Public, Unlisted), so every one of its posts got a 400 before. The change is one lowercase in createForm, which covers create and update. Front matter stays strict, and q=config still advertises lowercase values. Verified with new red-then-green tests in quill.test.ts and indiebookclub.test.ts, the unchanged TASK-227 store test for front matter, and the full build, test, typecheck, lint and format check.
<!-- SECTION:FINAL_SUMMARY:END -->
