---
id: TASK-351
title: Plugins reuse core content helpers
status: To Do
assignee: []
created_date: '2026-10-11 17:01'
labels: []
milestone: m-32
dependencies:
  - TASK-350
type: bug
ordinal: 310800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
@geekity/cms/plugin exports only types and definePlugin, so plugins copy helpers. plugin-wordpress posts-import.ts slugs with a bare regex (Café becomes caf where cms gives cafe), writes front matter with its own js-yaml dump instead of content/writer.ts serializeDocument, and content-import.ts reimplements temp-file-plus-rename instead of files/atomic.ts. Plugins also each define isRecord and strip trailing slashes differently from cms.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The plugin entry point exports slugify, serializeDocument (with its document type), atomic file writing and isRecord
- [ ] #2 The WordPress importer slugs, serializes and writes through those exports, so an imported title with accents gets the same slug the editor would give
- [ ] #3 An imported document saved unchanged in the admin is not rewritten (its serialization matches)
- [ ] #4 No plugin package keeps a private isRecord, slugify or front-matter writer
<!-- AC:END -->
