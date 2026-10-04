---
id: TASK-259
title: Keep feed and ActivityPub excerpts escaped
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:14'
updated_date: '2026-10-04 01:27'
labels:
  - security
  - feeds
  - federation
dependencies: []
priority: high
type: bug
ordinal: 274800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Red-team round C on TASK-258 (2026-10-03): feedExcerpt -> excerptFromHtml (packages/cms/src/web/feed-item.ts:332) strips tags and then decodes &lt; and &gt;, so a post whose text is the escaped string &lt;img src=x onerror=alert(1)&gt; (or \<img …>, or a code span holding a tag) is inert on the page but becomes a live <img onerror> in the RSS <description> (entity-encoded HTML) and in the ActivityPub Article summary (federation/article.ts:310, HTML by spec). A Micropub summary property also reaches feedExcerpt uncleaned via document.description. JSON Feed summary, Atom summary type=text and oEmbed are plain text and safe. Make an excerpt plain text that is escaped for every HTML context it lands in, and treat a description from front matter or Micropub as text, not markup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post whose text holds escaped markup, a backslash-escaped tag or a code span with a tag yields an RSS description and an ActivityPub summary that a browser parses as text, tested with the red-team payloads
- [x] #2 A Micropub or front matter summary/description containing markup is escaped in every HTML context it reaches
- [x] #3 Plain-text contexts (JSON Feed, Atom type=text, oEmbed) are unchanged; FEED_ITEM_REVISION is bumped if bytes change
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. The excerpt stays the plain text feedExcerpt/excerptFromHtml already produce (decoded once, never re-read as markup); a front matter or Micropub description is that same text.
2. Add excerptHtml(text) in web/feed-item.ts: the text escaped for an HTML text node (& < > only, so no &apos; an HTML 4 parser misreads).
3. HTML contexts escape it: RSS item and comment <description> (entity-encoded HTML, so escapeXml(excerptHtml(text))), and the ActivityPub Article summary (HTML by spec).
4. Plain-text contexts stay as they are: JSON Feed summary, Atom summary type=text, oEmbed card (already escapeXml), theme templates (autoescape).
5. Failing tests first with the red-team payloads (escaped markup, backslash-escaped tag, code span, {html} with escaped tag, description/summary with markup): parse the RSS description once as XML and then as HTML (parse5) and assert no element; same for the AP summary.
6. Bump FEED_ITEM_REVISION to 10, refresh the ETag fixtures and golden file.
7. Rerun redteam-c/excerpt.mts against the real outputs; full gate.

8. Comments feeds carry no FEED_ITEM_REVISION, so their ETag label moves once (comments:rss:2) because comment descriptions are escaped too.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
excerptHtml (web/feed-item.ts) escapes & < > of the plain-text excerpt; used by the RSS item description, the RSS comment description and the ActivityStreams Article summary/summaryMap. FeedItem.summary stays plain text, so JSON Feed summary, Atom summary type=text, oEmbed (escapeXml) and theme templates (autoescape) are unchanged. Micropub summary maps to front matter description (micropub/create.ts), so both are the same text path.
Bytes: an RSS description or AP summary changes only where the excerpt holds & < >; FEED_ITEM_REVISION 9 -> 10, ETag fixtures in feed-enclosure.test.ts refreshed (bytes unchanged there), anonymous-pages golden regenerated (only /feed/ ETag moved). Comments feed ETag label comments:rss -> comments:rss:2.
Tests written first and seen failing: feeds.test.ts 'a summary that reads like markup' (escaped markup, backslash tag, code span, description; RSS escaped, Atom/JSON plain), comment feed description; article.test.ts summary + summaryMap for the same four payloads; html-content.test.ts Micropub {html} with escaped tag and a summary property with markup (RSS + AP), proved failing with excerptHtml stubbed to identity.
Red-team rerun: redteam-c/excerpt-real.mts runs the excerpt.mts payloads plus <script> and double-escaped forms and a front matter description through rssItem(feedItem()) and excerptHtml(feedExcerpt()): ALL INERT (0 flags). The original excerpt.mts calls element('description', excerpt) directly, bypassing rssItem, so it prints the same as before by construction.
Gate: pnpm build, test (3890 + 30 pass), typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An excerpt stays plain text and is escaped (& < >) wherever it is read as HTML: the RSS item and comment descriptions and the ActivityStreams Article summary. Text that is inert on the page (escaped markup, a backslash-escaped tag, a code span) or a description/Micropub summary holding markup now reaches readers and Mastodon as text. JSON Feed, Atom type=text and oEmbed are unchanged. FEED_ITEM_REVISION is 10 and the comments feed ETag label moved once. Verified by new tests in feeds.test.ts, article.test.ts and html-content.test.ts (seen failing first), redteam-c/excerpt-real.mts (all inert), and the full gate.
<!-- SECTION:FINAL_SUMMARY:END -->
