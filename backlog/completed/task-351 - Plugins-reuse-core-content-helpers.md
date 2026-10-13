---
id: TASK-351
title: Plugins reuse core content helpers
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-11 18:11'
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
- [x] #1 The plugin entry point exports slugify, serializeDocument (with its document type), atomic file writing and isRecord
- [x] #2 The WordPress importer slugs, serializes and writes through those exports, so an imported title with accents gets the same slug the editor would give
- [x] #3 An imported document saved unchanged in the admin is not rewritten (its serialization matches)
- [x] #4 No plugin package keeps a private isRecord, slugify or front-matter writer
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in plugin-wordpress posts-import.test.ts: an accented title with no WordPress slug slugs like cms slugify; every imported document re-serialized by parseDocument + serializeDocument is byte-identical.
2. Export from @geekity/cms/plugin (additive, HOST_API_VERSION stays 1): slugify, serializeDocument with DocumentContent and ActivityPubMetadata types, writeFileAtomically with its option and contents types, isRecord, messageOf.
3. plugin-wordpress: slugOf falls back to slugify; posts-import builds a DocumentContent and writes through serializeDocument (drop js-yaml dump there); content-import writes through writeFileAtomically; records/import/comments-import use isRecord; import.ts uses messageOf.
4. plugin-llm: drop the connection.ts isRecord, import it from @geekity/cms/plugin (not part of plugin-llm's public index).
5. Measure plugin bundle sizes before/after; update docs/plugins.md on what the entry point exports.
6. Verify pnpm build/test/typecheck/lint/format:check and grep for private helpers.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Exports added to @geekity/cms/plugin (additive, HOST_API_VERSION stays 1): slugify, serializeDocument, DocumentContent/ActivityPubMetadata types, writeFileAtomically with FileContents/WriteFileAtomicallyOptions, isRecord, messageOf. Checked at runtime: import('@geekity/cms/plugin') from plugin-wordpress gives functions for all five, slugify('Café crème') = cafe-creme.
plugin-wordpress: slugOf falls back to slugify when WordPress gave no slug (a WordPress slug is still used as is, since it is the URL WordPress served); posts-import builds a DocumentContent (guid and migrated go in extra) and writes it through serializeDocument; content-import writes through writeFileAtomically; records/import/comments-import use isRecord; import.ts uses messageOf. js-yaml moves to devDependencies (only the test parses YAML now).
plugin-llm: connection.ts no longer exports isRecord (it was not on the package index); catalog/complete/connection import it from @geekity/cms/plugin.
Bundle size: js-yaml has no sideEffects field and runs top-level calls, so esbuild kept all of it (and writer.ts's top-level Set) in every plugin bundle once plugin.ts re-exported serializeDocument (post-summary 6467 -> 44911 bytes). scripts/build-plugin-bundle.js now resolves js-yaml as side-effect free, and writer.ts checks KNOWN_FRONT_MATTER_KEYS with includes instead of a module-level Set. Result vs HEAD: plugin-llm 59714 -> 59745, post-summary 6467 -> 6467, tag-suggest 24407 -> 24407, wordpress 8342445 -> 8346520 (+4075: slugify, serializeDocument, atomic writer and its queue).
Tests: the accented-title test failed first (caf-cr-me-sm-rrebr-d) and passes now. The byte-identical round trip test passed before the change too: the old js-yaml writer already matched serializeDocument for these inputs; it now guards the shared path. plugin-tag-suggest key.ts hashtagKey stays: it folds as tags.pub does (no hyphens, its own transliteration table), not a slug.
Validation: pnpm build, test (cms 5532, wordpress 106, llm 48, post-summary 22, tag-suggest 31, demo 32), typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
@geekity/cms/plugin now exports slugify, serializeDocument (with DocumentContent), writeFileAtomically, isRecord and messageOf. The WordPress importer slugs, serializes and writes through them, so an accented title with no WordPress slug gets the editor's slug and an imported file round-trips through parseDocument/serializeDocument byte for byte; no plugin keeps a private isRecord, slugify or front-matter writer. The plugin bundle script treats js-yaml as side-effect free so plugins that do not serialize stay their old size. Verified with new posts-import tests and pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
