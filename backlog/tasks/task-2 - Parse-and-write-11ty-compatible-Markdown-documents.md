---
id: TASK-2
title: Parse and write 11ty-compatible Markdown documents
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 19:38'
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
- [x] #1 Parsing a fixture post yields title, date, permalink, tags, draft, and rendered HTML matching a snapshot
- [x] #2 Writing a parsed Document and parsing it again produces an equal Document, including unknown front-matter keys
- [x] #3 Front matter is emitted in a stable key order so an unchanged Document writes byte-identical output
- [x] #4 Default permalinks are /{yyyy}/{mm}/{slug}/ for posts and /{slug}/ for pages when the form supplies none
- [x] #5 Slugs are lowercase ASCII with hyphens and are generated from titles containing accents and punctuation
- [x] #6 Markdown renders footnotes, heading anchors, and fenced code with a language class, with html enabled
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add deps to packages/cms: gray-matter, markdown-it, markdown-it-footnote, markdown-it-anchor, js-yaml (+ types where the package ships none).
2. Add canonical fixtures under packages/cms/test/fixtures/content/ in the doc-2 layout: posts/posts.json, pages/pages.json, posts/*.md (one rich post exercising footnotes, headings, fenced code, raw HTML; one with unknown front-matter keys), pages/*.md. Fixtures are written in the writer's canonical form so parse -> write reproduces them byte for byte.
3. Test-first (tdd skill, node:test) in src/content/*.test.ts:
   - slug.test.ts: slugify lowercases, strips accents and punctuation, collapses hyphens; defaultPermalink gives /{yyyy}/{mm}/{slug}/ for posts and /{slug}/ for pages.
   - markdown.test.ts: renderMarkdown emits footnote markup, heading ids, <code class="language-...">, and passes raw HTML through.
   - parser.test.ts: parsing the fixture post yields title, date, permalink, tags, draft and the rendered HTML; type comes from the directory; unknown keys land in extra; hash is stable.
   - writer.test.ts: serializeDocument emits front matter in a fixed key order, is byte-identical for an unchanged Document, reproduces the fixture text, and parse(write(doc)) deep-equals doc including unknown keys.
4. Implement src/content/slug.ts, markdown.ts, document.ts (the Document type + content hash), parser.ts (gray-matter, dates normalised to ISO strings), writer.ts (js-yaml dump in a fixed key order), src/content/index.ts.
5. Re-export the Document type, parseDocument, serializeDocument, renderMarkdown, slugify and defaultPermalink from src/index.ts.
6. Verify with pnpm test, pnpm typecheck, pnpm build.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Layout follows doc-1: src/content/{document,slug,markdown,parser,writer,index}.ts, re-exported from src/index.ts. Fixtures live at packages/cms/test/fixtures/content/ in the doc-2 layout (posts/posts.json, pages/pages.json, _data/site.json, two posts and one page) so the sync and Eleventy tasks can build the same directory.

Decisions worth carrying forward:
- Dates are ISO 8601 strings on the Document, not Date objects, so an author's UTC offset survives; the parser normalises a YAML timestamp with toISOString() and the writer always quotes the value so it reads back as a string. Post permalinks take the year and month from the date as written rather than converting to UTC.
- Document.hash is the SHA-256 of the document's canonical file text (what serializeDocument would write), so it is a pure function of the Document. Two files differing only in formatting hash the same, which is exactly what the admin write / watcher no-op needs.
- Front matter key order is title, date, updated, permalink, tags, draft, description, author, activitypub, then unmodelled keys in the order they were read. Keys carrying nothing (empty tags, draft: false, an empty activitypub block) are omitted. Fixtures are stored in that canonical form, so serialize(parse(fixture)) reproduces the file byte for byte.
- markdown-it 15 ships its own types, so @types/markdown-it is not installed; markdown-it-anchor was dropped because its type entry imports markdown-it subpaths that markdown-it 15's exports map does not expose. Heading ids are a 15-line core rule instead, which reuses the same slugify() as permalinks and de-duplicates repeats (notes, notes-2).
- gray-matter and markdown-it-footnote ship no usable type entry, so src/types/*.d.ts declares the slice used. gray-matter is called with an empty options object to bypass its module-level cache: the cache returns a shallow clone that drops the non-enumerable 'matter' property and shares nested data objects between parses.

Validation: pnpm test 90 pass 0 fail; pnpm typecheck clean for both workspace projects; pnpm build clean. The key-order assertions were mutation-checked by moving permalink after author, which failed 4 tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the content compatibility boundary: src/content/document.ts (the Document model and the known front-matter key list), slug.ts (slugify and defaultPermalink), markdown.ts (markdown-it with html: true, footnotes, heading ids, fenced-code language classes), parser.ts (file text to Document via gray-matter, with a SHA-256 of the canonical text) and writer.ts (Document back to file text with a fixed key order), all re-exported from the package index. Fixtures in the doc-2 layout live under packages/cms/test/fixtures/content/.

Verified with pnpm test (90 pass, 0 fail), pnpm typecheck and pnpm build, all green. Each acceptance criterion is covered by a named test: the fixture post's front matter and an exact rendered-HTML snapshot (#1), three fixtures round-tripped parse/write/parse with deepStrictEqual plus an explicit unknown-keys assertion (#2), an exact front-matter key-order snapshot and byte-for-byte rewrites of every fixture, mutation-checked by reordering a key (#3), the defaultPermalink suite and a file with no permalink (#4), the slugify suite over accents, punctuation and non-ASCII (#5), and the renderMarkdown suite over footnotes, heading ids, language classes and raw HTML (#6).
<!-- SECTION:FINAL_SUMMARY:END -->
