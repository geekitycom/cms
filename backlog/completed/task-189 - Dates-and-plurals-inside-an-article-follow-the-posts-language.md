---
id: TASK-189
title: Dates and plurals inside an article follow the post's language
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 14:00'
updated_date: '2026-10-01 16:06'
labels:
  - i18n
dependencies:
  - TASK-154
references:
  - packages/cms/src/web/templates.ts
  - packages/cms/src/web/locale.ts
priority: low
type: enhancement
ordinal: 205800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-154 marks an article with lang="fr-CA" when a post names its own language, but the date and plural filters still use the site locale (TASK-153), so the published date inside a French article on an English site is written in English. Add an optional locale argument to the date filter (plural already takes one) and have the default theme pass lang / post.lang inside the article only, so the navigation, sidebar and footer stay in the site's locale. Keep docs/eleventy.config.example.js in step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A date rendered inside an article whose post names lang: fr is written in French on an en site
- [x] #2 Dates outside the article (nav, sidebar, footer, archive headings) stay in the site locale
- [x] #3 The date filter accepts an optional locale argument, documented in the default theme README, and the Eleventy example matches
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Filter: date(format, zone, locale). The locale is a third positional argument after zone, so every existing call keeps its meaning; a template that wants the site zone passes none or "" for zone. An empty, missing or unparseable locale falls back to the site locale (siteLocale), so a post with no lang renders as before.
2. Default theme: pass lang (entry/page) or post.lang (listings, search) only to dates inside the article: post.njk screen-reader h1, Published and Updated; page.njk Published and Updated; kicker.line gains a lang parameter used by post-list and search; reply-context reads lang, which post-list sets per item. Conversation, footer year and archive month headings are untouched, so they stay in the site locale.
3. Tests first (HTTP, en site with a lang: fr post and page): French Published/Updated on the entry, French kicker date in the home listing for the fr post and English for the en post, footer and conversation/archive headings in English; filter unit tests for the locale argument and fallback.
4. Docs: default theme README filter table date(format, zone, locale); eleventy.config.example.js date filter gains the locale argument and treats a null/empty zone as the site zone; Eleventy fixture renders a lang: fr date and test:11ty checks it.
5. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check; curl a scratch site on a spare port.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Filter shape: date(format, zone, locale). The locale is a third positional argument after the zone, so every existing call keeps its meaning and nothing guesses whether a string is a zone or a tag; a template keeps the site zone with none (or ""). An empty, missing or unparseable locale falls back to siteLocale, so a post with no lang renders exactly as before (anonymous-pages golden passes unchanged).

Theme: lang / post.lang reaches only the dates inside the <article>: post.njk Published, Updated and the screen-reader h1 of an untitled note; page.njk Published and Updated; kicker.line gains lang= (post-list, search); reply-context reads lang, which post-list sets per item so a listing never leaks one entry's language into the next. Conversation dates, the footer year and archive month headings are untouched and stay in the site locale. Note: the archive month headings sit inside a lang=fr page's article while written in English; AC2 asks for that, but the markup claims fr for them. Not filed; flagging for the orchestrator.

Eleventy example: date gains the same third argument (canonicalised, else the site locale), treats a null/empty zone as the site zone, and siteLocale now shares a canonicalLocale helper. Fixture post.njk prints a Published line with lang and cafe-au-lait.md says lang: fr.

Validation: pnpm build, pnpm test (3015 + 30 pass), pnpm test:11ty (17 pass), typecheck, lint, format:check all clean. New tests failed first for the intended reason (English month names; null zone RangeError under Eleventy). Mutation check: removing the per-item set lang in post-list fails the reply-context listing test. Curled a scratch copy of the demo with a lang: fr post on port 3931 (stopped after): the entry reads Published 20 septembre 2026 / Updated 25 septembre 2026 under <html lang="en">, the home listing's fr kicker reads 20 septembre 2026 and the others 2 September 2026 etc., and no French month name appears outside the fr articles.

Orchestrator follow-up: the archive section on a page whose lang differs from the site's now carries lang=<site language>, so the English month headings are not claimed as French; asserted in article-locale.test.ts.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Dates inside an article now follow the post's language. The date filter takes an optional locale after the zone, date(format, zone, locale), falling back to the site locale when it is empty or no tag. The default theme passes lang / post.lang to the Published and Updated lines, a note's hidden heading, listing and search kickers and the cited reply's date, so a lang: fr post on an en site reads 'Published 2 septembre 2026' while navigation, conversation, archive headings and footer stay in the site locale. Documented in the default theme README; the Eleventy example and its fixture match. Verified with src/web/article-locale.test.ts and locale.test.ts (failing first), test:11ty, the full gate, and curl against a running scratch demo.
<!-- SECTION:FINAL_SUMMARY:END -->
