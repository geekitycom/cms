---
id: TASK-65
title: >-
  Posts federate under their permalink: the ActivityStreams id is the permalink,
  and a published permalink cannot change
status: To Do
assignee: []
created_date: '2026-09-05 13:15'
updated_date: '2026-09-05 13:49'
labels:
  - federation
  - web
  - admin
  - content
milestone: m-10
dependencies: []
references:
  - >-
    backlog/decisions/decision-13 -
    A-posts-ActivityStreams-id-is-its-permalink.md
  - packages/cms/src/federation/paths.ts
  - packages/cms/src/federation/mount.ts
  - packages/cms/src/federation/delivery.ts
  - packages/cms/src/web/documents.ts
  - packages/cms/src/admin/documents.ts
  - packages/cms/docs/eleventy.config.example.js
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
type: enhancement
ordinal: 96500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-4 gave a post two URLs: the permalink for readers and {baseUrl}/ap/posts/{slug} as the ActivityStreams object id, served by a Fedify object dispatcher and frozen into the front matter as activitypub.id at first announce so a renamed post kept its id. decision-13 reverses that. A permalink is by name permanent, the fediverse id is the same promise to a different audience, and one URL can answer both by content negotiation, which the permalink already does for an ActivityStreams request. Make the permalink the object id, absolute on the base URL. Remove the /ap/posts/{slug} object route; the permalink middleware serves the Article and its id is the permalink itself. Never mint activitypub.id; the record that a post was announced and when stays as activitypub.published, which is what delivery reads to choose Create over Update and what resend needs. A stored id is honoured, not dropped: a post whose file already names an activitypub.id keeps it as its object id, the CMS serves the object at that URL on an ActivityStreams request and redirects a browser from it to the permalink, and every Update and Delete names it. That is what lets a post migrated from WordPress keep the ?p=813 id its followers, replies and RSS subscribers hold (decision-14); the matching is on the whole URL, so a stored id with a query string works the same as one with a path. Keep the promise in the editor: renaming a published post's slug or editing its permalink is refused with a message that says why, while a draft's may still change. Replies thread by the object id, so the conversation walk, the comments feeds and the source:comments counts key on it. The Eleventy example config and its fixtures derive activityStreams the same way: the stored id when there is one, else the permalink. This is a feat(cms)! change: a post the demo announced under the old id and has no stored id for is a new object to its followers, and the changelog says so. Nothing is public yet, so it lands before launch and before TASK-63, which derives the feed item's identity from this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A GET of a published post's permalink with an ActivityStreams Accept header returns the Article whose id is that permalink, and the same URL without it returns the HTML page; /ap/posts/{slug} is no longer registered
- [ ] #2 Create, Update and Delete activities name the post's object id, delivery still chooses Create for a post never announced and Update afterwards using activitypub.published alone, and the federation screen's resend behaves as before
- [ ] #3 The CMS never writes activitypub.id; a file that already carries one keeps it through every save, that URL returns the Article on an ActivityStreams request and a 301 to the permalink otherwise, and activities name it; a stored id with a query string (?p=813) is served the same as one with a path
- [ ] #4 The editor refuses to change a published post's slug or permalink with a message saying a published permalink is permanent, and still lets a draft's change; a test covers both
- [ ] #5 A fediverse reply whose inReplyTo is the post's object id, permalink or stored, appears in the post's conversation, its comments feed and its source:comments count
- [ ] #6 The Eleventy example config puts the object id on the context as activityStreams and the Eleventy test passes; the fed-smoke script fetches the object at the permalink
- [ ] #7 doc-2 (front matter table), doc-3 (negotiation table), doc-4 (object id) and the package README describe one URL per post and the stored-id rule; the commit is feat(cms)! with a BREAKING CHANGE footer naming what followers see
<!-- AC:END -->
