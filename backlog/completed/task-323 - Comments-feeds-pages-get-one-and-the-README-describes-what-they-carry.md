---
id: TASK-323
title: 'Comments feeds: pages get one, and the README describes what they carry'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 12:52'
updated_date: '2026-10-10 15:17'
labels:
  - comments
  - feeds
dependencies: []
references:
  - packages/cms/src/web/routes.ts
  - packages/cms/src/web/conversation.ts
  - packages/cms/README.md
priority: low
type: enhancement
ordinal: 282800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CMS README's comments feed section (packages/cms/README.md, around "This CMS stores no comments of its own") predates native comments and webmentions. It says the feeds carry only fediverse replies, but both feeds read the same ConversationReader as the thread (web/conversation.ts): native comments, webmention replies and mentions, and fediverse replies, without likes and reposts.

It also says a page has no comments feed because pages never federate (web/routes.ts, the comments route for a permalink). Pages accept comments since TASK-196, so that reason no longer holds: a page with a conversation should have a {permalink}feed/ like a post, and its comments should be in /comments/feed/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A published page that accepts comments answers {permalink}feed/ with an RSS comments feed of its conversation, empty when it has none; a page that does not accept comments 404s there as today
- [x] #2 /comments/feed/ includes comments on pages, naming the page as it names a post
- [x] #3 The page advertises its comments feed the way a post does
- [x] #4 The README comments feed section describes what the feeds carry today: native comments, webmention replies and mentions, and fediverse replies, without likes and reposts, and that pages have one
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rule: a page has a comments feed exactly when answerable() (comments/policy.ts) says it shows its conversation, the same rule render.ts and commentPage use. Posts keep theirs whatever their comment state.
2. web/routes.ts parseFeedPath: accept {permalink}feed/ for a post or an answerable page (site policy, store clock); 404 otherwise. The ?feed=rss2 redirect on a permalink follows the same rule.
3. web/render.ts: put commentsFeed on the context for a served post (as now) and for an answerable page, so base.njk's alternates advertise it.
4. web/conversation.ts siteConversation: drop answers under a document that is not answerable, so /comments/feed/ carries an open page's comments (named by postLabel like a post's) and never a closed page's, matching the page.
5. Tests first in web/page-comments-feed.test.ts; update feeds.test.ts cases that asserted pages have no feed.
6. README ### Comments feed section rewritten; theme README note on commentsFeed updated.
7. Verify: build, test, typecheck, lint, format:check, curl a scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rule: a document has a {permalink}feed/ exactly when answerable() (comments/policy.ts) says its page shows its conversation: every post, and a page while it takes comments (comments: true and the site switch on). The same rule now gates the ?feed=rss2 redirect, commentsFeed on the render context (plus isServed), and which answers /comments/feed/ carries: siteConversation drops answers under a page that takes no comments, which it used to include (a closed page's approved comments leaked into the site feed).
Tests: src/web/page-comments-feed.test.ts (7 cases) failed first on 404s, the missing redirect, the closed page's comment in /comments/feed/ and the missing <link>; all pass now. feeds.test.ts wording updated.
Verified: pnpm build, pnpm test (cms 5273 pass, all packages green), typecheck, lint, format:check. Scratch site curl: /guestbook/feed/ 200 RSS 'Comments on: Guestbook' with source:inReplyTo = page URL; /about/feed/ and /privacy/feed/ 404; /guestbook/?feed=rss2 301 to /guestbook/feed/; /comments/feed/ has 'Pat on Guestbook' and not the closed About page's comment; /guestbook/ head has the rel=alternate comments link, /about/ does not.
Flag: /replies/{key}/ (TASK-324, conversation.repliesTo) still serves a closed page's replies; replies-feeds.test.ts asserts it for /about/ without comments: true. Not changed here.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pages that take comments now have a {permalink}feed/ comments feed, advertise it in <head>, and their comments appear in /comments/feed/ named like a post's; a page that takes no comments 404s there and its comments stay out of the site feed. One rule decides all of it: answerable() from comments/policy.ts, the rule that already decides whether a page shows its conversation. README Comments section rewritten to list what the feeds carry (native comments, webmention replies and mentions, fediverse replies and approved quotes, reply posts; no likes, boosts or reposts). Verified by new page-comments-feed tests, the full suite, and curl against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
