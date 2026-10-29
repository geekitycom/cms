---
id: TASK-528
title: Markdown in a user's profile bio
status: To Do
assignee: []
created_date: '2026-10-29T13:59:00Z'
labels:
  - theme
  - markdown
  - federation
dependencies: []
priority: medium
type: feature
ordinal: 430800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A user's profile bio (Users > Edit > Bio, profile.bio) is plain text everywhere it goes. The default theme's partials/bio.njk prints it escaped as the card's p-note, so it appears under every post and page and on the author archive. The Markdown header prints it through escapeMarkdown, and partials/jsonld.njk gives it as the Person's description. The ActivityPub actor's summary (federation/actor.ts) is set from the raw string, so fediverse profiles show it, and because summary is HTML there, a < or & typed in the bio reaches remote servers unescaped.

So a bio can't link anything: not a 'start here' page for new readers, a project, an employer, or another piece of writing. A site that wants a linked introduction writes the h-card by hand in a page body as HTML, which then drifts from the profile and puts raw HTML in that page's Markdown and gemtext.

Proposal: treat the bio as a short piece of inline Markdown (links, emphasis, code; paragraphs optional) and render it once per format. HTML for the card and the actor summary, with no raw HTML (html: false, as comments/markdown.ts does), internal links made absolute where the output leaves the site. The Markdown as written, with site links rewritten through markdownUrl, for the .md and .gmi pages. Plain text for JSON-LD description and anywhere else that needs text. A bio with no Markdown in it renders as it does today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A bio containing [text](url) renders a working link in the default theme's bio card, keeping the card's p-note
- [ ] #2 The .md page prints the bio's Markdown as written, with the site's own links given their .md URLs, and the .gmi page converts it to text plus link lines
- [ ] #3 The ActivityPub actor summary is HTML rendered from the bio, with links absolute; raw HTML typed in a bio is escaped, never passed through; a plain-text bio with < or & is escaped correctly
- [ ] #4 JSON-LD description and other plain-text uses get the bio's text with the Markdown removed
- [ ] #5 A bio with no Markdown in it renders the same as today in every format
- [ ] #6 The users admin form says the bio takes Markdown, and the theme docs give the bio's HTML, Markdown and text forms in the template context
- [ ] #7 Tests cover a linked bio in the card, the .md and .gmi pages, the actor summary and JSON-LD, raw HTML in a bio, and an unchanged plain bio
<!-- AC:END -->
