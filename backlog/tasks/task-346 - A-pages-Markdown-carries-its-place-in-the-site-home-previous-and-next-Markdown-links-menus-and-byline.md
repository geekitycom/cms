---
id: TASK-346
title: >-
  A page's Markdown carries its place in the site: home, previous and next,
  Markdown links, menus and byline
status: To Do
assignee: []
created_date: '2026-10-11 13:43'
updated_date: '2026-10-11 13:52'
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

**Design settled 2026-10-11 (Andrew):**
- Themes own the chrome, code owns the contract. The default theme ships `partials/markdown-header.md.njk` and `partials/markdown-footer.md.njk` on the theme search path, the way mail templates are (`.txt.njk`), and a site theme overrides either. Code keeps the front matter (`title`, `permalink`, `home`, `previous`, `next`, `author`), the document's own body, and the rewriting of the site's own links. The partials get the HTML context (menus, the author and bio, soloAuthor, newestPosts, site) plus a filter that escapes Markdown.
- Shaped for a later Gemini (gemtext) renderer, which links one URL per line and has no inline links, rules or chrome (research: geminiprotocol.net gemtext spec, subscription companion spec). Navigation stays data until it is written: menus, home, previous, next, the byline and the bio reach templates as lists of label and URL, never pre-rendered Markdown. Store canonical permalinks and add the `.md` suffix only when writing, so a `.gmi` renderer can use the same data.
- The footer is a heading followed by link lists, not a sentence after a horizontal rule; the byline is a link line, not a link inside a sentence.
- Dated post lists (listings, the author archive) show each post as `YYYY-MM-DD Title`, which maps straight onto a gemlog index.
- Front matter keeps the author's username beside the display name.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every document's Markdown has front matter `home: /index.md`; a post has `previous` and `next` naming the same neighbours as the HTML post navigation; a paginated listing page has `previous` and `next` naming its newer and older pages; all as root-relative `.md` URLs, absent when there is no neighbour
- [ ] #2 Every link to a document on this site in a Markdown representation (the body, listings, the footer, llms.txt) points at that document's `.md` URL; external links and images are unchanged; the `.md` suffix is added when the representation is written, not stored
- [ ] #3 A document's Markdown header and footer come from `partials/markdown-header.md.njk` and `partials/markdown-footer.md.njk` in the default theme, overridable by a site theme like any partial; the front matter, the body and the link rewriting are not template-controlled
- [ ] #4 The default footer is a heading followed by link lists: a byline link line to the author's Markdown (posts) and the site's menus, each item with its own label; the partials receive menus, byline and bio as data (label and URL), and a Markdown-escaping filter keeps labels literal
- [ ] #5 The author archive's Markdown starts with the author's bio; on a solo-author site the homepage's Markdown carries it too
- [ ] #6 Listings and the author archive list each post as `YYYY-MM-DD Title` linking its Markdown
- [ ] #7 Front matter `author` is the author's display name, and the username is kept beside it
- [ ] #8 llms.txt has a Navigation section with the same menus
- [ ] #9 Checked by browsing a served site in https://md.geekity.com/: Home, Previous and Next work and following links stays in Markdown; doc-3, docs/public-site.md and the theme docs describe the Markdown layout and what a theme can override
<!-- AC:END -->
