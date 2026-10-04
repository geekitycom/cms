---
id: TASK-259
title: Keep feed and ActivityPub excerpts escaped
status: To Do
assignee: []
created_date: '2026-10-04 01:14'
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
- [ ] #1 A post whose text holds escaped markup, a backslash-escaped tag or a code span with a tag yields an RSS description and an ActivityPub summary that a browser parses as text, tested with the red-team payloads
- [ ] #2 A Micropub or front matter summary/description containing markup is escaped in every HTML context it reaches
- [ ] #3 Plain-text contexts (JSON Feed, Atom type=text, oEmbed) are unchanged; FEED_ITEM_REVISION is bumped if bytes change
<!-- AC:END -->
