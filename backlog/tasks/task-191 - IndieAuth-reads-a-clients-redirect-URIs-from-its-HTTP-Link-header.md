---
id: TASK-191
title: IndieAuth reads a client's redirect URIs from its HTTP Link header
status: To Do
assignee: []
created_date: '2026-10-01 15:43'
labels:
  - indieauth
dependencies:
  - TASK-158
references:
  - packages/cms/src/indieauth/client.ts
  - 'https://indieauth.spec.indieweb.org/#redirect-url'
priority: low
type: bug
ordinal: 207800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a redirect_uri is on a different origin from the client_id, the IndieAuth spec has the server verify it against the client's published redirect URLs, which a client may publish in an HTML <link rel=redirect_uri>, an <a>, or an HTTP Link header. TASK-158 reads the first two but not the header, because fetchPublic returns the body without response headers. A client that publishes its redirect URL only in a Link header is refused with a 400 today. Make the client fetch expose the Link header (without widening what fetchPublic returns to other callers more than needed) and add rel=redirect_uri values from it, resolved against the client_id URL.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A client that publishes its cross-origin redirect URL only in an HTTP Link header can complete the authorization flow
- [ ] #2 Relative Link header targets resolve against the client_id URL, and other rels in the header are ignored
- [ ] #3 Clients publishing redirect URLs in HTML keep working unchanged
<!-- AC:END -->
