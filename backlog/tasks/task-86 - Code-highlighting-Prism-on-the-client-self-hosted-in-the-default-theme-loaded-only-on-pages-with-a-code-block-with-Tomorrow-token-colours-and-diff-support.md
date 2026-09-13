---
id: TASK-86
title: >-
  Code highlighting: highlight.js on the client, self-hosted in the default
  theme, loaded only on pages with a code block, in the Tomorrow palette with
  diff support
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 14:35'
updated_date: '2026-09-13 17:49'
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
- [x] #1 themes/default/static/highlight.js is a self-hosted highlight.js bundle at a pinned version with the listed languages, assembled by a documented, repeatable step from the highlight.js or @highlightjs/cdn-assets package, with no runtime fetch from any CDN
- [x] #2 A page whose content has a code block includes the script deferred and a page without one includes no script at all, proven by tests on both
- [x] #3 Rendered pre elements carry tabindex="0"; a fenced block with an unknown language keeps its language- class and plain text, and auto-detection is off
- [x] #4 The stylesheet styles hljs- token classes in the light Tomorrow palette under the light scheme and Tomorrow Night under the dark scheme, and carries whole-line diff addition and deletion rules for both; the contrast test covers token colours against each block background at 4.5:1
- [x] #5 The demo has a post with fenced code in two languages and a diff block, and its site test proves the script and the language classes are present on that post and absent on a post without code; the theme README documents the highlighter, both palettes and how a site theme swaps it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Renderer: override the `fence` and `code_block` rules in src/content/markdown.ts so every rendered `<pre>` carries `tabindex="0"`; update markdown.test.ts and parser.test.ts. Add store migration 3 (`DELETE FROM documents`) so an already-indexed site re-renders on boot, the way migration 2 did.
2. Bundle: pin highlight.js 11.12.0 as a devDependency and add scripts/build-highlight.js, an esbuild step (the bundler the editor already uses) that registers the 17 listed languages and writes themes/default/static/highlight.js, committed to git so a site needs no build step. Rebuild command: `pnpm --filter @geekity/cms build:highlight`.
3. Bundle behaviour: no autodetection, `hljs.configure({ languages: [] })`, and a loop that highlights only `pre code` whose `language-` names a registered grammar, so an unknown language keeps its class and its plain text. Expose `window.hljs`. Tested in Node against a DOM stub in src/web/highlight-bundle.test.ts.
4. Template: the `scripts` block of layouts/base.njk prints the deferred script only when the rendered `content` holds a `language-` class, so a page without code ships no JavaScript. HTTP tests in src/web/page-shell.test.ts.
5. Colours: add the Tomorrow (light) and Tomorrow Night (dark) token colours plus diff line backgrounds as custom properties in both `:root` blocks, style the hljs- classes off them, and extend the PAIRS table in src/web/theme-colors.test.ts with every token on its block background and the block text on each diff background at 4.5:1. Adjust any stock colour that fails, minimally, and record it.
6. Demo: give a post fenced code in two languages and a diff block, extend apps/demo/test/site.test.ts on both booted sites, and document the highlighter, the palettes and how a site theme swaps or drops it in the theme README.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Renderer.** `focusableCodeBlocks` in `src/content/markdown.ts` wraps the `fence` and `code_block` renderer rules so every rendered `<pre>` carries `tabindex="0"`. No highlighting is done in core, as decision-16 says. `markdown.test.ts` and `parser.test.ts` moved with it.

**Already-indexed sites.** The hash covers the file, not what was rendered from it, so a site that upgrades would keep serving HTML made by the old renderer until somebody edited the post. Store migration 3 is `DELETE FROM documents`, the same move migration 2 made for categories: the next scan re-renders every file on boot, with no hand-editing and no instructions for the site owner. Covered by a new test in `store.test.ts` that strips version 3 from a populated index and reopens it.

**Bundle.** `highlight.js` is pinned to exactly `11.12.0` as a devDependency and `scripts/build-highlight.js` bundles it with esbuild — the bundler the editor already uses — from a generated entry, so the language list lives in one place. Output: `themes/default/static/highlight.js`, 82 kB minified, 26 kB gzipped, committed to git (unlike the editor bundle) so an installed site needs no build step; `files` already ships `themes/` and `npm pack --dry-run` confirms it. Rebuild is `pnpm --filter @geekity/cms build:highlight`, byte-for-byte reproducible (checked twice by sha256). It needed an entry in `.prettierignore` and in `eslint.config.js` beside the editor bundle's.

**No auto-detection, no throwing.** `hljs.highlightAll()` is not used: highlight.js throws `Unknown language` when a `language-` class names a grammar that is not registered, which a reader's own fenced block can do at any time. The entry loops `pre code[class*="language-"]` and calls `highlightElement` only where `getLanguage` answers, so an unknown language keeps its class and its plain text; `hljs.configure({ languages: [] })` leaves `highlightAuto` no candidates, so a block with no language is left alone too. `window.hljs` is exposed the way the CDN build does.

**Bundle test.** `src/web/highlight-bundle.test.ts` runs the committed file in a Node VM against the smallest DOM it touches, and asserts the real outcomes: js highlighted into `hljs-` spans, a diff into `hljs-addition`/`hljs-deletion`, an unknown language untouched, a plain block untouched, the 18 languages registered, and `hljs.versionString` equal to the installed `highlight.js` version — so bumping the dependency without rebuilding fails CI.

**Colours.** Tomorrow on light paper and Tomorrow Night on dark, both from highlight.js's own base16 themes, which is also the scope-to-slot mapping the stylesheet follows. Ten token colours plus two diff line tints, in both `:root` blocks, all of them added to the PAIRS table in `theme-colors.test.ts` at 4.5:1 against `--color-code-background`.

Six stock colours did not make 4.5:1 and were changed, each darkened or lifted along its own hue until it just passed:

| Slot | Stock | Ratio | Now | Ratio |
| ---- | ----- | ----- | --- | ----- |
| light base03 comment | #8e908c | 2.92 | #6c6d6a | 4.71 |
| light base04 tag | #969896 | 2.63 | #6b6d6b | 4.72 |
| light base09 literal | #f5871f | 2.27 | #a95608 | 4.73 |
| light base0A class | #eab700 | 1.69 | #846700 | 4.85 |
| light base0B string | #718c00 | 3.49 | #5e7500 | 4.73 |
| light base0C support | #3e999f | 3.04 | #30767a | 4.75 |
| light base0F meta | #a3685a | 4.06 | #945f52 | 4.73 |
| dark base0F meta | #a3685a | 3.91 | #ae786b | 4.76 |

base08 (5.01), base0D (4.52) and base0E (4.68) pass as they stand on light paper and every Tomorrow Night colour but base0F passes on dark, so those are untouched. Delimiters, operators and substitutions are `--color-code-text` rather than a colour of their own: they are most of the characters on screen.

**Diff.** `.hljs-addition` and `.hljs-deletion` take a whole-line tint out to the edges of the block — negative margin cancelling the `pre` padding, padding putting it back — and keep the block's ink, in the spirit of prism-diff.css. The `+` and `-` stay in the text, so the meaning does not rest on colour alone. The ink on each tint is in the contrast table at 4.5:1.

**Demo.** `2026-07-11-six-tables-and-a-migration.md` gained a `typescript` block and a `diff` block beside the SQL it already had, written so the diff is the very migration this task added. The demo's own `themes/demo/static/style.css` gained the `hljs-` rules too, in its warmer key: a stylesheet is an all-or-nothing override, so without them the bundle would run on the demo and paint nothing, and decision-16 says the palette is to be judged on the demo. Its light colours are a little darker again because `--paper-sunk` (#f0e9dd) is darker than the packaged block; nothing tests them, which is noted in the README as the trade a site takes on.

**Validation.** `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` all pass: 1796 package tests and 27 demo tests, 0 failures. `pnpm --filter demo test:11ty` (5) and `pnpm --filter @geekity/cms test:11ty` (16) pass too. The demo was booted on port 8931 and curled: the post with code serves four `<pre tabindex="0"><code class="language-…">` blocks (sql twice, typescript, diff) and one `<script src="/theme/highlight.js" defer></script>`; a post without code and the home page serve one `<script type="application/ld+json">` and nothing else; `/theme/highlight.js` answers 200 `text/javascript; charset=utf-8` 83660 bytes. The server was stopped afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The default theme highlights code with highlight.js on the client, self-hosted and loaded only where there is code.

`themes/default/static/highlight.js` is an 82 kB (26 kB gzipped) esbuild bundle of highlight.js 11.12.0 with eighteen grammars, built by `pnpm --filter @geekity/cms build:highlight` from `scripts/build-highlight.js` and committed so an installed site needs no build step; nothing is loaded from a CDN. The `scripts` block of `layouts/base.njk` prints a deferred script tag only when the rendered `content` holds a `language-` class, so a page without code ships no JavaScript at all. Auto-detection is off and an unregistered language is skipped rather than passed to highlight.js, which throws on one it does not know, so an unknown fence keeps its class and its plain text.

The renderer now puts `tabindex="0"` on every `<pre>` so a wide block scrolls by keyboard, and store migration 3 empties the index on boot so a site that upgrades gets the new markup on its existing posts without touching a file.

The stylesheet carries the Tomorrow palette on light paper and Tomorrow Night on dark as twelve custom properties with the base16 scope mapping over them, plus whole-line diff tints in the spirit of prism-diff.css. Six stock colours were too faint for a page and were moved along their own hue until they made 4.5:1; every one is now a row in the contrast table.

Verified with `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` (1796 + 27 tests, 0 failures), the 11ty suites, and curl against the demo booted on port 8931. The bundle's own behaviour is proved by running the committed file in a Node VM against a DOM stub (`src/web/highlight-bundle.test.ts`), which also fails if the dependency is bumped without a rebuild.
<!-- SECTION:FINAL_SUMMARY:END -->
