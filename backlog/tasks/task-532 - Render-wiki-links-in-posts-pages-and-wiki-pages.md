---
id: TASK-532
title: Render [[wiki links]] in posts, pages and wiki pages
status: To Do
assignee: []
created_date: '2026-10-29T18:11:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-529
references:
  - decision-66
ordinal: 434800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: writing [[Some page]] should link to /<wiki_base>/some-page/ without looking up the URL. The body Markdown keeps the [[ ]] syntax; it is resolved at render time by a markdown-it inline rule, as fediverseHandles is (src/content/markdown.ts). Links are written whether or not the target exists, so stored HTML depends only on the body and the base. The link parser in src/content/markdown-links.ts mirrors the main plugin set and must get the rule too, or the .md and .gmi representations keep the raw brackets.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `[[Target]]`, `[[Target|text]]`, `[[Target#Heading]]` and `[[Target#Heading|text]]` render as `<a class="wiki-link" href="/<wiki_base>/<slugify(Target)>/#<heading slug>">`, with the heading slug matching headingAnchors
- [ ] #2 A target that slugifies to nothing, code spans, code blocks and an escaped `\[[` stay literal
- [ ] #3 The `.md` representation shows an ordinary Markdown link and the Gemini representation a link line; feeds, ActivityPub and backlinks get the real link from the stored HTML
- [ ] #4 The admin preview renders wiki links the same way; comments do not
- [ ] #5 Changing `wiki_base` re-renders every document whose body has a wiki link
<!-- AC:END -->
