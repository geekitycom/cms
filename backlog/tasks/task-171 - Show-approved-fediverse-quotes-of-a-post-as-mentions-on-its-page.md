---
id: TASK-171
title: Show approved fediverse quotes of a post as mentions on its page
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-29 02:06'
updated_date: '2026-09-29 02:28'
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
- [x] #1 A logged Create whose object names one of this site's posts in quote (or quoteUri, quoteUrl, _misskey_quote) and has an approval in quotes.json appears in that post's Mentions group, with its author, a link to the quote, and an excerpt
- [x] #2 A quote with no approval (refused, withdrawn, or never requested) is not shown
- [x] #3 Undoing the QuoteRequest or deleting the quote removes it from the page
- [x] #4 A quote that is also a reply (inReplyTo set) is shown once, as a reply
- [x] #5 The quote is rebuilt from the logged inbox JSON and the approval file, so deleting the SQLite index loses nothing (decision-9)
- [x] #6 The quote's content is sanitised the same way a fediverse reply's is
- [x] #7 Mention counts, and the comments feeds if they include mentions, count the quote consistently with the page
- [ ] #8 Verified on a real site: the me.dm quote of https://shll.me/2026/09/this-post-should-be-able/ shows under that post
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: a Quote read out of a logged Create, { id, url, actorId, html, published, quoted } where quoted is the first URI among object.quote, quoteUri, quoteUrl, _misskey_quote, and only when the object has no inReplyTo (a quote that replies is a reply, AC #4). Shown only when an approval in some user's quotes.json names that quote, that post and that actor. Both inputs are files (inbox JSONL + quotes.json), so nothing new goes in SQLite (AC #5).

1. federation/replies.ts: quoteFrom(activity) beside replyFrom, sharing the note parsing.
2. federation/quotes.ts: readAllQuoteAuthorizations(contentDir) over federatedUsernames.
3. web/conversation.ts: ConversationContext gains contentDir; one quotedIn(approvals, objectId) helper finds, per approval for the post, the logged Create of the approved quote by the approved actor naming the post, as an Interaction { source: activitypub, kind: mention, content sanitised by sanitizeCommentHtml }. postConversation puts them in mentions (AC #1, #2, #6); counts adds them (AC #7); latest adds them per post (AC #7). index.ts passes contentDir.
4. Tests first: conversation.test.ts unit cases (approved shown, unapproved not, reply-quote shown once, sanitised, counts, latest); quotes.test.ts end to end over signed HTTP with the me.dm Create shape: page shows it, Undo and Delete remove it, deleting the database and rebooting keeps it (AC #3, #5).
5. Theme README: kind mention can be a fediverse quote. doc-4 notes quotes.json and quote mentions.
6. Gates, curl a running site, notes. AC #8 left for shll.me.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned.
- federation/replies.ts: quoteFrom(activity) reads a logged Create whose Note names what it quotes in quote, quoteUri, quoteUrl or _misskey_quote (first found wins) and has no inReplyTo. replyFrom and quoteFrom share one noteFrom parser.
- federation/quotes.ts: readAllQuoteAuthorizations(contentDir) reads every user's quotes.json.
- web/conversation.ts: ConversationContext gains a required contentDir. quotesOf walks the approvals for a post and asks the inbox index for each approved quote's Create, keeping it only when the actor is the approved actor and the note quotes this post. The result is a mention with source activitypub and content sanitised by sanitizeCommentHtml, like a fediverse reply. thread() adds quotes to mentions, counts() adds them to a post's source:comments number, latest() adds them to /comments/feed/.
- Nothing new goes in SQLite. The approval file and the inbox JSONL are both read at request time, so revoking an approval hides the quote on the next request with no restart.
- Breaking for anyone calling the exported createConversation directly: ConversationContext.contentDir is required. The only caller in the repo is createCms.
- The theme README's conversation table now says a mention can be an approved fediverse quote.
- The default theme shows mentions as a facepile of author and link, the same as a webmention mention. The quote's words (the excerpt) are in the interaction's content, which the comments feeds print. The facepile does not show them.

Validation:
- pnpm build, pnpm test (2350 + 30 pass), pnpm typecheck, pnpm lint and pnpm format:check all pass.
- New tests. quotes.test.ts 'an approved quote on the quoted post's page (TASK-171)' has 7 tests over signed HTTP with the me.dm Create shape at the shared inbox, covering AC #1 to #6. Its AC #5 test deletes geekity.db and reboots. conversation.test.ts 'a quote of a post (TASK-171)' has 11 unit tests, covering each spelling, the wrong post, the wrong actor, quoting something else, reply-and-quote, counts and latest.
- Failing first: before the change, the mention, feed and database-rebuild tests failed with 'the page has a Mentions group' false. Mutation checks: dropping the actor check failed 'approved for another actor'. Dropping the inReplyTo check failed both reply-once tests. Showing quotes whatever the approvals say failed AC #2 and both AC #3 tests.
- Live server: a scratch site from geekity init was served at 127.0.0.1:4817. Its fixture inbox held the me.dm-shaped Create plus an unapproved one, and quotes.json held one approval. curl of the post showed 'Mentions (1)' linking https://me.dm/@andrewshell/117351853054835652 under @andrewshell@me.dm, and the unapproved quote was absent. The post feed carried the quote with its script stripped, /comments/feed/ listed it, and /feed/ said source:comments count=1. After deleting data/geekity.db* and restarting, the page still showed Mentions (1). After emptying quotes.json, the page had no Mentions and the count was 0. The server was stopped.

AC #8 is not verified. It needs the deployed shll.me. Manual steps:
1. Deploy this build to shll.me. Nothing has to be resent, because the approval (content/_data/federation/a/quotes.json) and the Create (inbox JSONL) are already on disk.
2. Open https://shll.me/2026/09/this-post-should-be-able/. Check that Mentions (1) links to https://me.dm/@andrewshell/117351853054835652 under the me.dm author.
3. Check that https://shll.me/2026/09/this-post-should-be-able/feed/ has the quote as an item, and that the site /feed/ source:comments count includes it.

Follow-ups, not done here: doc-4's Inbox and Storage sections still do not list quotes.json or quote mentions (carried over from TASK-125). The post page ETag is document.hash, so a conditional GET of the HTML can return 304 after a new reply or quote. That is the same for replies today and was not changed here.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An approved fediverse quote of a post now shows in that post's Mentions group, with its author, a link to the quote and its sanitised words. It also appears in the post's comments feed, in /comments/feed/ and in the source:comments count. The quote is read from the logged Create (quote, quoteUri, quoteUrl or _misskey_quote, with no inReplyTo) and shows only while quotes.json holds an approval for that quote, post and actor. An Undo or Delete that revokes the approval hides it. A quote that also replies shows once, as a reply. Both inputs are files, so deleting the database loses nothing. Verified by signed-HTTP and unit tests, mutation checks, and curl against a running scratch site. AC #8 is still open and needs the deployed shll.me.
<!-- SECTION:FINAL_SUMMARY:END -->
