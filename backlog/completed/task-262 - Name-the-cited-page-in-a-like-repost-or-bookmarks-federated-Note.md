---
id: TASK-262
title: 'Name the cited page in a like, repost or bookmark''s federated Note'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 09:39'
updated_date: '2026-10-04 09:44'
labels:
  - federation
dependencies: []
priority: low
type: enhancement
ordinal: 221800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Giphy repost from shll.me reaches Mastodon as <p>Reposted <a href="https://giphy.com/gifs/…">https://giphy.com/gifs/no-nope-tracy-morgan-spfi6nabVuq5y</a></p>: the ActivityStreams Note built in packages/cms/src/federation/article.ts prints the bare URL as the link text, though the site holds the cited page's title in its reply contexts (TASK-244) and pages already say 'Reposted No No No GIF'. Give the Note's citation line the same words as the page's: CITATION_VERBS and citedPageName from content/citation.ts (TASK-261), the cited page's name as the link text, or the host form ('a page on <host>', 'an image from <host>') when nothing was fetched; the href stays the cited URL so servers still build their own link card from it. The ActivityStreams builder does not hold the reply-context service today; pass a CitedPageReader in the way TASK-261 did for postLabel. Both the served object and the delivered Create/Update must say the same; an Update is sent when a context arrives after the Create only if the site already sends Updates for changed content (say what happens).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A like, repost or bookmark's Note content names the cited page by its stored title, linking the cited URL, in the served object and the delivered Create
- [x] #2 With no stored context the Note uses the host form, never the bare URL as link text
- [x] #3 Mastodon's link-card rules still find the link: the anchor carries no u-url, h-card or mention class and no rel=tag (checked against the Note HTML)
- [x] #4 The recording attachment name TASK-261 left on the old label uses the reader too
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Check whether a context arriving after the Create triggers an Update; record the finding in the notes.
2. FederationContextData gains a required cited: CitedPageReader, the stored reply contexts. Every context builder passes it in explicitly: mount's contextData (c.var.replyContexts), the delivery and relay services (a new cited option, given by createCms), the actor-profile loader in createCms. The WordPress federation passes context.data through. No builder reads a store behind the caller's back.
3. article.ts hands context.data.cited down as an argument: citing(document, cited) prints CITATION_VERBS plus citedPageName(url, cited(url)) as plain anchor text, escaped; recordingAttachment(document, baseUrl, cited) names the recording by postLabel(document, cited). The served object, the outbox and the delivered Create and Update all go through postObject, so they agree.
4. Tests first: article.test.ts for the served Note (stored title, host form, exact plain anchor, recording name) with a seeded _data/replyContexts.json; delivery.test.ts for the delivered Create's JSON-LD at the stubbed inbox.
5. Verify pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Update finding: no Update follows a context that arrives after the Create. The delivery service listens only to index changes, and the index tracks Markdown under posts/ and pages/ (content/sync.ts isDocumentPath); the reply-context service writes _data/replyContexts.json, which is no document, so its write federates nothing. An Update goes only when the post's file changes (its hash names the revision) or on the admin's Resend. In practice: a like, repost or bookmark saved through the editor or Micropub with no slug and no title has its slug drawn from the cited page (typeSlug -> replyContexts.describe), which stores the context before the save, so its Create already names the page. A post with its own slug or title, or one written to disk, fetches its context alongside delivery, so its Create can carry the host form; the served object names the page once the context lands, and the delivered copy catches up on the next edit or a Resend.

Correction to the finding: an untitled repost saved through the editor also asks for its context before the save (citesUndescribedImage calls describe for a new post), so it too lands before the Create.
Design: the reader lives on FederationContextData as a required cited field, because the Fedify dispatchers (outbox, served object) receive only the context; every place that builds a context passes it in explicitly (mount contextData from c.var.replyContexts, the delivery and relay services' new cited option, the actor-profile loader in createCms), and article.ts hands it down to citing() and recordingAttachment() as an argument. Nothing in article.ts opens the contexts file itself. Required, so a new context builder that forgets it fails typecheck. The served object, the outbox and the delivered Create and Update all go through postObject, so they say the same.
Left out: the page's ' by <author>' or ' · <site>' credit after the link. The task asks for the name as the link text; the credit can follow if wanted.
Tests: article.test.ts 'a cited page in a note (TASK-262)' (served Note: stored title escaped, Liked/Bookmarked, host forms for a page and an image, the only anchor is exactly <a href=URL>, no tag property, recording name 'Liked <title>'); delivery.test.ts 'a cited page in a delivered note (TASK-262)' (stubbed inbox: Create and the following Update name the stored title; Create uses the host form with no context). All failed first with the bare URL. Mutation: replacing the delivery service's reader with () => undefined fails the delivered test.
Validation: pnpm build && pnpm test (4065 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A like, repost or bookmark's federated Note now names the cited page as its own page does: 'Reposted <a href=URL>No No No GIF</a>' from the stored reply context, or 'a page on <host>' / 'an image from <host>' when nothing was fetched; the anchor stays plain so Mastodon still builds its link card from the href. The recording attachment name uses the same reader. The reader is a required cited field on FederationContextData, passed in by every context builder (mount, delivery, relays, the actor-profile loader), so the served object, the outbox and the delivered Create and Update agree. No Update is sent when a context arrives after the Create: delivery follows only Markdown index changes, and the contexts file is no document; editor and Micropub saves that draw a slug or check an image from the cited page store the context before the Create. Verified by new tests in federation/article.test.ts and federation/delivery.test.ts plus build, 4065 tests, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
