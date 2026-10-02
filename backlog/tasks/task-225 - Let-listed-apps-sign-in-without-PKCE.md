---
id: TASK-225
title: Let listed apps sign in without PKCE
status: To Do
assignee: []
created_date: '2026-10-02 23:53'
labels:
  - indieauth
  - security
  - interop
dependencies: []
references:
  - packages/cms/src/indieauth/request.ts
  - 'https://indieauth.spec.indieweb.org/'
priority: medium
type: feature
ordinal: 240800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
iA Writer finds the site's authorization endpoint (TASK-220) and is then refused, because it sends no PKCE code_challenge (TASK-219, App activity entry of 2026-10-02: client_id https://ia.net/writer, redirect_uri https://ia.net/writer/indieauth/redirect, scope 'create media'). The current IndieAuth spec requires PKCE and the site requires it for everyone (TASK-219's no-legacy decision). Decision on 2026-10-02: make a narrow exception, a per-app allowlist the site owner manages, empty by default. Everyone not on it still needs PKCE.

What PKCE protects against: someone who intercepts the one-time authorization code cannot exchange it without the verifier the app kept. The allowlist limits the exception to apps the owner chose, and the same-host https rule limits it to return addresses that a native app normally claims as a verified universal link or app link.

Rules:
- An authorization request without code_challenge is accepted only when its client_id is on the list AND its redirect_uri is https on the same host as the client_id. Otherwise it is refused as today.
- A code issued without a challenge is marked so. The token endpoint redeems it without a code_verifier. A code issued with a challenge still needs its verifier, so a request cannot downgrade a PKCE sign-in.
- The consent screen tells the owner the app does not use PKCE and is allowed only because it is on the list.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An admin screen (Connected apps, or Settings > Privacy from TASK-223) lists the client_ids allowed without PKCE, lets the owner add and remove one, and starts empty
- [ ] #2 An authorization request without code_challenge from a listed client_id, with an https redirect_uri on the client_id's host, reaches the consent screen, which says the app does not use PKCE
- [ ] #3 The same request from an unlisted client_id, or with a redirect_uri on another host or not https, is refused as today with 'code_challenge must be an S256 PKCE challenge'
- [ ] #4 The token endpoint redeems a code issued without a challenge without a code_verifier, and still refuses a code issued with a challenge when the verifier is missing or wrong
- [ ] #5 App activity shows a sign-in allowed without PKCE as such
- [ ] #6 Tests cover each rule above, including the downgrade attempt
- [ ] #7 README's IndieAuth section documents the list, why it exists, what it risks, and that iA Writer needs it
<!-- AC:END -->
