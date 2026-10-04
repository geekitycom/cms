---
id: TASK-260
title: 'Never let one stored URL break the feeds, and refuse backslash paths'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:14'
updated_date: '2026-10-04 01:31'
labels:
  - security
  - feeds
dependencies: []
priority: high
type: bug
ordinal: 275800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Red-team round C on TASK-258 (2026-10-03): a relative URL the post cleaner keeps, such as <a href="/\\javascript:alert(1)">, <img src="/\\["> or href="/\\x y", makes absoluteUrl (packages/cms/src/web/negotiate.ts:263) throw TypeError: Invalid URL inside absoluteHtmlUrls -> resolveForFeed, and feedItems maps every document without a catch, so one post takes down RSS, Atom and JSON Feed. Browsers also read /\\host as a protocol-relative URL, so on the page /\\evil.com links off-site. The editor can store the same body, so this is not Micropub-only. Make absolute-URL resolution in feeds total (leave or drop a URL it cannot resolve, never throw) and have the post cleaner (postUrl in web/sanitize.ts) refuse a relative URL that starts with a slash followed by a backslash, or contains a backslash before the path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post with an unresolvable URL in its body leaves every feed serving 200 with the other items intact
- [x] #2 The Micropub cleaner drops href/src values beginning /\\ or //, and other backslash-before-path forms; tests use the red-team payloads
- [x] #3 A test proves a single bad document cannot fail feedItems
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root cause: absoluteUrl (web/negotiate.ts) calls new URL on content-derived strings (body href/src/srcset via absoluteHtmlUrls -> resolveForFeed, front matter image), and feedItems maps without a catch. Photos and enclosures are already validated (isUploadUrl/isWebUrl).
2. Make absoluteUrl total: URL.parse, and an address it cannot resolve comes back as given. Keep, not drop: the page carries the same attribute, and a reader's URL parser fails on it exactly as the browser does, so the link is inert in both; dropping would make the feed disagree with the page and lose the author's words around an image. The base URL is config and stays strict.
3. postUrl (web/sanitize.ts, used by cleanPostHtml for Micropub HTML and HTML inside Markdown) refuses an address whose first two characters are any of / and \ (protocol-relative, /\, \\, \/), after control characters are removed and entities decoded.
4. Failing tests first: content.test.ts (red-team payloads plus //, \\, \/, /&#92;, tab forms), feed-item.test.ts (feedItems with one bad document among good ones; bad addresses kept as written), feeds.test.ts (RSS, Atom, JSON Feed all 200 with both posts).
5. Rerun redteam-c/feeddos.mts; full gate. FEED_ITEM_REVISION unchanged unless bytes for a parseable post change (they do not: only previously-throwing inputs differ).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
absoluteUrl (web/negotiate.ts) now resolves with URL.parse and returns an unresolvable address as given; the base URL (config) still parses strictly. Kept rather than dropped: the page carries the same attribute, a reader's URL parser fails on it as the browser does so the link is inert in both, and dropping would make the feed disagree with the page. This covers absoluteHtmlUrls -> resolveForFeed (href/src/srcset) and the front matter image; photos and enclosures were already validated (isUploadUrl refuses backslashes, isWebUrl parses). No catch added in feedItems: the throw had one root cause, now fixed.
postUrl (web/sanitize.ts) refuses any address whose first two characters are / or \ in any order (//host, /\host, \\host, \/host), checked after entity decoding, control-character removal and trimming, so /&#92;host, '/<tab>\host' and '  //host' are caught. It serves cleanPostHtml for Micropub {html} and for raw HTML in Micropub Markdown. Markdown link syntax is not affected: markdown-it already percent-encodes a backslash, and [x](//host) remains a plain off-site link, as an https link would be.
Feed bytes change only for inputs that used to throw, so FEED_ITEM_REVISION stays 10 and the golden file did not move.
Tests written first and seen failing: content.test.ts 'an address that starts with two slashes, either way round' (9 payloads incl. the red-team three, HTML and Markdown paths) plus a relative-path keep case; feed-item.test.ts 'a post with an address nothing can resolve' (feedItems over good, bad, good; bad addresses and image kept as written); feeds.test.ts RSS, Atom and JSON Feed all 200 with both posts.
Red-team rerun: redteam-c/feeddos.mts all three payloads stored as <a>x</a> / <img> and feed ok; redteam-c/feeddos-owner.mts (same payloads plus srcset and image: /\[ in an owner file, bypassing the cleaner) feed ok, addresses kept as written, the good srcset candidate still absolutised; curated.mts n=274 bad=0 refused=8.
Gate: pnpm build, test (3903 + 30 pass), typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
One unresolvable address can no longer take down the feeds: absoluteUrl returns an address it cannot parse as written instead of throwing, so RSS, Atom and JSON Feed serve every post and the bad link stays as inert as it is on the page. The Micropub post cleaner drops href/src values that open with two slashes either way round (//, /\, \\, \/, including entity and control-character spellings), which browsers read as off-site. Verified by new tests in content.test.ts, feed-item.test.ts and feeds.test.ts (seen failing first), the redteam-c feeddos scripts and curated sweep, and the full gate.
<!-- SECTION:FINAL_SUMMARY:END -->
