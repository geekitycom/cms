---
id: TASK-221
title: Admin log of recent IndieAuth and Micropub requests
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 19:11'
updated_date: '2026-10-02 19:29'
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
- [x] #1 Requests to the authorization, token, Micropub and media endpoints each add an entry with time, endpoint, client_id, user, action or query, status and, when refused, error and error_description
- [x] #2 An authorization entry says whether an S256 code_challenge was present and lists the requested scopes
- [x] #3 A Micropub entry lists the properties the request carried with short, truncated values, and file parts as name, type and size
- [x] #4 No entry ever contains an access token, refresh token, authorization code, code_verifier, password or cookie, proven by a test that sends each and searches the stored log
- [x] #5 The log keeps a bounded number of entries and drops entries past an age limit, lives under dataDir with mode 0600, and a failure to write it does not change the response
- [x] #6 An admin screen lists recent entries newest first with failures marked, can filter to failures, and shows one entry in full
- [x] #7 README documents the screen and adds the log to the Personal data table
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: packages/cms/src/indieauth/activity-log.ts. ActivityEntry is a discriminated union on endpoint (authorization request with pkce and requested scopes, authorization redeem, token with granted scopes, micropub, media), each with id, at, method, status, clientId, user, action, carried values, and error/errorDescription when refused. A carried value is a short truncated text, a file (name, type, size) or a redacted marker naming a secret field.
2. One recording point per endpoint: a recordActivity(describe) middleware placed first on each route (consent GET, which is where the authorization request is parsed and answered; authorization POST; token POST; Micropub GET/POST; media GET/POST before the size check). After next() it reads the final status, the error from a JSON error body or from the Location of an error redirect, and an activityNote handlers set on the context for what the response does not show (the consent screen's HTML refusals, the token endpoint's user and granted scopes). Request facts come from the query or the body Hono already cached; a body nobody read is not read.
3. Redaction by field name (access_token, refresh_token, code, code_verifier, client_secret, password, cookie) at every level of a JSON body; headers are never read. Values truncated.
4. Storage: data/indieauth-activity.json, mode 0600, newest first, capped at a fixed count and an age limit, appended with updateFileAtomically and not awaited; a write failure is a console warning. The admin reads it under withFileLock so a read follows the writes queued before it.
5. Admin: Users > App activity at /admin/users/activity (menu entry, list newest first with failures marked, ?show=failures filter, /admin/users/activity/:id detail).
6. Docs: root README Signing in and Micropub sections mention the screen; packages/cms/README Personal data table gets a row.
7. Tests first per AC in activity-log.test.ts (HTTP through cms.app), then build; verify with pnpm build/test/typecheck/lint/format:check and curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned.
- Recording: one middleware per route (logAuthorizationRequest on the consent GET, logAuthorizationRedemption on the authorization POST, logTokenRequest, logMicropubRequest on Micropub GET/POST, logMediaRequest on media GET/POST ahead of the size check). It reads the status, the error from a JSON error body or an error redirect's Location query, and c.var.activityNote, which only the consent screen's HTML refusals and the token/redeem success paths set. The bearer guard's 400/401/403 are logged because the middleware sits outside it.
- The authorization request is logged where it is parsed and answered, the consent GET. A signed-out person is sent to the login first and the request is logged when they come back to the consent screen; the bare GET on /_geekity/indieauth/auth is only a redirect and is not logged, so one sign-in is one entry.
- A body is read only when the route already read it (Hono's bodyCache), so the oversized-media 400 never buffers the upload. Consequence: a JSON Micropub POST with no token at all is logged as a 401 without its properties, because the guard refuses it without reading the JSON.
- Secret fields (access_token, refresh_token, code, code_verifier, client_secret, password, cookie) are kept as name only, at any depth of a JSON body. No header is read. Values cut to 100 characters, at most 40 fields per entry.
- Storage: data/indieauth-activity.json, mode 0600, last 100 entries, none older than 14 days; appended through updateFileAtomically without awaiting, failures are console warnings. Cms.close() now waits on activityLogSettled(dataDir) so a test sandbox is never removed under a write (that race showed up as ENOTEMPTY in consent.test.ts and create.test.ts before the drain was added).
- Screen: Users > App activity, /admin/users/activity, ?show=failures, /admin/users/activity/:id.
- The starter privacy page was left alone: the log is about the owner's own apps, not visitors.
Validation: pnpm build && pnpm test (3448 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Mutation checks: removing code_verifier or password from SECRET_FIELDS fails the redaction test with 'the log holds the code_verifier' / 'the log holds the password'. Live: served a temp site on 127.0.0.1:4791, curl-posted a JSON create with visibility (400 'does not understand visibility'), signed in to the admin, sent an authorization request without code_challenge (302 to the callback with error=invalid_request). /admin/users/activity listed both newest first, each marked Refused; ?show=failures showed both; each detail page showed the error description, PKCE 'No S256 code_challenge was sent', scopes 'create update undelete', and the carried fields; the file was -rw------- and did not contain the token. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a bounded, private log of requests to the IndieAuth authorization and token endpoints, Micropub and its media endpoint (packages/cms/src/indieauth/activity-log.ts), recorded by one middleware per route that reads the final status and the refusal from the response, and an admin screen at Users > App activity (indieauth/app-activity.ts, pages/users/activity*.njk) listing entries newest first, failures marked, a failures filter and a full view. Secrets are kept as field names only; the file is data/indieauth-activity.json, mode 0600, 100 entries / 14 days, written without delaying the response. README documents the screen and the Personal data table has the row. Verified by activity-log.test.ts (each AC over HTTP, including a redaction test that sends every secret and searches the raw file, and a write-failure test), the full build/test/typecheck/lint/format pipeline, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
