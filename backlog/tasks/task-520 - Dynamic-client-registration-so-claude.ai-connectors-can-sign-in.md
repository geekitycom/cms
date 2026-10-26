---
id: TASK-520
title: Dynamic client registration so claude.ai connectors can sign in
status: To Do
assignee: []
created_date: '2026-10-26T02:14:00Z'
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
- [ ] #1 The authorization server metadata advertises a registration_endpoint
- [ ] #2 A POST of RFC 7591 client metadata with https (or loopback http) redirect_uris returns 201 with a client_id URL on the site, token_endpoint_auth_method none, and the registered metadata; a bad request returns 400 with an RFC 7591 error code (invalid_redirect_uri or invalid_client_metadata)
- [ ] #3 An authorization request with a registered client_id shows the consent screen with the registered client_name and returns only to a registered redirect_uri; any other redirect_uri is refused, including other addresses on the site itself
- [ ] #4 The code from a registered client redeems at the token endpoint for an MCP token, and the MCP endpoint accepts it
- [ ] #5 Registration keeps no per-client state on disk, so repeated registrations cannot fill the data directory
- [ ] #6 docs/mcp.md explains connecting claude.ai by URL alone, and stops saying the site has no dynamic client registration
<!-- AC:END -->
