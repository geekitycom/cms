---
id: TASK-480
title: A standalone @geekity/md2gemini package converts Markdown to gemtext
status: To Do
assignee: []
created_date: '2026-10-22 12:07'
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
- [ ] #1 packages/md2gemini publishes as @geekity/md2gemini with a convert function and typed options, and has no dependency on @geekity/cms
- [ ] #2 Link modes paragraph (default), at-end, copy, newline and off behave as md2gemini documents them; paragraph and at-end number links inline and list them as => lines after the paragraph or at the end
- [ ] #3 A list whose every item is a single link, optionally with a date or a short note, becomes plain => lines with no numbered markers in every link mode except off
- [ ] #4 Headings deeper than ### are clamped to ###; emphasis, strong and inline code markup are removed (the plain option); inline and block HTML can be stripped
- [ ] #5 Tables become preformatted blocks with table alt text; fenced code keeps its language as alt text; images become => lines with their alt text and an image marker; blockquotes become > lines; nested lists are flattened with indentation; GFM checklists and footnotes are handled
- [ ] #6 Front matter is stripped when asked; a link-rewrite function is applied to every link URL, so a caller can point .md links at .gmi
- [ ] #7 Unit tests cover each element and each link mode, including the list-of-links case and a Markdown file with no links
- [ ] #8 release-please-config.json, .release-please-manifest.json, commitlint.config.js (scope md2gemini), CLAUDE.md scope table, README package table and the Dockerfile manifest COPY lines include the package; pnpm build, test, lint and typecheck pass across the workspace
- [ ] #9 The package README documents the options, the list-of-links rule and that the code is not derived from md2gemini
<!-- AC:END -->
