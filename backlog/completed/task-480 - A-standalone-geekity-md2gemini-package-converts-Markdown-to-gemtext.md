---
id: TASK-480
title: A standalone @geekity/md2gemini package converts Markdown to gemtext
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 12:07'
updated_date: '2026-10-23 16:25'
labels:
  - gemini
  - md2gemini
milestone: m-45
dependencies: []
references:
  - 'https://github.com/makew0rld/md2gemini'
  - 'https://geminiprotocol.net/docs/gemtext-specification.gmi'
  - packages/plugin-post-summary/package.json
  - release-please-config.json
  - commitlint.config.js
ordinal: 405800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gemini clients read gemtext, which has no inline links, emphasis or tables and only three heading levels, so the CMS needs a Markdown to gemtext converter (decision-60). The Python md2gemini (https://github.com/makew0rld/md2gemini) was archived in 2023 and is LGPL-3.0. This package takes its options and behaviour as a spec and is written fresh in TypeScript on markdown-it, without porting its code. It is a standalone library with no dependency on @geekity/cms, published from this workspace like the plugins.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/md2gemini publishes as @geekity/md2gemini with a convert function and typed options, and has no dependency on @geekity/cms
- [x] #2 Link modes paragraph (default), at-end, copy, newline and off behave as md2gemini documents them; paragraph and at-end number links inline and list them as => lines after the paragraph or at the end
- [x] #3 A list whose every item is a single link, optionally with a date or a short note, becomes plain => lines with no numbered markers in every link mode except off
- [x] #4 Headings deeper than ### are clamped to ###; emphasis, strong and inline code markup are removed (the plain option); inline and block HTML can be stripped
- [x] #5 Tables become preformatted blocks with table alt text; fenced code keeps its language as alt text; images become => lines with their alt text and an image marker; blockquotes become > lines; nested lists are flattened with indentation; GFM checklists and footnotes are handled
- [x] #6 Front matter is stripped when asked; a link-rewrite function is applied to every link URL, so a caller can point .md links at .gmi
- [x] #7 Unit tests cover each element and each link mode, including the list-of-links case and a Markdown file with no links
- [x] #8 release-please-config.json, .release-please-manifest.json, commitlint.config.js (scope md2gemini), CLAUDE.md scope table, README package table and the Dockerfile manifest COPY lines include the package; pnpm build, test, lint and typecheck pass across the workspace
- [x] #9 The package README documents the options, the list-of-links rule and that the code is not derived from md2gemini
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Scaffold packages/md2gemini as @geekity/md2gemini, modelled on the plugin packages but not a plugin: package.json (markdown-it ^15.0.3 and markdown-it-footnote ^4.0.0, the versions core uses; no @geekity/cms), tsconfig, tsconfig.build, LICENSE, README, CHANGELOG-free start.
2. Data shape: markdown-it's flat token stream nested into a tree of nodes (open token + children) for both block and inline tokens. Inline rendering yields pieces (text, hard break, standalone => line); a render state holds resolved options, the running link number, the links waiting for the end of the current top-level block, and the links waiting for the end of the document. Link modes are a lookup of what a link contributes inline and where its => line goes, not scattered conditionals.
3. API: convert(markdown, options?) => string, with typed ConvertOptions: links ('paragraph' default, 'at-end', 'copy', 'newline', 'off'), plain, stripHtml, stripFrontMatter, rewriteLink(url), imageTag ('[IMG]'), codeTag (''), tableTag ('table'), indent ('  '), checklist (true). TASK-481 passes rewriteLink to point site .md links at .gmi; TASK-482 converts rendered theme chrome with the same call.
4. TDD per criterion in packages/md2gemini/test: link modes from md2gemini's documented example, the list-of-links rule, headings, plain, HTML stripping, tables, fences, images, blockquotes, nested lists, checklists, footnotes, front matter, rewriteLink, a file with no links.
5. Wire the package in: release-please-config.json, .release-please-manifest.json (0.0.0 so the first release is 0.1.0... matching initial-version), commitlint scope md2gemini, CLAUDE.md scope table, README package table, Dockerfile manifest COPY line; pnpm install to update the lockfile.
6. Verify with pnpm build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built packages/md2gemini on markdown-it ^15.0.3 and markdown-it-footnote ^4.0.0 (core's versions), html and linkify on as the site renders. md2gemini's README was read for options and behaviour only; no source was read or ported.

Shape: markdown-it's flat token stream is nested into a node tree (src/tree.ts). Inline content renders to pieces: text, a hard break, a standalone => line that carries the text it leaves behind, and an 'after' => line that follows the block. Where the pieces sit (flow, quote, line) decides what a break and a standalone line may do, so newline mode in a heading, table cell or blockquote keeps the link text and lists the link after the block, as copy does. Link lines from paragraph and copy mode, and standalone lines that cannot stand, follow the whole top-level block, so lists, quotes, headings and tables stay intact.

Decisions: plain defaults to false as md2gemini documents (TASK-481 should pass plain: true for 'no leftover Markdown markup'). rewriteLink replaces md_links, base_url and link_func, and applies to links, images and list-of-links lines. A list-of-links item may carry up to 60 characters of text besides its link; its label is the item's whole text. Footnote references are written [^n] so they cannot be confused with numbered link markers. Tables are drawn with box-drawing characters; no ASCII option. Ordered list items keep their numbers as text lines.

Also updated packages/cms/src/release.test.ts, whose 'every package of this repository' check counted only plugin-* directories, and docs/development.md, whose release section listed four plugins.

Validation: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check exit 0 (md2gemini 51 tests, cms 7360). pnpm pack gives dist, README.md, LICENSE and package.json with only markdown-it and markdown-it-footnote as dependencies; the tarball installed into an empty scratch project converts Markdown and rewrites a .md link to .gmi. commitlint accepts feat(md2gemini) and still rejects an unknown scope. Mutating NOTE_LIMIT, the heading clamp and the checklist boxes each fails a test. The Docker image was not built; the Dockerfile gains the manifest COPY line only, because core does not depend on the package yet.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added @geekity/md2gemini in packages/md2gemini: convert(markdown, options) turns Markdown into gemtext with typed options for the five link modes (paragraph by default), plain, stripHtml, stripFrontMatter, rewriteLink, imageTag, codeTag, tableTag, indent and checklist. Lists of single links become plain => lines; headings clamp to ###; tables become box-drawn preformatted blocks; fences keep their language; images become => lines; quotes become > lines; nested lists flatten with indentation; checklists and footnotes are handled. Written fresh on markdown-it from md2gemini's documented behaviour, not its code. Wired into release-please, the manifest, commitlint (scope md2gemini), the CLAUDE.md scope table, the README package table, the Dockerfile manifest COPY lines and docs/development.md. Verified with 51 package tests and the full workspace build, test, test:11ty, typecheck, lint and format:check, plus a packed tarball installed and run in a clean project.
<!-- SECTION:FINAL_SUMMARY:END -->
