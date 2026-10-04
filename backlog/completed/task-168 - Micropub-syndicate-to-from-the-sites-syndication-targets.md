---
id: TASK-168
title: Micropub syndicate-to from the site's syndication targets
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:55'
updated_date: '2026-10-02 16:41'
labels:
  - micropub
  - webmention
  - indieweb
milestone: m-25
dependencies:
  - TASK-155
  - TASK-164
  - TASK-167
references:
  - 'https://www.w3.org/TR/micropub/#syndication-targets'
priority: low
type: feature
ordinal: 192800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-155 gives a site a list of syndication targets and lets a post select them with a syndicate-to front matter list. Expose that list to Micropub clients so they can offer it as checkboxes: q=config and q=syndicate-to list each target's uid and name, and mp-syndicate-to on a create or update selects targets exactly as the editor checkbox does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 q=syndicate-to and q=config list every declared target with uid and name, and an empty list when none are declared
- [x] #2 mp-syndicate-to on create writes the selected targets to the post, and the post is syndicated as an editor post would be
- [x] #3 An unknown target uid gets 400 invalid_request naming it, and no file is written
- [x] #4 An update can add or remove targets, with the same effect as changing the checkboxes in the editor
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: the site's declared SyndicationTarget[] (syndicationTargetsReader) is the one source; Micropub sees each as { uid: id, name }.
2. endpoint.ts: drop the empty SYNDICATE_TO constant; QueryContext carries the declared targets, read per request, and q=config / q=syndicate-to map them to { uid, name }.
3. create.ts: CreateSite gains the declared targets; mp-syndicate-to joins PROPERTIES and fills form.syndicateTo (deduped). A value that is not text, or names no declared target, is an error naming it, so the create is refused 400 invalid_request before any file or photo is written.
4. update.ts: UPDATABLE gains mp-syndicate-to -> syndicateTo; sourceProperties reports the post's declared syndicate-to ids as mp-syndicate-to so add/delete start from the current selection and a client can read it back. Undeclared ids stay in the file through resolveExtra, as in the editor.
5. Tests first in micropub/syndicate.test.ts: queries list targets; create writes syndicate-to and sends the webmention to the target and keeps its copy; unknown uid 400 naming it with no file; update add and delete change syndicate-to and notify the deselected target.
6. README Micropub section: document syndicate-to.
7. Verify: pnpm build, test, typecheck, lint, format:check; curl q=config and a create against a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Declared targets are read per request with syndicationTargetsReader and handed to the queries and to createForm/updateForm through CreateSite.targets, so a target added by hand is offered and accepted at once.
mp-syndicate-to fills form.syndicateTo (deduped). An uid the site does not declare is a createForm error, so the create or update is refused 400 invalid_request naming it before any photo or post file is written.
q=source reports mp-syndicate-to with only the declared ids, so add/delete start from the current checkbox state; ids in the file that name no declared target stay in the file, as through an editor save.
Found and fixed on the way: resolveExtra appended kept undeclared ids to form.syndicateTo, and a Micropub update's form (loaded by formFor) already held them, so any TASK-167 update of a post listing an undeclared id duplicated it. It now dedupes. Covered by 'leaves the targets as they were when an update does not name them'.
Validation: new src/micropub/syndicate.test.ts (11 tests; failed first for each AC). pnpm build, pnpm test (3357 + 30 pass), typecheck, lint, format:check all pass. HTTP check against a throwaway server on :4168 with two targets: q=syndicate-to and q=config list both as {uid,name}; a form create with mp-syndicate-to[]=myspace got 400 'mp-syndicate-to names no syndication target myspace.' and no posts dir was created; a create with news wrote syndicate-to: [news]; update add bridgy.fed gave 204 and [news, bridgy.fed]; q=source&properties[]=mp-syndicate-to answered both; update delete news gave 204 and [bridgy.fed], and the page links to the remaining target only. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Micropub clients now see and select the site's syndication targets. q=config and q=syndicate-to list each target in content/_data/syndicationTargets.json as {uid: id, name}, or [] when none. mp-syndicate-to on a create or update writes the post's syndicate-to through the editor's write path, so the post is sent to its targets and a deselected target is notified, as with the checkboxes. q=source reports the selection. An undeclared uid gets 400 invalid_request naming it and nothing is written. Also fixed resolveExtra duplicating undeclared syndicate-to ids on Micropub updates. README Micropub section documents it. Verified with src/micropub/syndicate.test.ts, the full pnpm build/test/typecheck/lint/format:check run, and curl against a running server.
<!-- SECTION:FINAL_SUMMARY:END -->
