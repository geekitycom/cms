---
id: TASK-347
title: Webmention fetches go through the public-address guard
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-11 17:18'
labels:
  - security
milestone: m-32
dependencies: []
references:
  - packages/cms/src/webmention/fetch-public.ts
  - packages/cms/src/webmention/receive.ts
  - packages/cms/src/webmention/discovery.ts
  - packages/cms/src/webmention/service.ts
  - packages/cms/src/webmention/pingback.ts
priority: high
type: bug
ordinal: 306800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Receiving a webmention fetches the source with plain fetch and redirect: follow (webmention/receive.ts readSource). Its only guard is isPrivateHost on the literal hostname, so a name that resolves to a private address, or a redirect to one, reaches internal machines. discoverEndpoint (webmention/discovery.ts) follows redirects the same way, and the POST to the discovered endpoint (webmention/service.ts) has no check at all, though the target page chooses that endpoint. fetchPublic (webmention/fetch-public.ts) already resolves and checks every hop; these paths must use it or its guard.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A webmention whose source hostname resolves to a loopback or private address is refused without a request reaching that address
- [x] #2 A source that redirects to a private address is refused at the redirect
- [x] #3 Endpoint discovery refuses targets and redirects that resolve to private addresses
- [x] #4 Sending a webmention refuses a discovered endpoint that resolves to a private address, and a redirect from the endpoint is not followed to one
- [x] #5 The separate capped readers in discovery and receive are replaced by the one in fetch-public, keeping truncate-or-refuse behaviour per caller
- [x] #6 Pingback fetches get the same guard if they fetch stranger-supplied URLs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. fetch-public.ts: pull the guarded hop loop out of fetchPublic into requestPublic(target, {lookup, signal, method, headers, body}), which checks every hop with publicHost, follows at most MAX_REDIRECTS redirects by hand (303, and 301/302 after a POST, become a GET without a body) and hands back the final Response and URL. fetchPublic reads through it; a refusal for a non-2xx answer carries the status.
2. discovery.ts: discoverEndpoint(target, lookup) goes through fetchPublic: non-HTML types come back headers-only (Link header still read), HTML is read truncated at DISCOVERY_MAX_BYTES. readCapped is deleted along with its exports.
3. receive.ts: readSource(source, lookup) goes through fetchPublic with any content type, truncated at DISCOVERY_MAX_BYTES; a 4xx refusal is gone, any other refusal unreachable. VerifyWebmentionOptions gains lookup.
4. service.ts: tell() passes config.hostLookup to discovery and POSTs through requestPublic, so the endpoint and every redirect from it are checked; copyOf resolves against the URL the POST ended at.
5. Pingback: it verifies through webmentions.receive, so it gets the guard from step 3; a pingback test proves it.
6. Tests first for each AC with injected HostLookup and a stubbed fetch that answers redirects as 3xx; update the existing stubs and site configs so no test resolves real DNS.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fetch-public.ts now has requestPublic: the guarded hop loop (publicHost on every hop, manual redirects, at most 5) for any method; fetchPublic is built on it, and its refusal for a non-2xx answer carries status. discoverEndpoint(target, lookup) and receive.ts readSource(source, lookup) go through fetchPublic (discovery: HTML truncated at DISCOVERY_MAX_BYTES, other types headers-only so the Link header is still read; receive: any type, truncated, 4xx refusal = gone, other refusals = unreachable). service.ts tell() POSTs through requestPublic with config.hostLookup; a refused endpoint is recorded failed with the reason. readCapped is deleted, and with it its export from @geekity/cms (breaking for anyone importing it); discoverEndpoint now takes a required lookup.
Pingback verifies through webmentions.receive -> verifyWebmention -> readSource, so it gets the same guard; pingback.test.ts proves a source resolving to 10.0.0.5 gets fault 0 with nothing fetched.
Tests: discovery.test, receive.test, send.test, pingback.test stubs now answer redirects as real 3xx and record every request; new cases for each AC, and the receive/pingback cases were seen to fail with the lookup forced public. Sandbox sites that need the stubbed web reached now use a new resolvePublic helper in admin/__testing__/harness.ts (salmention, akismet-site, micropub/syndicate, migrated-site). cited-title-slug turns webmention sending off in its fetch-count test because discovery now uses redirect: manual like the context fetch it counts. reply-context.ts keeps its refusal shape without the new status field. docs/webmentions.md says only public addresses are fetched.

Validation: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check all exit 0 (cms 5491 pass, 0 fail).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Webmention receive, endpoint discovery and the send POST now go through the public-address guard in webmention/fetch-public.ts. A new requestPublic runs the guarded hop loop for any method: it resolves every hop, follows at most 5 redirects by hand, and turns 303 (or 301/302 after a POST) into a GET. fetchPublic is built on it. discoverEndpoint(target, lookup) and readSource use fetchPublic with per-caller truncation, and tell() POSTs through requestPublic, so a private endpoint, or a redirect to one, is recorded as failed. Pingback gets the guard through readSource. readCapped and its package export are gone. docs/webmentions.md describes the guard. Verified with new tests in discovery, receive, send and pingback that use injected lookups and record every request; the receive and pingback cases fail when the lookup is forced public. The full build/test/typecheck/lint/format run passes.
<!-- SECTION:FINAL_SUMMARY:END -->
