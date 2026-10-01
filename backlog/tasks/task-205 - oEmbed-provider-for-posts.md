---
id: TASK-205
title: oEmbed provider for posts
status: To Do
assignee: []
created_date: '2026-10-01 17:13'
labels:
  - interop
  - embed
dependencies: []
references:
  - packages/cms/src/web/routes.ts
  - 'https://oembed.com/'
priority: low
type: feature
ordinal: 221800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WordPress, Discourse and many other tools turn a pasted URL into an embedded card by asking the page's oEmbed provider. Serve an oEmbed endpoint for posts and pages (JSON, and XML if cheap) of type rich, with an html snippet that is a self-contained blockquote card (title or excerpt, author, date, link back) that needs no script from this site, plus title, author_name, author_url, provider_name, provider_url and thumbnail when the post has an image. Advertise it with <link rel="alternate" type="application/json+oembed"> on each post. maxwidth and maxheight are honoured or ignored per the spec; unknown URLs get 404.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each post and page links its oEmbed endpoint with rel="alternate" type="application/json+oembed"
- [ ] #2 The endpoint answers type rich with html, title, author_name, author_url, provider_name and provider_url, and a thumbnail when the post has an image
- [ ] #3 The html is a static blockquote with no script and escapes everything from the post
- [ ] #4 A URL that is not a published post or page gets 404, and a draft is never exposed
- [ ] #5 Pasting a post URL into a WordPress editor produces the embed, or the notes record what was checked
<!-- AC:END -->
