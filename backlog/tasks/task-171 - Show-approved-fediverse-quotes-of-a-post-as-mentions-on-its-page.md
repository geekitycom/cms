---
id: TASK-171
title: Show approved fediverse quotes of a post as mentions on its page
status: To Do
assignee: []
created_date: '2026-09-29 02:06'
labels:
  - federation
dependencies:
  - TASK-125
references:
  - 'https://codeberg.org/fediverse/fep/src/branch/main/fep/044f/fep-044f.md'
documentation:
  - backlog/docs/doc-4 - ActivityPub Federation.md
priority: medium
type: feature
ordinal: 195800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post on this site can now be quoted from Mastodon (TASK-125), but the quote never appears on the quoted post. On shll.me, a quote from me.dm was approved (content/_data/federation/a/quotes.json) and its Create reached the shared inbox and was logged: object.type Note, object.quote naming the post (with the older spellings quoteUri, quoteUrl and _misskey_quote alongside it), and inReplyTo null. The conversation code only builds interactions from logged Creates whose object has inReplyTo naming a post (replyFrom in packages/cms/src/federation/replies.ts, buildConversation in src/web/conversation.ts), so the quote is silently dropped. A quote is a post elsewhere that talks about this one, which is what the Mentions group under a post already means for a webmention mention; it is not an answer in this thread, and Mastodon also keeps quotes apart from replies. FEP-044f says an unapproved quote should not be displayed, and TASK-125 already records approvals and withdraws them on Undo or Delete.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A logged Create whose object names one of this site's posts in quote (or quoteUri, quoteUrl, _misskey_quote) and has an approval in quotes.json appears in that post's Mentions group, with its author, a link to the quote, and an excerpt
- [ ] #2 A quote with no approval (refused, withdrawn, or never requested) is not shown
- [ ] #3 Undoing the QuoteRequest or deleting the quote removes it from the page
- [ ] #4 A quote that is also a reply (inReplyTo set) is shown once, as a reply
- [ ] #5 The quote is rebuilt from the logged inbox JSON and the approval file, so deleting the SQLite index loses nothing (decision-9)
- [ ] #6 The quote's content is sanitised the same way a fediverse reply's is
- [ ] #7 Mention counts, and the comments feeds if they include mentions, count the quote consistently with the page
- [ ] #8 Verified on a real site: the me.dm quote of https://shll.me/2026/09/this-post-should-be-able/ shows under that post
<!-- AC:END -->
