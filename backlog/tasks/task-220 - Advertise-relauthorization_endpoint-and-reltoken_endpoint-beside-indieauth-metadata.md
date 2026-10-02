---
id: TASK-220
title: >-
  Advertise rel=authorization_endpoint and rel=token_endpoint beside
  indieauth-metadata
status: To Do
assignee: []
created_date: '2026-10-02 19:11'
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
- [ ] #1 The pages that advertise rel=indieauth-metadata also advertise rel=authorization_endpoint and rel=token_endpoint, in the Link header and in the head, naming the same URLs the metadata document names
- [ ] #2 An authorization request without an S256 code_challenge is still refused
- [ ] #3 A test proves both rels are present and agree with the metadata document
- [ ] #4 README's IndieAuth section names the two rels and why they are there
<!-- AC:END -->
