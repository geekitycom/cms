---
id: TASK-191
title: IndieAuth reads a client's redirect URIs from its HTTP Link header
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 15:43'
updated_date: '2026-10-01 15:51'
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
- [x] #1 A client that publishes its cross-origin redirect URL only in an HTTP Link header can complete the authorization flow
- [x] #2 Relative Link header targets resolve against the client_id URL, and other rels in the header are ignored
- [x] #3 Clients publishing redirect URLs in HTML keep working unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend PublicFetch's success result with link (the response's Link header, or null). Additive field; reply-context ignores it, so its behavior is unchanged.
2. In webmention/discovery.ts, split the Link header parsing into an exported linkHeaderTargets(header, rel) that returns every raw target naming a rel; endpointInHeader keeps its behavior on top of it.
3. readClientInformation takes an optional Link header. For an HTML client page, rel=redirect_uri targets from the header are resolved against the fetched URL (the client_id when there is no redirect) and listed before the HTML ones; other rels are ignored. JSON metadata documents keep redirect_uris as the only source.
4. fetchClientInformation passes fetched.link through.
5. Tests first: client.test.ts for header-only, relative target, other rels ignored; consent.test.ts for a client publishing its redirect URL only in a Link header completing the flow (approve -> code); existing HTML tests stay green.
6. Verify with pnpm build/test/typecheck/lint/format:check and a curl of a running site against a local client page.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fetchPublic's success result gains link (the response's Link header or null). It is additive. The only other caller, webmention/reply-context.ts, ignores it.
The Link header parsing in webmention/discovery.ts is now linkTargets(header, rel), returning every raw target for a rel in order. endpointInHeader keeps its old behavior on top of it (first webmention target, resolved).
readClientInformation takes an optional fifth argument, the Link header. Only the HTML path reads it. A JSON client metadata document still trusts redirect_uris alone. Header targets come first, then the page's <link>/<a> ones.
Relative targets resolve against fetched.url, the URL the body came from after redirects, which is the client_id when it does not redirect. That matches the HTML path and RFC 8288's context URL.
Tests written first and seen failing: client.test.ts 'reads redirect URLs from the Link header...' (the three header URIs missing) and consent.test.ts 'accepts one the client lists only in its Link header, through to a code' (400 instead of 200).
Validation: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check all exit 0 (2994 + 30 tests pass).
Live: a scratch CMS on :3191 and a client page on :4591 (client_id http://lvh.me:4591/, Link header only). Curl signed in, the consent screen answered 200 naming Header App, and approve answered 303 to http://127.0.0.1:4592/cb?code=...&state=s1. A redirect_uri equal to the header's rel=hub target answered 400, an unlisted one 400, and an HTML-only client 200. Servers stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An IndieAuth client may now publish its cross-origin redirect URL in an HTTP Link header. fetchPublic returns the response's Link header alongside the body, discovery.ts exposes the Link header parser as linkTargets, and client.ts adds rel=redirect_uri targets from the header, resolved against the fetched client_id URL, to an HTML client's redirect URIs. Verified by new client and consent tests (failing before), the full build/test/typecheck/lint/format run, and a curl-driven sign-in against a live site that ended in a 303 with a code.
<!-- SECTION:FINAL_SUMMARY:END -->
