---
id: TASK-290
title: Head a document's Markdown with its title
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-08 01:49'
updated_date: '2026-10-08 01:58'
labels: []
dependencies:
  - TASK-289
ordinal: 246800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Markdown representation of a post or page is the stored file, and the title lives only in the front matter. A reader that skips front matter, which is most Markdown renderers and many agents, sees a body with no heading. The Markdown and text/plain representations put '# {title}' between the front matter and the body.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post's or page's Markdown and text/plain representations carry '# {title}' as the first line after the front matter, and the front matter is unchanged
- [x] #2 A document with no title (a note) or whose body already opens with a level-one heading gets no added heading
- [x] #3 The JSON representation's markdown field stays the stored body
- [x] #4 doc-3's Representations table describes the heading
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
documentMarkdown() in routes.ts adds '# {title}' via serializeDocument unless the title is empty or the body opens with an h1; document Markdown ETag hashes the body so the change invalidates cached copies.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: pnpm typecheck, lint clean; pnpm test 4835 pass; golden diff is the heading plus the post Markdown ETag. Demo on :3999 showed '# One URL, many representations' after the front matter for text/markdown and text/plain, and the JSON markdown field unchanged.
<!-- SECTION:NOTES:END -->
