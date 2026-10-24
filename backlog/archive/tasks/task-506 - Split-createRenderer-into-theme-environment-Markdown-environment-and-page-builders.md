---
id: TASK-506
title: >-
  Split createRenderer into theme environment, Markdown environment and page
  builders
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 11:41'
updated_date: '2026-10-24 11:53'
labels:
  - refactor
milestone: m-49
dependencies: []
priority: high
type: chore
ordinal: 417800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/web/render.ts:602 createRenderer is one 817-line closure holding theme wiring, Nunjucks filter registration, the ~100-line inner render(), citedBy, feed and listing context, status pages and Markdown rendering. Split it so each concern lives in its own module and the returned renderer only composes them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Theme/Nunjucks environment setup, Markdown environment setup and the page context builders live in separate modules under web/
- [x] #2 No function in the renderer modules is longer than 100 lines; the inner render() delegates head, chrome and share-image context to named helpers
- [x] #3 Rendered HTML, Markdown and gemtext output is unchanged: all existing web tests pass without changes to their assertions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm the cms web tests, test:11ty and typecheck are green before touching anything.
2. Move the request-scoped AsyncLocalStorage helpers (drawnWith, drawnForSignedInReader, drawnWithPageTags, requestSite) to web/render-scope.ts and the template name tables (TEMPLATES, OPTIONAL_TEMPLATES, STATUS_PAGES, CHROME_TEMPLATES, themeTemplate) to web/theme-templates.ts, so the split modules can share them without importing render.ts at runtime; point the existing importers at the new modules.
3. web/theme-environment.ts: createThemeEnvironment builds the HTML Nunjucks environment and the theme render(); render() delegates to named head, chrome and share-image context helpers.
4. web/markdown-environment.ts: createMarkdownEnvironment builds the autoescape-off twin with its filters (escapeMarkdown, fileSize, nest, quote, markdownUrl/geminiUrl) and renderText with the gemtext fallback.
5. web/page-context.ts: the HTML page context builders (citedBy, entryContext, newestPosts, archive, posts page, capsule link), sharing one RenderDeps object built in createRenderer.
6. web/document-render.ts (renderPage with the form-stamp fingerprint, split so no function passes 100 lines), web/listing-render.ts (listing, search, comment and status pages) and web/markdown-chrome.ts (Markdown/gemtext chrome and status text).
7. createRenderer keeps the public types and only composes the pieces.
8. Measure function lengths with the TypeScript compiler API; run pnpm build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Split web/render.ts (1567 lines, createRenderer 817 lines) into:
- render-scope.ts: the AsyncLocalStorage request scope (drawnWith, drawnForSignedInReader, drawnWithPageTags, requestSite and friends).
- theme-templates.ts: TEMPLATES, OPTIONAL_TEMPLATES, CHROME_TEMPLATES, STATUS_PAGES, themeTemplate, writesGemtext, untilContext. Moved out so the split modules never import render.ts at runtime (only types), avoiding an import cycle.
- theme-environment.ts: createThemeEnvironment (HTML Nunjucks environment + render()); render() delegates to headContext, chromeContext and shareImageContext. siteColorsWithTokens lives here too.
- markdown-environment.ts: createMarkdownEnvironment (autoescape-off twin, its filters, renderText with the gemtext fallback).
- page-context.ts: createPageContexts (citedBy, entryContext, newestPosts, archive, posts page, capsule link) plus neighbourContext and replyContextFor.
- document-render.ts: renderPage; documentPageContext, responseContext, syndicationContext, objectIdOf and a createStamps helper for the form-stamp fingerprint.
- listing-render.ts: listing, search and comment pages.
- markdown-chrome.ts: Markdown/gemtext chrome and status text.
render.ts keeps the public types, RenderDeps (shared by every part) and a 43-line createRenderer that composes them. Importers of TEMPLATES/STATUS_PAGES/StatusPageName/drawn* now import from the new modules; index.ts exports TEMPLATES/OPTIONAL_TEMPLATES from theme-templates.ts, so the package's public exports are unchanged.
Function lengths measured with the TypeScript compiler API over all nine modules: longest is createListingPages at 89 lines (before: createRenderer 817, documentPage 118).
Validation: pnpm build, pnpm test (cms 7477/7477, same count as the pre-change baseline; all other packages pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. No test file changed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split the 817-line createRenderer into theme environment (theme-environment.ts), Markdown environment (markdown-environment.ts), shared page context builders (page-context.ts) and page renderers (document-render.ts, listing-render.ts, markdown-chrome.ts), with request scope and template tables in render-scope.ts and theme-templates.ts. createRenderer now only composes them (43 lines); the longest function in any renderer module is 89 lines by TypeScript compiler API measurement, and render() delegates head, chrome and share-image context to named helpers. Behaviour-preserving: build, all tests (cms 7477 pass, same as baseline, no test changed), test:11ty, typecheck, lint and format:check pass.
<!-- SECTION:FINAL_SUMMARY:END -->
