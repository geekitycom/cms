---
id: TASK-220
title: >-
  Advertise rel=authorization_endpoint and rel=token_endpoint beside
  indieauth-metadata
status: Done
assignee:
  - '@claude'
created_date: '2026-10-02 19:11'
updated_date: '2026-10-02 19:14'
labels:
  - indieauth
  - micropub
  - interop
dependencies: []
references:
  - packages/cms/src/indieauth/discovery.ts
  - 'https://indieauth.spec.indieweb.org/'
priority: medium
type: feature
ordinal: 236800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
iA Writer cannot sign in: 'IndieAuth Not Found: Make sure that IndieAuth meta tags of link headers are present.' It discovers endpoints through rel=authorization_endpoint and rel=token_endpoint and ignores rel=indieauth-metadata, which is all the site publishes (TASK-219). The IndieAuth spec says clients should look for those two rels for compatibility with earlier revisions, and Indiekit publishes them for older Micropub apps. Publishing them relaxes nothing: PKCE stays required, so an authorization request without a code_challenge is still refused (TASK-219's no-legacy decision stands). advertiseIdentityEndpoints adds the metadata and micropub links today; add the two rels to the same Link header and head on the same pages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The pages that advertise rel=indieauth-metadata also advertise rel=authorization_endpoint and rel=token_endpoint, in the Link header and in the head, naming the same URLs the metadata document names
- [x] #2 An authorization request without an S256 code_challenge is still refused
- [x] #3 A test proves both rels are present and agree with the metadata document
- [x] #4 README's IndieAuth section names the two rels and why they are there
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing test in discovery.test.ts: on / and /author/ada/ under the default and bare themes, the Link header and the head carry rel=authorization_endpoint and rel=token_endpoint whose URLs equal authorization_endpoint and token_endpoint read from the served metadata document. Extend the 'not on any other page' test to the two new rels.
2. advertiseIdentityEndpoints builds its links from authorizationServerMetadata(baseUrl), so the rel URLs and the metadata document share one source.
3. AC#2: leave parseAuthorizationRequest alone; add an HTTP-level test that GET /_geekity/indieauth/auth with no code_challenge is refused, beside the existing unit test in request.test.ts.
4. Regenerate anonymous-pages.golden.json with GEEKITY_UPDATE_GOLDEN=1 and check the diff touches only / and /author/ada/ links.
5. README 'Signing in with your own site': name the two rels and why (older clients such as iA Writer; PKCE still required).
6. Full check suite, then curl the running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
advertiseIdentityEndpoints now builds the authorization_endpoint and token_endpoint links from authorizationServerMetadata(baseUrl), the same function the metadata document is served from, so the rels and the document cannot disagree. Order in the Link header and head: indieauth-metadata, authorization_endpoint, token_endpoint, micropub.

Tests: discovery.test.ts's identity-URL loop (/ and /author/ada/, default and bare themes, solo and multi-author) now fetches the served metadata document and asserts each rel's Link header entry and its single <link> in <head> name the document's URL; it failed on all eight cases before the change. The 'not on any other page' test also asserts the two rels are absent from a post, /author/ada/page/1/, an unknown user and /feed/. anonymous-pages.golden.json regenerated with GEEKITY_UPDATE_GOLDEN=1; the diff touches only the home, author and static front page entries.

AC#2: request.ts is untouched. The HTTP-level test consent.test.ts 'reports a request missing PKCE to a redirect_uri it trusts' (signed-in agent, no code_challenge, 302 back with error=invalid_request) and request.test.ts 'refuses a request with no code_challenge' both still pass. Over curl, an unsigned request without PKCE goes to the admin consent route (302), where the refusal happens after sign-in; the demo admin password was not available, so the refusal itself was proven by the test, not by curl.

Validation: pnpm build && pnpm test (3426 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. curl against apps/demo server.ts on :3000: / and /author/ada/ carry both rels in the Link header and the head, with URLs equal to authorization_endpoint and token_endpoint from /_geekity/indieauth/metadata; a post page carries neither. Server stopped.

Not verified here: whether iA Writer signs in now. That needs the change deployed to shll.me; its next error settles whether it sends PKCE (TASK-219).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The site root and author archives now advertise rel=authorization_endpoint and rel=token_endpoint beside rel=indieauth-metadata, in the Link header and the head, for Micropub clients such as iA Writer that do not read the metadata document. The URLs come from authorizationServerMetadata, the same source as the document. PKCE stays required; parseAuthorizationRequest is unchanged. README's 'Signing in with your own site' names the two rels and why. Verified with a discovery test that compares the rels to the served metadata across themes and author modes, the regenerated anonymous-pages golden, the existing PKCE refusal tests, the full check suite, and curl against the running demo. Whether iA Writer now signs in needs a deploy and is tracked on TASK-219.
<!-- SECTION:FINAL_SUMMARY:END -->
