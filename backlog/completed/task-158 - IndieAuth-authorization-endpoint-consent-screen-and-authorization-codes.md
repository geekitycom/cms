---
id: TASK-158
title: 'IndieAuth authorization endpoint: consent screen and authorization codes'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:52'
updated_date: '2026-10-01 14:36'
labels:
  - indieauth
  - indieweb
  - admin
milestone: m-24
dependencies:
  - TASK-157
references:
  - 'https://www.rfc-editor.org/rfc/rfc8707'
  - 'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization'
priority: medium
type: feature
ordinal: 182800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The authorization endpoint is where a client sends the person to approve a sign-in. It validates the request (response_type=code, client_id, redirect_uri, state, code_challenge with S256, optional me and scope), requires an admin session, and shows a consent screen naming the client and the scopes asked for. Approving redirects to redirect_uri with a code, state and iss; denying redirects with error=access_denied. The admin login has no return-to today, so signing in from this flow must come back to the pending request. Client information is fetched from the client_id URL (JSON client metadata or h-app) to show a name and logo and to learn allowed redirect URIs; that fetch is driven by whoever starts a sign-in, so it must refuse private and loopback addresses the way webmention fetching does (public-address.ts), with a timeout and size limit. Codes are single use, bound to the client, redirect_uri, PKCE challenge, user and scopes, and expire within minutes; they are short-lived enough to live outside the files decision-9 requires.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A valid request from a signed-out browser goes through the admin login and lands back on the consent screen for the same request
- [x] #2 The consent screen shows the client name (or its URL when it publishes none), its redirect host, the me URL being signed in as and each requested scope, and the user can untick scopes before approving
- [x] #3 Approve redirects to redirect_uri with code, state and iss; Deny redirects with error=access_denied and state
- [x] #4 A redirect_uri on a different origin from client_id is accepted only when the client metadata lists it; otherwise the endpoint shows an error page and never redirects
- [x] #5 Requests missing PKCE, using a method other than S256, or with a malformed client_id are refused, proven by tests
- [x] #6 The client_id fetch refuses private, loopback and link-local addresses and is bounded in time and size, proven by tests
- [x] #7 A signed-in user can only approve as their own me URL; a me for another user is ignored in favour of the signed-in user
- [x] #8 The consent form is protected against CSRF; whether the endpoint stays usable in maintenance mode, where /admin is exempt (TASK-130), is decided and tested
- [x] #9 An optional resource parameter (RFC 8707) is accepted, shown on the consent screen, and carried with the code so the token is issued for that resource
- [x] #10 Clients identified by a client_id URL work whether its metadata is an IndieAuth h-app or a JSON client metadata document, and the task notes confirm against the current MCP authorization spec whether that covers MCP clients or dynamic client registration (RFC 7591) is also needed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shapes: AuthorizationRequest (client_id, redirect_uri, state, S256 code_challenge, requested scopes, me, resource), ClientInformation (name, url, redirect URIs) and AuthorizationCode (client, redirect_uri, challenge, user, me, scopes, resource). Codes and pending consents live in an in-memory expiring store on the request context (c.var.indieauth), single use, codes expire in minutes; TASK-159/160 take codes from it.
2. request.ts parses the query in two steps: client_id and redirect_uri first (a fault here shows an error page and never redirects), then the rest (a fault redirects with error=invalid_request etc.). PKCE must be S256 with a 43-char challenge. resource must be an absolute URL on this site's origin (invalid_target otherwise).
3. client.ts fetches the client_id URL through webmention/fetch-public.ts (public hosts only, every redirect hop checked, timeout and byte cap) and reads either a JSON client metadata document (client_id must match) or an h-app/h-x-app page with rel=redirect_uri links. redirect_uri on another origin is allowed only when listed.
4. GET /_geekity/indieauth/auth hands the request to /admin/indieauth/consent with the same query. The consent GET is reachable signed out only to redirect to /admin/login?return_to=..., and login returns to admin-local return_to paths. The consent page shows client name or URL, redirect host, the me URL (meForSignIn in identity.ts: the typed me only when it names the signed-in user, else their author URL), resource, and a ticked checkbox per supported requested scope.
5. POST /admin/indieauth/consent goes through the admin guard (CSRF + Fetch Metadata), takes the pending consent bound to the user, and redirects with code/state/iss or error=access_denied/state/iss. The page's CSP form-action adds the redirect origin so the browser follows the redirect.
6. Maintenance: the authorization endpoint is not exempt (503), matching the identity URLs, which advertise nothing during maintenance; tested.
7. Advertise client_id_metadata_document_supported in the metadata (MCP 2025-11-25).
8. Tests first per AC; then build, test, typecheck, lint, format:check, and curl the running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: src/indieauth/request.ts (two-step parse: client_id/redirect_uri faults are unredirectable pages; other faults redirect with error, error_description, state, iss), client.ts (client_id fetch through webmention/fetch-public.ts; JSON client metadata documents whose client_id matches, or h-app/h-x-app pages with rel=redirect_uri links), grants.ts (in-memory expiring store, keys of 32 random bytes, take-once; codes live 5 minutes, pending consents 30), consent.ts (GET /_geekity/indieauth/auth hands the query to /admin/indieauth/consent; GET renders consent, POST approves or denies). identity.ts gained meForSignIn. Login carries return_to for paths in RETURNABLE_PATHS (only the consent screen), validated to stay under /admin. The consent page's CSP form-action adds the redirect origin, because browsers hold a post's redirect to form-action.

Decisions: (1) Maintenance: the authorization endpoint is NOT exempt; it answers 503 like the identity URLs that advertise it (decision-23 consequences). The consent screen under /admin stays reachable because /admin is exempt, but a client cannot start a flow. Tested in consent.test.ts and by curl. (2) Codes and consents are in memory, not data/: they live for minutes, and a restart costs one retry (decision-9 covers durable state). (3) resource must be one absolute URL on the site's own origin, else invalid_target. (4) Unknown scopes are dropped silently; ticked scopes are intersected with requested ones. (5) A redirect_uri on another origin must match a listed URI exactly. (6) The client logo is not shown: the admin CSP allows only self images, and proxying it is out of scope. The HTTP Link header form of redirect_uri is not read (fetchPublic returns no headers); link elements are.

MCP check (AC10): the 2025-06-18 spec the task cites made Dynamic Client Registration (RFC 7591) a SHOULD and had no URL client IDs. The current spec, 2025-11-25, makes Client ID Metadata Documents the SHOULD and DCR a MAY kept for backwards compatibility, with AS discovery via client_id_metadata_document_supported. This server now advertises client_id_metadata_document_supported: true and reads those documents (client_id must match exactly, redirect_uris checked exactly, localhost redirects get a warning and the host shown). So current MCP clients are covered without DCR; only clients that support only the older 2025-06-18 flow would need DCR, which is a possible follow-up, not built.

Verification: pnpm build, pnpm test (2879 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass. Curl against a throwaway site on :4588: metadata lists client_id_metadata_document_supported; auth endpoint 302s to consent; signed-out consent 302s to /admin/login?return_to=...; login 303s back to the same consent URL; consent CSP has form-action 'self' http://localhost:9999; approve 303s to cb?code&state&iss; replay 400; deny 303s with error=access_denied&state&iss; unlisted redirect 400 with no Location; plain PKCE 302s with error=invalid_request; with maintenance on the endpoint answers 503 Retry-After 600.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the IndieAuth authorization endpoint and consent screen. GET /_geekity/indieauth/auth validates through /admin/indieauth/consent: a signed-out person goes through the admin login (new return_to, admin-local only) and lands back on the same request. The consent screen names the client (or its URL), redirect host, the me URL (always the signed-in user's own: the typed URL only when it names them), the resource, and a ticked box per requested scope. Approve redirects with code, state and iss; Deny with error=access_denied, state and iss. Codes are single-use, bound to client, redirect_uri, S256 challenge, user, me, scopes and resource, and expire in 5 minutes, kept in memory on c.var.indieauth for TASK-159/160. Client info comes from the client_id URL (JSON client metadata or h-app) through the public-address fetch with a timeout and byte cap; a cross-origin redirect_uri must be listed. The endpoint is down (503) in maintenance mode. The metadata now advertises client_id_metadata_document_supported for MCP clients. Verified with unit and HTTP tests per criterion, the full build/test/typecheck/lint/format suite, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
