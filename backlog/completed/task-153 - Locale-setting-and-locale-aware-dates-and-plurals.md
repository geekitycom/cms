---
id: TASK-153
title: Locale setting and locale-aware dates and plurals
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:37'
updated_date: '2026-10-01 13:46'
labels:
  - i18n
milestone: m-23
dependencies: []
references:
  - 'https://specification.website/spec/i18n/locale-content/'
  - 'https://specification.website/spec/i18n/plural-rules/'
priority: medium
type: feature
ordinal: 177800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site language is configurable and sets html lang, but month names are hard-coded in English (src/web/templates.ts, src/admin/formatting.ts) and strings such as the comment count use English plural rules. A site written in another language shows English dates to every reader.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dates on the public site are formatted with Intl.DateTimeFormat in the site's locale (the site language by default, overridable)
- [x] #2 Plural-sensitive strings use Intl.PluralRules
- [x] #3 Theme templates get a date filter that takes a style (for example, long or short) rather than a hard-coded format
- [x] #4 The time element's datetime attribute stays ISO 8601
- [x] #5 Output for an en site is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: one resolved locale per render. siteLocale(site) in web/context.ts returns site.locale when set, else site.language, else en; a tag Intl rejects falls back to en. Bare en formats dates day-month-year (as en-GB), which is what the CMS has always printed, so an en site is unchanged; en-US and other regional tags get their own order.
2. formatDate(value, format, timezone, locale): a table maps each style to Intl.DateTimeFormat options. long/medium/short/full are Intl dateStyle values, readable stays an alias of long, month and year go through Intl too; html and iso stay ISO (calendar day and instant). Formatters are cached per locale+zone+style.
3. The date filter reads the locale from the render's site global like it reads the zone; archiveMonths takes the locale so archive headings follow it.
4. New plural filter: count | plural({ one: ..., other: ... }, locale?) picks a form by Intl.PluralRules category, falls back to other, and replaces # with the count via Intl.NumberFormat without grouping (so en stays 1000, not 1,000). The default theme's reply-count heading and search summary use it; their strings are English so they pass en explicitly.
5. Locale setting: SiteSettings.locale (empty means the language), read from and written to site.json (omitted when empty), validated as a tag Intl accepts, on the General settings screen.
6. Docs: default theme README filter table, eleventy example if it mirrors the filter.
7. TDD each AC: failing test first (formatDate in fr/de/en, filter via a rendered template, plural categories incl. ru/ar, iso datetime unchanged, en golden pages unchanged), then code. Verify with pnpm build/test/typecheck/lint/format:check and curl a running demo site with language fr.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Locale is one tag per render: siteLocale(site) in web/context.ts reads site.locale, then site.language, then en, skipping a tag Intl.getCanonicalLocales rejects. web/locale.ts holds canonicalLocale and pluralForm.

formatDate(value, format, timezone, locale) writes every word format through Intl.DateTimeFormat (formatters cached per locale+zone+format). full/long/medium/short are Intl dateStyle values; readable stays as an alias of long; month and year go through Intl too. html stays the ISO calendar day and iso the UTC instant. Bare en formats as en-GB (day first), which is what the CMS printed before; en-US and other regional tags get their own order. archiveMonths takes the locale so archive month headings follow it.

New plural filter: count | plural(forms, locale?) selects by Intl.PluralRules category, falls back to other, and writes # with Intl.NumberFormat without grouping so en stays 1000 rather than 1,000. The default theme's reply heading and search summary use it with an explicit "en" because their words are English; with the site locale instead, a ru site would print 'One reply' for 21 replies. 'Nothing found' (0 results) stays its own sentence.

Locale setting: SiteSettings.locale (empty default, omitted from site.json when empty, validated as LANGUAGE_TAG_PATTERN plus Intl) on Settings > General. Docs: default theme README filter table, both READMEs' settings lists, eleventy.config.example.js date filter now uses Intl and the locale, and gains plural.

Not changed: admin/formatting.ts. The admin UI is English and the task's criteria are about the public site, so its scheduled-for line stays English.

Validation: pnpm build && pnpm test (2776 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass. The anonymous-pages golden test (bodies pinned by etag) and the conversation-markup tests pass unchanged, so en output is unchanged. Curled a geekity init site served from dist: fr gives 'Published 1 janvier 2026', de '1. Januar 2026', ru '1 января 2026 г.', en '1 January 2026', en + locale en-US 'January 1, 2026'. datetime stays 2026-01-01T09:00:00.000Z throughout, and the search summary stays 'One result for ...'. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the public site's dates and counts follow the site's locale. A new optional locale setting on Settings > General defaults to the site language. The date filter now formats through Intl.DateTimeFormat in that locale and takes Intl styles (full, long, medium, short; readable = long; month; year), while html and iso stay ISO 8601. A new plural filter picks forms by Intl.PluralRules, and the default theme's reply and search counts use it. Bare en keeps the day-first output, so en sites are byte-identical (golden etag test). Verified with locale.test.ts, settings-general tests, the full gate, and curl against a running site in fr/de/ru/en/en-US.
<!-- SECTION:FINAL_SUMMARY:END -->
