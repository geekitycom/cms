---
id: TASK-163
title: 'Micropub endpoint: discovery and configuration queries'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:54'
updated_date: '2026-10-02 15:09'
labels:
  - micropub
  - indieweb
milestone: m-25
dependencies:
  - TASK-161
references:
  - 'https://www.w3.org/TR/micropub/'
  - 'https://indieweb.org/Micropub-extensions'
priority: medium
type: feature
ordinal: 187800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Micropub client finds the endpoint from the same page it signed in with, then asks it what it supports. Add the endpoint behind the bearer-token middleware from TASK-161, advertise it from the site root and every author archive (Link header and <link rel="micropub">) and in the IndieAuth metadata, and answer the read-only queries. This task accepts no posts; creating them is the next task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The site root and every author archive advertise the endpoint with a Link: rel="micropub" header and a <link rel="micropub"> in the head, from every theme
- [x] #2 GET ?q=config returns media-endpoint, syndicate-to (empty until syndication targets exist) and the post types the site accepts
- [x] #3 GET ?q=category returns the site's existing tags and categories, and supports a filter parameter
- [x] #4 A request with no token gets 401, and an unknown q gets 400 invalid_request, proven by tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. discovery.ts: MICROPUB_PATH (/_geekity/micropub) and MICROPUB_MEDIA_PATH (/_geekity/micropub/media). The identity-URL middleware (renamed advertiseIdentityEndpoints) adds rel=micropub beside rel=indieauth-metadata, as a Link header and a head link, so every theme carries both.
2. New src/micropub/endpoint.ts: mountMicropub(app) mounts GET MICROPUB_PATH behind requireBearer({ audience: { resource: base URL (the resource the protected resource metadata names), acceptsUnbound: true } }), no scope needed to read. Answers cache-control no-store.
3. q=config: media-endpoint (URL the media task builds), syndicate-to [] (TASK-168 fills it), post-types from a Record<PostType, name> so a new PostType must be named, and q listing the supported queries. q=syndicate-to answers the same empty list, as the spec defines that query. q=category: tags and categories in use on published documents, merged, deduped and sorted, filtered by a case-insensitive substring when filter is given. Missing or unknown q: 400 invalid_request.
4. Mount beside the IndieAuth endpoints in index.ts, behind the maintenance gate.
5. Tests first: micropub/endpoint.test.ts for AC#2-4, discovery.test.ts extended for rel=micropub under default and bare themes. Then full gate and curl a running site. README section for the endpoint.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the read side of the Micropub endpoint.

- discovery.ts: MICROPUB_PATH (/_geekity/micropub) and MICROPUB_MEDIA_PATH (/_geekity/micropub/media). The identity-URL middleware is renamed advertiseIdentityEndpoints and adds rel=micropub beside rel=indieauth-metadata, as Link header entries and head links, so every theme carries both. The anonymous-pages golden was regenerated; only / and /author/ada/ changed, each by the new Link entry and head link.
- New src/micropub/endpoint.ts: mountMicropub mounts GET /_geekity/micropub behind requireBearer with audience { resource: site base URL, acceptsUnbound: true }. The base URL is the resource the protected resource metadata names, so a token bound to the site works and one bound to another resource (an MCP endpoint) gets 401. No scope is needed to query. Answers cache-control no-store. Mounted in index.ts after the token info endpoints, behind the maintenance gate.
- Queries are a Record<Query, fn> over QUERY_NAMES, pure over { baseUrl, store, filter }. q=config: media-endpoint, syndicate-to [], post-types from a Record<PostType, name> (note, article, reply) so a new PostType cannot go unoffered, and q listing the supported queries. q=syndicate-to answers the same empty list, because the Micropub spec defines that query and a 400 for it would break clients; TASK-168 fills the list. q=category: tags and categories on published posts (listTags + listCategories), deduped, sorted case-insensitively, filter is a case-insensitive substring match. Missing, empty or unknown q: 400 invalid_request.
- Decision: the description also says to advertise the endpoint in the IndieAuth metadata. RFC 8414 and the IndieAuth spec define no field for it and no client reads one, so it was left out; discovery is the rel=micropub link, as the Micropub spec has it.
- media-endpoint names a URL TASK-165 builds; until then it 404s. Both land in this milestone.
- README: new Micropub section.

Validation: new tests failed first for the intended reasons (no rel=micropub link, 404 from the endpoint). Mutation check: removing the guard failed the three 401 tests. pnpm build, pnpm test (3246 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. Curled a throwaway site on :3463: / and /author/ada/ carry Link rel=micropub and the head link; q=config, q=category (with and without filter=MICRO), q=syndicate-to answered as specified; no token gave 401 with resource_metadata; q=nope and no q gave 400 invalid_request; maintenance mode gave 503. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the Micropub endpoint at /_geekity/micropub with its read-only queries. The site root and every author archive advertise it with Link rel=micropub and a head link from the same middleware as the IndieAuth metadata, so every theme carries it. The endpoint sits behind requireBearer (site-bound or unbound tokens) and answers q=config (media-endpoint, syndicate-to [], post types note/article/reply, supported queries), q=syndicate-to, and q=category with a case-insensitive filter. Missing or unknown q gets 400 invalid_request, no token gets 401. Verified with failing-first tests, a mutation check, the full build/test/typecheck/lint/format gate, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
