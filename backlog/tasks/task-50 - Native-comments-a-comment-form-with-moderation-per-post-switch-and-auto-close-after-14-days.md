---
id: TASK-50
title: >-
  Native comments: a comment form with moderation, per-post switch, and
  auto-close after 14 days
status: To Do
assignee: []
created_date: '2026-09-04 01:35'
updated_date: '2026-09-04 01:37'
labels:
  - web
  - admin
  - content
milestone: m-7
dependencies:
  - TASK-39
  - TASK-49
references:
  - >-
    backlog/decisions/decision-9 -
    Files-are-the-source-of-truth-for-all-durable-state-SQLite-is-a-disposable-cache.md
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 40500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WordPress lets a reader leave a comment on the page; the CMS only has fediverse replies. Add native comments that join the same thread. A comment form under an open post takes name, optional website, optional email (never shown, kept for the moderator), and the comment as Markdown rendered with a restricted profile (no raw HTML, links marked `rel="nofollow ugc"`). Comments are files, per decision-9: one JSON file per post under `content/_data/comments/`, published with the site so an Eleventy build sees them, appended atomically; SQLite indexes them. Each comment carries id, author, content (Markdown and rendered HTML), submitted time, client address hash, status (`pending`, `approved`, `spam`) and `inReplyTo` for threading. New comments are held for moderation unless the same name and email were approved before (WordPress's rule); spam defences are a honeypot field, a minimum time between form load and submit, and a per-address rate limit, with room for a third-party checker later. An admin Comments screen lists pending, approved and spam with approve, spam, delete and reply actions, and the dashboard shows the pending count.

Closing rules: a global setting turns comments on or off for the site; `commentsCloseAfterDays` (default 14, 0 for never) closes the form on posts older than that, counted from `date`; front matter `comments: false` or `comments: true` on a post overrides both ways, exposed as a checkbox in the editor; pages default to closed. A closed post shows the approved thread with no form and refuses submissions. Closing affects native comments only. Fediverse replies keep arriving regardless (nothing can stop a remote server sending them) and keep being shown in the thread whether the post is open or closed. Native comments appear in the per-post and site-wide comments feeds from TASK-39 and count toward `source:comments`. No email notifications; the admin screen is the notification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reader can submit a comment on an open post; it is held as pending, appears on the admin Comments screen, and shows on the page once approved, threaded with fediverse replies
- [ ] #2 A commenter whose name and email were approved before is approved automatically on later comments
- [ ] #3 The honeypot, the minimum submit time and the per-address rate limit each reject a submission in tests without losing legitimate ones
- [ ] #4 Comments live as files under content/_data/comments, appended atomically, and survive deleting the database
- [ ] #5 The form is absent and submissions refused on a post older than commentsCloseAfterDays, on a post with comments: false, and everywhere when the global switch is off; comments: true reopens an old post
- [ ] #6 Approved native comments appear in the per-post and site-wide comments feeds and in the source:comments count
- [ ] #7 Comment content is rendered from Markdown with HTML stripped and links marked nofollow ugc
<!-- AC:END -->
