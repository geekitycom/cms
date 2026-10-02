---
id: TASK-219
title: Micropub compatibility
status: To Do
assignee: []
created_date: '2026-10-02 18:44'
labels:
  - micropub
  - indieauth
  - interop
dependencies: []
references:
  - 'https://micropub.rocks/'
  - 'https://github.com/aaronpk/micropub.rocks/blob/main/app/Controller.php'
  - packages/cms/src/indieauth/request.ts
  - packages/cms/src/indieauth/discovery.ts
priority: medium
type: chore
ordinal: 235800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A running record of how real Micropub clients get on with a Geekity site, collected while testing 0.16.0 on shll.me. Each client tried gets an entry in the notes: what was tried, what happened, the cause, and a proposed fix. Once the picture is clear, the fixes are grouped into follow-up tasks. Related: TASK-170 (micropub.rocks and real clients, In Progress) and TASK-217 (Quill photo[value] and photo[alt]).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each client tried is recorded in the notes with what worked and what failed
- [ ] #2 Each failure has a cause traced to code, on our side or the client's, and a proposed fix or a reason not to fix it
- [ ] #3 The fixes worth making are filed as follow-up tasks, and this task links them
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## micropub.rocks (2026-10-02, shll.me on 0.16.0)

Result: cannot sign in. Entering https://shll.me/ goes nowhere. The URL is right: the root sends Link: <https://shll.me/_geekity/micropub>; rel="micropub" and the same <link> in the head (checked with curl).

Cause, read from the micropub.rocks source (app/Controller.php:192, indieauth/client 0.4.1 from 2017):
1. Discovery. It calls discoverAuthorizationEndpoint and discoverTokenEndpoint, which look only for rel="authorization_endpoint" and rel="token_endpoint". The site advertises only rel="indieauth-metadata" (current IndieAuth spec), so it finds the Micropub endpoint and no auth or token endpoint, and stops.
2. PKCE. Even with those rels, the client sends no code_challenge. parseAuthorizationRequest (packages/cms/src/indieauth/request.ts:91) refuses a request without an S256 challenge, as the current spec requires. Relaxing PKCE is not proposed.

Also noted: it asks for scope 'create update delete undelete'. 'undelete' is not in SCOPES and is dropped silently; undelete uses the delete scope, so that is harmless.

Workaround: micropub.rocks has a Manual tab on its dashboard that takes an endpoint (https://shll.me/_geekity/micropub) and an access token. The admin has no way to mint a token, so today one has to come from a client that completes a modern IndieAuth sign-in.

The TASK-170 pre-flight missed this because it minted tokens with issueTokens directly instead of going through micropub.rocks's sign-in.

Proposed fixes:
- A Create token action on Users > Connected apps: pick scopes, show the token once, revoke like any connected app. Unblocks micropub.rocks's Manual tab, scripts, and old clients.
- Advertise rel="authorization_endpoint" and rel="token_endpoint" beside rel="indieauth-metadata" (Link header and head). Harmless; helps older clients that do send PKCE. Does not by itself fix micropub.rocks.
<!-- SECTION:NOTES:END -->
