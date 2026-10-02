---
id: TASK-221
title: Admin log of recent IndieAuth and Micropub requests
status: To Do
assignee: []
created_date: '2026-10-02 19:11'
labels:
  - indieauth
  - micropub
  - admin
  - interop
dependencies: []
references:
  - packages/cms/src/micropub/endpoint.ts
  - packages/cms/src/indieauth/request.ts
priority: medium
type: feature
ordinal: 237800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Testing clients (TASK-219) means guessing why a client failed from its own error message, or reading its source. Clients fail at three stages: discovery (they never reach the site's endpoints), sign-in (the authorization or token endpoint refuses them, e.g. no PKCE challenge), and Micropub (the endpoint refuses a property). The site should keep a short log of the last two stages and show it in the admin, so a site owner can see what a client sent and why it was refused.

Record one entry per request to the IndieAuth authorization endpoint (the request that arrives, before consent, and its outcome), the token endpoint, the Micropub endpoint and the media endpoint: when, which endpoint, the client_id where known, the user where known, the action or query, the HTTP status, the error and error_description when refused, whether a PKCE code_challenge was present (authorization), and what the request carried (property names and short values for Micropub; the requested scopes for IndieAuth).

Never record an access token, authorization code, code_verifier, client secret, password or cookie. Uploaded file parts are recorded as name, type and size only. Long values are truncated. No client address is stored. The log is bounded (a fixed number of entries and an age limit), lives under dataDir with mode 0600, and is listed in the README's Personal data table. Writing the log never fails or slows the request it describes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Requests to the authorization, token, Micropub and media endpoints each add an entry with time, endpoint, client_id, user, action or query, status and, when refused, error and error_description
- [ ] #2 An authorization entry says whether an S256 code_challenge was present and lists the requested scopes
- [ ] #3 A Micropub entry lists the properties the request carried with short, truncated values, and file parts as name, type and size
- [ ] #4 No entry ever contains an access token, refresh token, authorization code, code_verifier, password or cookie, proven by a test that sends each and searches the stored log
- [ ] #5 The log keeps a bounded number of entries and drops entries past an age limit, lives under dataDir with mode 0600, and a failure to write it does not change the response
- [ ] #6 An admin screen lists recent entries newest first with failures marked, can filter to failures, and shows one entry in full
- [ ] #7 README documents the screen and adds the log to the Personal data table
<!-- AC:END -->
