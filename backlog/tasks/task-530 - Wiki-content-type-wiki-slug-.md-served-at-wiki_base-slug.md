---
id: TASK-530
title: 'Wiki content type: wiki/<slug>.md served at /<wiki_base>/<slug>/'
status: To Do
assignee: []
created_date: '2026-10-29T18:11:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-529
references:
  - decision-66
ordinal: 432800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: wiki pages are a third document type rather than pages with a flag, so they can be listed, linked and edited as their own set. Posts and pages are described by DocumentKind (src/content/document-kind.ts) and typed by directory (typeForPath in src/content/parser.ts, content-tree.ts). Unlike a page, a wiki page has no stored permalink: it is /<wiki_base>/<slug>/ from its file name, so a base change moves all of them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Files under `wiki/` index as documents of type `wiki` with a WIKI_KIND: undated, untagged, uncategorised, not federated, not excludable, no contact form, replies or location
- [ ] #2 A wiki page permalink is `/<wiki_base>/<file slug>/`, derived at read time; a `permalink` in its front matter is ignored with a sync warning
- [ ] #3 A published wiki page is served at its permalink (and .md, .gmi, .json) with a new `wiki` layout in the default theme showing the title, body, last-updated time and the pages that link to it; drafts and trashed ones are 404 and 410 as for pages
- [ ] #4 Wiki pages are in site search, the sitemap and export, and `/llms.txt` lists them in a section of their own
- [ ] #5 Wiki pages are not in feeds, the home page, archives or federation
- [ ] #6 Saving a post or page whose permalink is under `/<wiki_base>/` is refused with a message naming the wiki base
- [ ] #7 Changing `wiki_base` moves every wiki page, and the old path answers with a 301 to the new one, as a renamed taxonomy term does
- [ ] #8 DocumentType and the plugin-facing document type include `wiki`
<!-- AC:END -->
