---
id: TASK-237
title: 'Keep Micropub properties the site does not understand, privately'
status: To Do
assignee: []
created_date: '2026-10-03 16:05'
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
- [ ] #1 A Micropub create with a property the site does not understand answers 201, publishes the rest of the post, and keeps the property in a private file under dataDir, not in front matter or anywhere under content/
- [ ] #2 q=source returns the kept properties as they were sent, and update (replace, add, delete) and delete of the post handle them; a post that moves keeps them
- [ ] #3 No kept property appears on any public surface (page, .md, .json, feeds, ActivityPub object, search, llms.txt), proven by a test that searches each
- [ ] #4 Unsupported mp-* commands are still refused; decision-27 records the new rule and its limits
- [ ] #5 micropub.rocks test 204's request answers 201 even before TASK-236, and README's Micropub section, micropub.rocks results and the Personal data table are updated
<!-- AC:END -->
