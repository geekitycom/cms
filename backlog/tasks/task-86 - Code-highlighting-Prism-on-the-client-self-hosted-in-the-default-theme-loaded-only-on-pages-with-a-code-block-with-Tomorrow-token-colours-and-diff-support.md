---
id: TASK-86
title: >-
  Code highlighting: highlight.js on the client, self-hosted in the default
  theme, loaded only on pages with a code block, in the Tomorrow palette with
  diff support
status: To Do
assignee: []
created_date: '2026-09-13 14:35'
updated_date: '2026-09-13 14:44'
labels:
  - web
milestone: m-14
dependencies:
  - TASK-80
references:
  - packages/cms/src/content/markdown.ts
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/themes/default/static/style.css
  - /Users/andrewshell/code/personal/blog-asdo-11ty/eleventy.config.js
  - /Users/andrewshell/code/personal/blog-asdo-11ty/public/css/prism-diff.css
  - /Users/andrewshell/code/wordpress/asdo-theme/css/prism-tomorrow.css
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 111800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Both of the sites this design comes from highlight code in the Tomorrow palette: the WordPress theme ships prism-tomorrow.css, and the legacy Eleventy blog at /Users/andrewshell/code/personal/blog-asdo-11ty ran @11ty/eleventy-plugin-syntaxhighlight (Prism at build time) with prism-tomorrow.css, a prism-diff.css for the diff-* languages, and tabindex=0 on every pre so a keyboard user can scroll a wide block. Prism itself is not the right choice for a new site: its last release was 1.30.0 in March 2025 and the project accepts only security fixes while a version 2 that has been in progress since 2022 is unfinished. highlight.js is maintained (11.12.0, August 2026), has no dependencies, reads the language-x class markdown-it already puts on a code element, and ships the Tomorrow palette as a base16 theme. The CMS renders code blocks as pre > code.language-x with no highlighting on purpose, so that a theme highlights on the client (decision-16). Do that in the default theme with highlight.js. Vendor a self-hosted bundle into themes/default/static/highlight.js at a pinned version with the core and the languages the author writes in (xml, css, javascript, typescript, json, yaml, bash, shell, php, sql, python, go, rust, markdown, diff, nginx, dockerfile, ini) and nothing loaded from a CDN; the @highlightjs/cdn-assets package or a small script under packages/cms/scripts that assembles the bundle from the highlight.js package are both acceptable, and the README says which and how a version bump is done. The script is called with highlightAll on load and auto-detection is off, so an unfenced or unknown language is left plain. The base layout includes the script, deferred, only when the rendered content contains a language- class, so a page without code ships no JavaScript. The stylesheet uses both members of the Tomorrow family on the hljs- classes: Tomorrow, the light scheme, on light paper, and Tomorrow Night on dark paper (the source sites show Tomorrow Night on light paper; the user wants to see the light member in light mode and will judge it), plus whole-line addition and deletion backgrounds for diff blocks in the spirit of prism-diff.css, with the contrast test of TASK-80 extended to the token colours against each scheme's block background. The renderer adds tabindex="0" to every pre so wide blocks scroll by keyboard, which is a small core change with its own test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 themes/default/static/highlight.js is a self-hosted highlight.js bundle at a pinned version with the listed languages, assembled by a documented, repeatable step from the highlight.js or @highlightjs/cdn-assets package, with no runtime fetch from any CDN
- [ ] #2 A page whose content has a code block includes the script deferred and a page without one includes no script at all, proven by tests on both
- [ ] #3 Rendered pre elements carry tabindex="0"; a fenced block with an unknown language keeps its language- class and plain text, and auto-detection is off
- [ ] #4 The stylesheet styles hljs- token classes in the light Tomorrow palette under the light scheme and Tomorrow Night under the dark scheme, and carries whole-line diff addition and deletion rules for both; the contrast test covers token colours against each block background at 4.5:1
- [ ] #5 The demo has a post with fenced code in two languages and a diff block, and its site test proves the script and the language classes are present on that post and absent on a post without code; the theme README documents the highlighter, both palettes and how a site theme swaps it
<!-- AC:END -->
