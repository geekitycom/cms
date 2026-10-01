---
id: TASK-194
title: Autolink bare URLs and @-names in posts
status: To Do
assignee: []
created_date: '2026-10-01 17:01'
updated_date: '2026-10-01 17:04'
labels:
  - indieweb
  - markdown
  - federation
milestone: m-28
dependencies: []
references:
  - packages/cms/src/content/markdown.ts
  - packages/cms/src/federation/article.ts
priority: medium
type: feature
ordinal: 210800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 2 aggregation asks for autolinked URLs and @-names. markdown-it runs with html: true and no linkify (src/content/markdown.ts:13), so a bare https://example.com in a post renders as text, and @user@instance.example is plain text in HTML and is not a Mention in the ActivityPub object. Turn on linkify for bare URLs (fuzzy linking off, so plain words such as file.md are not linked) and add a fediverse handle rule: @user@host links to the account's profile URL resolved by WebFinger at publish time, with a Mention tag in the federated object so the person is notified. A handle that does not resolve stays plain text. Links created this way get webmentions like any other link.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A bare http(s) URL in a post renders as a link; text like file.md or example.com without a scheme does not
- [ ] #2 @user@host resolves through WebFinger and renders as a link to the profile with class u-category h-card (or the site's mention markup)
- [ ] #3 The federated Note/Article carries a Mention tag for each resolved handle and the mentioned account is in cc
- [ ] #4 An unresolvable handle stays plain text and publishing does not fail
- [ ] #5 Autolinked URLs are sent webmentions like any other link in the post
<!-- AC:END -->
