---
id: TASK-237
title: 'Keep Micropub properties the site does not understand, privately'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:05'
updated_date: '2026-10-03 17:21'
labels:
  - micropub
  - interop
  - privacy
dependencies: []
references:
  - packages/cms/src/micropub/create.ts
  - packages/cms/src/content/locations.ts
  - 'https://micropub.rocks/'
priority: medium
type: feature
ordinal: 252800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-27 refuses any Micropub property the site cannot map ('This endpoint does not understand X'). micropub.rocks test 204 ('Create an h-entry post with a nested object') expects an endpoint to store a property it does not understand and still publish the rest of the post; checkin is only its example. Clients also send extension properties (Quill's location was one), and each refusal fails the whole post.

Change decision-27: keep an unknown property instead of refusing it, but never in front matter. content/ may be a public git repository, so a raw nested object (a checkin's coordinates, say) written there would be public whatever Settings > Privacy says (decision-29). Keep unknown properties in a private file under dataDir, mode 0600, keyed by permalink and moved with the post, the way data/locations.json is (decision-29). They are not published or rendered anywhere. Properties the site does understand keep their real handling: TASK-236 maps checkin onto the post's location, so it can be shown when sharing allows.

To decide while building and record in decision-27: whether the private store keeps values verbatim (mf2 JSON) with a size cap per post; how legacy aliases and accepted-without-effect properties (p3k-content-type, a read's summary) are treated, which stay as they are; and whether reserved mp-* commands the site does not support are still refused (they are instructions, not data).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Micropub create with a property the site does not understand answers 201, publishes the rest of the post, and keeps the property in a private file under dataDir, not in front matter or anywhere under content/
- [x] #2 q=source returns the kept properties as they were sent, and update (replace, add, delete) and delete of the post handle them; a post that moves keeps them
- [x] #3 No kept property appears on any public surface (page, .md, .json, feeds, ActivityPub object, search, llms.txt), proven by a test that searches each
- [x] #4 Unsupported mp-* commands are still refused; decision-27 records the new rule and its limits
- [x] #5 micropub.rocks test 204's request answers 201 even before TASK-236, and README's Micropub section, micropub.rocks results and the Personal data table are updated
- [x] #6 A create whose only properties are ones the site does not understand (Quill's weight post: weight as an h-measure plus published) is refused with 400 invalid_request naming them, rather than publishing an empty post
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extract the permalink-keyed private JSON store from content/locations.ts into content/permalink-file.ts (read/set/move, 0600, atomic, per-file lock, write only on change); locations.ts becomes one call to it.
2. Add content/kept-properties.ts: data/kept-properties.json, permalink -> mf2 properties verbatim ({ name: [values] }), parsed as an object of non-empty arrays.
3. createForm (micropub/create.ts): a property it does not understand is kept, not refused. An unsupported mp-* name is still refused as a command. A File value of a kept property is refused. Kept properties over 16 KiB of JSON are refused. A create that keeps properties and carries none of content, name, photo, in-reply-to, like-of, repost-of, bookmark-of, read-of is refused naming them (AC #6). Legacy names and accepted-without-effect properties stay as they are.
4. writeDocument takes keptProperties: undefined leaves the entry (the editor), a value replaces it; a permalink move moves it, as the location does. Trash and restore keep it.
5. sourceProperties answers kept properties a site still does not understand; updateForm applies replace/add/delete to them and hands the result to the write.
6. Tests first for each AC: create/keep/0600/no content/, q=source, update ops, delete+undelete, re-dated move, public-surface sweep, mp-* refusal, micropub.rocks 204 replay, Quill weight refusal. Adjust the old refusal tests (create, update, post-types).
7. Amend decision-27, README Micropub section, micropub.rocks results, Personal data; packages/cms/README personal data table.
8. pnpm build/test/typecheck/lint/format:check; curl a running site for test 204.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-03: Quill's weight editor (reachable by URL though q=config hides it) sent type h-entry, weight [h-measure num 317 unit lbs], published, and nothing else; App activity shows 400 'does not understand weight'. Under this task's rule it would be kept privately and an empty post published at /…/untitled/, so a create with nothing the site can publish is refused. Weight is health data: publishing it would be its own post type and its own privacy choice, not part of this task.

Built as planned. Decisions (recorded as a TASK-237 amendment appended to decision-27; the backlog CLI has no decision edit command, so the amendment was appended to the decision file the way the TASK-222..233 amendments were):
- Store: data/kept-properties.json, mode 0600, keyed by permalink. content/locations.ts's store was extracted into content/permalink-file.ts (permalinkFile<T>), and both files are one call to it, so kept properties are kept, moved and left exactly as locations are. writeDocument takes an optional keptProperties: Micropub create/update pass it, the editor leaves it out (and so leaves the entry); a permalink move moves it; trash and restore keep it.
- Values verbatim as mf2 JSON, cap 16 KiB of JSON per post, refused by name. A File part sent as a kept property is refused.
- Legacy aliases (slug, syndicate-to) and accepted-without-effect p3k-content-type are unchanged; a read's summary stays derived. A property the site later maps stops being kept: keptPrivately(name) is 'not mapped and not mp-*', and q=source only answers kept names that are still not mapped.
- mp-* commands the site does not carry out are refused: 'This endpoint does not support mp-channel.' (create) and 'cannot update mp-…' (update).
- A create that keeps properties and sends none of content, name, photo, in-reply-to, like-of, repost-of, bookmark-of, read-of is refused naming them (Quill weight).
Validation: pnpm build, pnpm test (3690 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. New suite src/micropub/kept-properties.test.ts (14 tests) replays micropub.rocks 204; a mutation that wrote the kept properties into the body made the public-surface sweep fail, so it detects a leak. Curl against a running site: test 204's request answered 201 with Location /2017/05/lunch-meeting/, q=source returned the checkin verbatim, the page had no checkin text, data/kept-properties.json was -rw-------, nothing under content/ held it; Quill's weight post got 400 'does not understand weight, and the post has nothing else to publish'; mp-channel got 400 'does not support mp-channel'. Updated tests that asserted the old refusal (create.test rsvp/checkin cases, update.test checkin case, post-types.test refused list).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Micropub now keeps a property it does not understand instead of refusing the post: the rest is published and the property goes, verbatim, into data/kept-properties.json (0600, keyed by permalink, moved with the post like data/locations.json via a shared permalinkFile store), never into content/ and never onto a public surface. q=source returns it, update replace/add/delete changes it, delete/undelete and permalink moves keep it. Unsupported mp-* commands, file parts, more than 16 KiB per post, and a create with nothing publishable (Quill weight) are refused by name. decision-27 amended; README Micropub section, micropub.rocks results, data table and Personal data updated, package README personal data table too. Verified by kept-properties.test.ts (micropub.rocks 204 replay, public-surface sweep, update ops, moves), the full suite, typecheck, lint, format check, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
