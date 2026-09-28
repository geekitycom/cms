---
id: TASK-132
title: >-
  Harden the admin session: __Host- cookie, Fetch Metadata checks,
  Clear-Site-Data on logout
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - security
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/security/cookie-attributes/'
  - 'https://specification.website/spec/security/fetch-metadata/'
  - 'https://specification.website/spec/security/clear-site-data/'
priority: medium
type: enhancement
ordinal: 156800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The session cookie is HttpOnly, SameSite=Lax and Secure on https, but it is named geekity_session. A __Host- prefix would bind it to the exact host and path. Admin POSTs rely on synchronizer tokens alone; Sec-Fetch-Site checks add defence in depth and reject cross-site state changes before a handler runs. Logout deletes the cookie but leaves caches and storage behind on a shared device.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Under an https base URL the session cookie is named with the __Host- prefix (Secure, Path=/, no Domain); plain-http development keeps working
- [ ] #2 Existing sessions survive the rename, or the upgrade signs people out once with a clear message; the choice is documented
- [ ] #3 State-changing admin and signed-in comment requests with Sec-Fetch-Site: cross-site are rejected with 403; requests without Fetch Metadata headers fall back to the token check
- [ ] #4 Inbound ActivityPub, webmention and other server-to-server endpoints are unaffected
- [ ] #5 The logout response sends Clear-Site-Data covering cookies, cache and storage
<!-- AC:END -->
