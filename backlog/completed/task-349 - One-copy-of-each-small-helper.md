---
id: TASK-349
title: One copy of each small helper
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-11 17:49'
labels: []
milestone: m-32
dependencies:
  - TASK-348
type: chore
ordinal: 308800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The architecture review found many hand-copied helpers in packages/cms/src: messageOf (21 copies), isRecord (14 including plugins), the form string coercion field()/text() (about 20), exists()/ENOENT checks (about 6), two full HTML entity decoders (web/sanitize.ts, webmention/html.ts), HTML escapers (12 copies that disagree on > " and quote), and Math.ceil(total/size) page counts outside web/pagination.ts. Each should exist once, so a fix lands once.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 messageOf, isRecord, the form string coercion and a file exists check each have one definition in cms, imported everywhere they were copied
- [x] #2 HTML escaping uses one text escaper and one attribute escaper; no file keeps a private escaper, and existing output tests still pass
- [x] #3 The two full entity decoders are one function
- [x] #4 Page counts outside pagination.ts call a pagination.ts helper
- [x] #5 Nullable form-field variants that mean something different (null or undefined for empty) stay distinct and named for what they do
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add neutral helpers under packages/cms/src/util/, tests first (tdd): errors.ts messageOf; guards.ts isRecord; forms.ts stringOrEmpty (form field or empty) and nonEmptyStringOrNull (the distinct nullable variant); files.ts exists/isFile/isNotFound; html.ts escapeText (& < >), escapeAttribute (& < > " '), decodeEntities (the sanitize/webmention decoder). Add pageCount to web/pagination.ts.
2. Replace every copy: 21 messageOf plus inline 'instanceof Error ? .message : String' sites; 11 isRecord (federation/quotes keeps its narrower guard, renamed); form text/field/bodyField copies; exists copies in admin/documents, admin/media, content/save, content/sync; escapers per call-site context (text vs attribute) in comments/markdown, web/sanitize, web/search, web/context, content/read, content/video, federation/article, federation/cited-post, federation/actor, notifications/routes, webmention/html, web/feed-item excerptHtml, webmention/receive paragraph; decoders in web/sanitize and webmention/html (plus the small markup/feed-item decoders if output holds).
3. Keep distinct and descriptively named: admin/store nullableText (string or null), content/store string-or-undefined, admin/media trimmed field via stringOrEmpty().trim(). Leave escapeXml (XML, drops invalid chars, &apos;) and content/search decodeEntities (lossy indexer: extra named entities, case-insensitive, invalid code points to space).
4. Page counts in web/routes, admin/comments, admin/messages, admin/media, web/sitemap call pageCount.
5. Update expected strings where escaping bytes changed; verify with pnpm build/test/typecheck/lint/format:check and a grep showing no copies remain.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shared helpers (tests first, all in packages/cms/src/util/ plus web/pagination.ts):
- util/errors.ts messageOf: replaced 21 local copies, editor-actions describe(), and ~25 inline 'x instanceof Error ? x.message : String(x)' expressions (cli, cache, index, indexnow, plugins/*, web/*, admin/*, federation/keys, webmention/*, indieauth/activity-log).
- util/guards.ts isRecord: replaced 11 copies plus 6 inline typeof/null/Array checks (plugins/settings, web/context, admin/settings, content/enclosure, micropub/create, micropub/endpoint). federation/quotes' narrower guard renamed isQuoteAuthorization. contact/records record() (accepts arrays, returns {}) left alone.
- util/forms.ts stringOrEmpty: replaced every text()/field() empty-string copy (admin/*, comments/routes, contact/routes, contact/records, webmention/routes, notifications/routes, indieauth/consent, indieauth/connected-apps) and settings-page bodyField (removed from admin/index.ts barrel; not public). admin/media's trimming field() became stringOrEmpty(x).trim().
- AC#5: nonEmptyStringOrNull (empty or non-string -> null) replaces optionalText in comments/records and federation/records and text() in admin/federation. Distinct and kept/renamed: admin/store nullableText (string or null, keeps ''), content/store text -> stringOrUndefined, federation/replies textOf (JSON-LD arrays), indieauth/activity-log formText (FormData).
- util/files.ts exists/isFile/isFileSync/isNotFound: replaced exists in admin/documents, content/save, content/sync (+ its isNotFound), admin/media exists -> isFile, admin/settings sync isFile -> isFileSync, __testing__/cli.ts exists re-exports util. Behaviour change: documents/save used access() and swallowed every error; now only ENOENT/ENOTDIR/EISDIR read as missing and EACCES etc. throw.
- util/html.ts escapeText (& < >), escapeAttribute (& < > " '), decodeEntities (the identical web/sanitize + webmention/html decoder, one function). Call sites switched by context (text node vs attribute) in comments/markdown, web/sanitize, web/search, web/context, content/read, content/video, federation/article, federation/cited-post, federation/actor, notifications/routes, webmention/html, webmention/receive, web/feed-rss (excerptHtml removed). Small 5-entity decoders in images/markup and web/feed-item now use decodeEntities too. sanitize keeps decode-then-escape for text nodes: escapeText(decodeEntities(x)); its kept href (already decoded by safeHref) now escapeAttribute(href) without a second decode.
- Kept on purpose: web/feed-xml escapeXml (XML: drops invalid XML chars, &apos;; public export, also used by oembed/sitemap/opensearch/pingback); content/search decodeEntities (lossy indexer: case-insensitive, extra typographic names, invalid code points to a space; folding it into the shared decoder would change what sanitize re-emits).
- web/pagination.ts pageCount: paginate, web/routes (2), admin/comments, admin/messages, admin/media, web/sitemap (chunkCount removed; only called when the list is split so the max(1) never applies).

Output bytes that changed:
- Text nodes no longer escape quotes: sanitized post/comment text (&#39; and &quot; become ' and "), web/search snippet, content/read cite/author/uid label, federation actor link text, notifications pages, webmention rebuilt fragment text. read.test.ts and sanitize.test.ts expectations updated.
- Attributes now always escape both quotes: apostrophe -> &#39; where comments/markdown, web/sanitize, web/context, content/read, webmention/html, federation/article attrs did not; content/video src/href now also escape > and '.
- RSS/feed excerpts now resolve numeric references and &nbsp; (It&#8217;s used to publish as &amp;#8217;) - pinned by a new feed-item test that fails on the old decoder.

Verification: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check exit 0; cms 5524/5524, demo 32, plugin-llm 48, tag-suggest 31, post-summary 22, wordpress 104 all pass.
Grep (packages/cms/src, non-test): grep -rnE '^(export )?(async )?function (messageOf|isRecord|exists|isFile|isFileSync|isNotFound|escapeHtml|escapeText|escapeAttribute|decodeEntities|decodeHtmlText|bodyField|pageCount|optionalText)\b' -> only util/errors, util/guards, util/html, util/files, web/pagination, plus admin/accounts optionalText(key, value) (a different spread helper) and content/search decodeEntities (kept, above). grep -rnE '^function (text|field)\(value: unknown\)' -> none. grep 'instanceof Error ? x.message : String' -> only util/errors. Math.ceil page counts -> only pagination.ts.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the hand-copied helpers in packages/cms/src into packages/cms/src/util/ (errors.ts messageOf, guards.ts isRecord, forms.ts stringOrEmpty + nonEmptyStringOrNull, files.ts exists/isFile/isFileSync/isNotFound, html.ts escapeText/escapeAttribute/decodeEntities), plus pageCount in web/pagination.ts. Every copy and inline equivalent now imports them. Escaping is chosen by context, so some bytes changed: text nodes no longer escape quotes, attributes always escape both quotes, and feed excerpts resolve numeric references. escapeXml and content/search's lossy decoder are kept on purpose, and the notes say why. Verified with pnpm build, test, typecheck, lint and format:check, all exit 0 (cms 5524 tests pass), plus the grep recorded in the notes.
<!-- SECTION:FINAL_SUMMARY:END -->
