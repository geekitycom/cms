---
id: TASK-2
title: Parse and write 11ty-compatible Markdown documents
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
labels:
  - content
milestone: m-0
dependencies:
  - TASK-1
references:
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
type: feature
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the Document model and the two conversions: file text to Document (gray-matter + markdown-it) and Document back to file text. This is the compatibility boundary described in doc-2 and decision-3.

A Document carries: type (post or page), path, slug, permalink, title, date, updated, tags, draft, description, author, activitypub block, unknown front-matter keys, markdown body, rendered HTML, and a content hash.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Parsing a fixture post yields title, date, permalink, tags, draft, and rendered HTML matching a snapshot
- [ ] #2 Writing a parsed Document and parsing it again produces an equal Document, including unknown front-matter keys
- [ ] #3 Front matter is emitted in a stable key order so an unchanged Document writes byte-identical output
- [ ] #4 Default permalinks are /{yyyy}/{mm}/{slug}/ for posts and /{slug}/ for pages when the form supplies none
- [ ] #5 Slugs are lowercase ASCII with hyphens and are generated from titles containing accents and punctuation
- [ ] #6 Markdown renders footnotes, heading anchors, and fenced code with a language class, with html enabled
<!-- AC:END -->
