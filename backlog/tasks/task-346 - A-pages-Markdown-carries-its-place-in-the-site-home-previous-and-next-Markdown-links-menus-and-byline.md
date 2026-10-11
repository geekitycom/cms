---
id: TASK-346
title: >-
  A page's Markdown carries its place in the site: home, previous and next,
  Markdown links, menus and byline
status: To Do
assignee: []
created_date: '2026-10-11 13:43'
labels:
  - public-site
  - indieweb
dependencies:
  - TASK-345
references:
  - 'https://md.geekity.com/'
priority: medium
type: feature
ordinal: 305800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Andrew, 2026-10-11: the Markdown versions of pages should be pleasant to browse in a Markdown browser such as https://md.geekity.com/, his implementation of Dave Winer's Markdown Browser spec (https://gist.githubusercontent.com/scripting/c81461104f079b7a017802286853c4f1/raw/5b8c3d99149fce34bbe1e6066cce1098e07bb709/markdownbrowser.md), with language models still the main readers. The browser parses `home`, `previous` and `next` from front matter.

The spec's rules that matter here: a link to a `.md` document is internal and loads in the browser; an http(s) link is external; there is no content negotiation, so a link to one of the site's pages must point at its `.md` URL to stay in the Markdown web. Front matter is optional and describes structure, never presentation; the suggested fields are `title`, `previous`, `next` and `home`.

Today a document's `.md` is its front matter (with `author` as a username) and its body. Links in the body point at HTML URLs, there is no navigation, and no bio anywhere (the author archive's `.md` is a heading and a list).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every document's Markdown has front matter `home: /index.md`; a post has `previous` and `next` naming the same neighbours as the HTML post navigation; a paginated listing page has `previous` and `next` naming its newer and older pages; all as root-relative `.md` URLs, absent when there is no neighbour
- [ ] #2 Every link to a document on this site in a Markdown representation (the body, listings, the footer, llms.txt) points at that document's `.md` URL; external links and images are unchanged
- [ ] #3 A document's Markdown ends, after a horizontal rule, with a byline linking the author's Markdown (posts) and the site's menus as plain link lists, using each menu item's own label
- [ ] #4 The author archive's Markdown starts with the author's bio; on a solo-author site the homepage's Markdown carries it too
- [ ] #5 Front matter `author` is the author's display name, not the username
- [ ] #6 llms.txt has a Navigation section with the same menus
- [ ] #7 Checked by browsing a served site in https://md.geekity.com/ or the spec's rules: Home, Previous and Next work and following links stays in Markdown; doc-3 and docs/public-site.md describe the Markdown layout
<!-- AC:END -->
