---
id: TASK-154
title: Per-post language
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:37'
updated_date: '2026-10-01 13:58'
labels:
  - i18n
  - federation
milestone: m-23
dependencies:
  - TASK-153
references:
  - 'https://specification.website/spec/accessibility/document-language/'
  - 'https://specification.website/spec/i18n/lang-attribute/'
priority: low
type: feature
ordinal: 178800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A site has one language, but some writers post in more than one. A post in another language should declare it, so screen readers pronounce it correctly, browsers offer to translate it, and fediverse clients filter it by language.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post or page can set lang in front matter and the editor offers it
- [x] #2 The default theme puts lang on the article element when it differs from the site's
- [x] #3 Feeds carry the post's language where the format allows
- [x] #4 Federated objects carry contentMap and summaryMap keyed by the post's language
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: a document's language is the front matter key `lang`, kept in Document.extra like `comments` and `contact` (no index schema change, and Eleventy reads it as page data). One reader, documentLanguage(document) in web/locale.ts, returns the canonical BCP 47 tag or undefined for an absent or malformed one.

1. Editor (AC1): a Language field on the post and page editor; EditorForm gains lang, formFor reads extra.lang, resolveExtra writes or deletes it, a save refuses a value that fails LANGUAGE_TAG_PATTERN. Test: save writes lang, empty removes it, bad tag refused, editor shows the field with the value.
2. Theme (AC2): documentContext exposes lang as the canonical tag (dropping a malformed one); post.njk, page.njk, post-list.njk and search.njk put lang on the article only when it differs from site.language. Test: rendered entry and listing carry lang for a fr post on an en site and none for an en post.
3. Feeds (AC3): FeedItem gains language when the post's differs from the feed's; Atom writes xml:lang on the entry, RSS writes dc:language on the item, JSON Feed writes item language and the feed's top-level language. Bump FEED_ITEM_REVISION. Tests in feed-formats.
4. Federation (AC4): postObject sends contents/summaries as [plain, LanguageString(lang)] so the object carries contentMap and summaryMap keyed by the post's language, else the site's. Test on the JSON-LD.
5. Docs: theme README and package README mention lang; Eleventy example unchanged unless filter behavior changes.
6. Verify: pnpm build, test, typecheck, lint, format:check; curl a running demo for the entry, feeds and AS2 object.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: `lang` stays in Document.extra, like `comments` and `contact`, so the index schema is untouched and an Eleventy build reads it as page data. documentLanguage() in web/locale.ts is the one reader; it canonicalises the tag (fr-ca -> fr-CA) and drops a value Intl rejects, so a hand-edited typo never reaches an attribute, a feed or the wire.

AC1: Language field on the post and page editor, hint names the site language; empty removes the key; a value failing LANGUAGE_TAG_PATTERN is refused with a 400 and nothing written.
AC2: documentContext exposes canonical `lang`; partials/lang.njk prints lang="…" only when it differs from site.language; used on the article in post.njk, page.njk, post-list.njk and search.njk. <html lang> stays the site's language on purpose: the page chrome is in the site's language, so only the article changes.
AC3: FeedItem.language when the post's language differs from the feed's; RSS dc:language (dc namespace already declared), Atom entry xml:lang, JSON Feed item language, plus the JSON Feed's top-level language. FEED_ITEM_REVISION 4 -> 5, which moves every post feed's ETag once; the anonymous-pages golden was regenerated and differs only in that ETag.
AC4: postObject sends contents (and an Article's summaries) as [plain, LanguageString(lang)], so the object carries content plus contentMap and summary plus summaryMap, keyed by the post's lang, else the site's language.

Not done, deliberately: the date and plural filters still read the site locale, not the document's. A per-document date locale inside a lang=fr article on an en page is a separate decision (the kicker and Published line are theme chrome in the site's language) and no criterion asks for it.

Validation: pnpm build, pnpm test (2794 + 30 pass), pnpm test:11ty (16 pass), typecheck, lint, format:check all clean. Curled a scratch copy of the demo with a lang: fr-CA post on port 3917 (server stopped after): entry and home listing carry lang="fr-CA" on the article with <html lang="en">; /feed/ has <dc:language>fr-CA</dc:language>; /feed/atom/ has <entry xml:lang="fr-CA">; /feed/json/ has language en and the item language fr-CA; the AS2 object has contentMap and summaryMap keyed fr-ca, and an English post's are keyed en.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Posts and pages can name their language with `lang` front matter, which the editor offers as a Language field (validated as a BCP 47 tag; empty means the site's). The default theme marks the article with lang when it differs from site.language, in entries, listings and search. RSS items carry dc:language, Atom entries xml:lang and JSON Feed items language when the post's differs from the feed's, and the JSON Feed now declares its own language; FEED_ITEM_REVISION is 5. Federated Notes and Articles carry contentMap, and Articles summaryMap, keyed by the post's language or the site's. Verified with new tests per criterion (editor HTTP round trips, rendered pages, feed serialisers and served feeds, served AS2 JSON-LD), the full build/test/typecheck/lint/format run, and curl against a running scratch demo.
<!-- SECTION:FINAL_SUMMARY:END -->
