---
id: TASK-347
title: Webmention fetches go through the public-address guard
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels:
  - security
milestone: m-32
dependencies: []
references:
  - packages/cms/src/webmention/fetch-public.ts
  - packages/cms/src/webmention/receive.ts
  - packages/cms/src/webmention/discovery.ts
  - packages/cms/src/webmention/service.ts
  - packages/cms/src/webmention/pingback.ts
priority: high
type: bug
ordinal: 306800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Receiving a webmention fetches the source with plain fetch and redirect: follow (webmention/receive.ts readSource). Its only guard is isPrivateHost on the literal hostname, so a name that resolves to a private address, or a redirect to one, reaches internal machines. discoverEndpoint (webmention/discovery.ts) follows redirects the same way, and the POST to the discovered endpoint (webmention/service.ts) has no check at all, though the target page chooses that endpoint. fetchPublic (webmention/fetch-public.ts) already resolves and checks every hop; these paths must use it or its guard.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A webmention whose source hostname resolves to a loopback or private address is refused without a request reaching that address
- [ ] #2 A source that redirects to a private address is refused at the redirect
- [ ] #3 Endpoint discovery refuses targets and redirects that resolve to private addresses
- [ ] #4 Sending a webmention refuses a discovered endpoint that resolves to a private address, and a redirect from the endpoint is not followed to one
- [ ] #5 The separate capped readers in discovery and receive are replaced by the one in fetch-public, keeping truncate-or-refuse behaviour per caller
- [ ] #6 Pingback fetches get the same guard if they fetch stranger-supplied URLs
<!-- AC:END -->
