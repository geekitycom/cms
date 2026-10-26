---
id: TASK-520
title: Dynamic client registration so claude.ai connectors can sign in
status: Done
assignee:
  - '@claude'
created_date: '2026-10-26T02:14:00Z'
updated_date: '2026-10-26T13:51:00Z'
labels:
  - indieauth
  - mcp
dependencies: []
references:
  - docs/mcp.md
  - https://datatracker.ietf.org/doc/html/rfc7591
priority: high
ordinal: 422800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adding https://shll.me/_geekity/mcp as a custom connector in claude.ai fails with "Automatic client registration isn’t supported by Shll.me. Edit the connector and add an OAuth Client ID." claude.ai registers itself by RFC 7591 dynamic client registration and does not use Client ID Metadata Documents, which is all the IndieAuth server offers (TASK-158 notes left DCR as a possible follow-up). A site owner should be able to paste the MCP URL into claude.ai, sign in on the consent screen and be connected, with no client metadata document of their own to host. IndieAuth clients are identified by a URL, so a registration has to hand back a client_id URL the rest of the flow already understands. Open registration must not let a registered client return codes anywhere it did not register, and must not grow storage without bound.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The authorization server metadata advertises a registration_endpoint
- [x] #2 A POST of RFC 7591 client metadata with https (or loopback http) redirect_uris returns 201 with a client_id URL on the site, token_endpoint_auth_method none, and the registered metadata; a bad request returns 400 with an RFC 7591 error code (invalid_redirect_uri or invalid_client_metadata)
- [x] #3 An authorization request with a registered client_id shows the consent screen with the registered client_name and returns only to a registered redirect_uri; any other redirect_uri is refused, including other addresses on the site itself
- [x] #4 The code from a registered client redeems at the token endpoint for an MCP token, and the MCP endpoint accepts it
- [x] #5 Registration keeps no per-client state on disk, so repeated registrations cannot fill the data directory
- [x] #6 docs/mcp.md explains connecting claude.ai by URL alone, and stops saying the site has no dynamic client registration
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Stateless registration: POST /_geekity/indieauth/register validates RFC 7591 metadata and returns client_id = <site>/_geekity/indieauth/clients/<base64url JSON of client_name, client_uri, logo_uri, redirect_uris>; nothing stored.
2. GET on that client_id URL serves the JSON client metadata document, so the id is a real CIMD.
3. The consent screen decodes registered client_ids locally instead of fetching its own site, and for them allows only listed redirect_uris (no same-origin allowance).
4. Advertise registration_endpoint in authorization server metadata.
5. Tests at the HTTP surface: register, consent, redeem, MCP call; refusals.
6. docs/mcp.md: connecting claude.ai by URL.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built on branch dynamic-client-registration (da74ea35 feat, ff006f71 docs).

- indieauth/registration.ts holds the pure parse/encode/decode. The client_id is `{base}/_geekity/indieauth/clients/<base64url JSON of client_name, client_uri, logo_uri, redirect_uris>`. Decoding re-runs the registration validator, since anyone can hand-craft an id; open registration makes that equivalent to registering. Caps: 5 redirect_uris, 512 chars per URI, 100 chars for client_name, 16 KiB request body.
- web/indieauth-registration.ts mounts POST /_geekity/indieauth/register (201 / 400 invalid_redirect_uri | invalid_client_metadata, no-store, auth method always answered none) and GET on each client_id (the JSON client metadata document, 404 when the path does not decode). Behind the maintenance gate like the token endpoint; no CSRF or CORS applies outside /admin.
- Consent: an id under the clients prefix is decoded locally, never fetched, and gets no same-origin redirect allowance. One that fails to decode has no redirect_uris, so it is refused. With no client_name the app is named by its redirect host. The screen says the app registered its name itself, and does not show the id URL.
- registration_endpoint is in the authorization server metadata.
- Token endpoint needed no change. The e2e test redeems, refreshes and calls whoami over MCP with the registered id.
- docs/mcp.md: Connect claude.ai and Client registration sections; indieweb-sign-in.md links to it.
- Tests: web/indieauth-registration.test.ts (26). Full cms suite 7698/7698.

Review pass: the consent screen models a client as registered or published (KnownClient union), so only a published client gets the same-origin redirect allowance. Renamed registeredClientId to encodeClientId and PUBLIC_CLIENT to PKCE_ONLY_CLIENT. Full cms suite 7698/7698, typecheck and lint clean. Left Done until a live claude.ai connector signs in on shll.me after deploy.

Live check 2026-10-26 on shll.me: registration_endpoint advertised; POST register with https://claude.ai/api/mcp/auth_callback -> 201; http://evil.example redirect -> 400; owner confirmed the claude.ai connector connects.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added stateless RFC 7591 dynamic client registration so claude.ai custom connectors can sign in by MCP URL alone. POST /_geekity/indieauth/register returns a client_id under /_geekity/indieauth/clients/ that encodes the registered metadata as base64url, with nothing stored; a GET on it serves the client metadata document; the authorization server metadata advertises registration_endpoint. The consent screen decodes registered ids locally and returns them only to their listed redirect_uris (no same-origin allowance, since their origin is the site). Docs cover connecting claude.ai. Verified by tests (register, consent, token, refresh, MCP whoami; full suite 7698/7698) and live on shll.me after deploy: metadata advertises the endpoint, a registration with claude.ai's callback returns 201, a plain-http non-loopback redirect is refused 400, and the owner added shll.me as a claude.ai connector successfully. Merged in PR #254. Not changed: a non-registered client_id elsewhere on the site's own origin still gets the same-origin redirect allowance.
<!-- SECTION:FINAL_SUMMARY:END -->
