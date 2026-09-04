---
id: TASK-50
title: >-
  Native comments: a comment form with moderation, per-post switch, and
  auto-close after 14 days
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:35'
updated_date: '2026-09-04 22:35'
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
- [x] #1 A reader can submit a comment on an open post; it is held as pending, appears on the admin Comments screen, and shows on the page once approved, threaded with fediverse replies
- [x] #2 A commenter whose name and email were approved before is approved automatically on later comments
- [x] #3 The honeypot, the minimum submit time and the per-address rate limit each reject a submission in tests without losing legitimate ones
- [x] #4 Comments live as files under content/_data/comments, appended atomically, and survive deleting the database
- [x] #5 The form is absent and submissions refused on a post older than commentsCloseAfterDays, on a post with comments: false, and everywhere when the global switch is off; comments: true reopens an old post
- [x] #6 Approved native comments appear in the per-post and site-wide comments feeds and in the source:comments count
- [x] #7 Comment content is rendered from Markdown with HTML stripped and links marked nofollow ugc
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Comment records as files: content/_data/comments/{slug}.json holding {post, comments[]}, each entry carrying id, source, kind, status, author {name,url,email}, content {markdown,html}, submitted, addressHash, inReplyTo. Written atomically under a per-file lock with the SQLite index inside the same step, exactly as federation/records.ts does.
2. SQLite migration 14 adds a comments table and AdminStore methods (list by post, list by status, counts, put, delete, replaceComments for the boot rebuild, approvedAuthor for the auto-approval rule).
3. rebuildCommentIndexes() runs on every boot and from 'geekity rebuild', so deleting the database costs nothing.
4. Restricted Markdown: markdown-it with html:false, an http/https/mailto link allowlist, and rel="nofollow ugc" on every link.
5. Closing rules: settings.comments (on/off) and settings.commentsCloseAfterDays (14, 0=never) join front matter 'comments: true|false' and 'pages are closed by default' in one function, commentsOpen(document, settings, now).
6. Defences and the seam: honeypot field, a minimum age on the form's hidden load time, a per-address rate limit reusing createLoginThrottle, then one CommentChecker interface ({check, reportSpam?, reportHam?}) taking the address, user agent, referrer, permalink, author, content and time and answering spam | discard | ham | unknown. Configured as GeekityConfig.commentChecker; TASK-52 plugs Akismet in there and the admin's spam/approve actions call reportSpam/reportHam.
7. Auto-approval: the same name and email approved before is approved again (WordPress's rule).
8. Public POST endpoint plus a theme partial for the form; conversation.ts gains 'comment' as an InteractionSource and threads native comments alongside fediverse replies through the existing threadOf.
9. Admin Comments screen (pending/approved/spam with approve, spam, delete, reply) and a pending count on the dashboard.
10. Feeds: approved native comments join postComments, siteComments and the source:comments count.
11. Eleventy mirror: the example config reads the same files and the fixtures grow a native comment, so acceptance criterion 5 of TASK-49 keeps holding.
12. Docs: doc-5 for the screen, the theme README for what the partials receive, a new backlog doc for the comment file format, and a note in doc-4.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Comments are files (decision-9): one JSON file per post under content/_data/comments/{slug}.json, written atomically under a per-file lock with the SQLite index updated inside the same step, exactly as federation/records.ts does for followers and the inbox log. Migration 14 adds the comments table; rebuildCommentIndexes runs on every boot and from 'geekity rebuild', so deleting the database costs nothing.

The file entry carries source, kind, status, author {name,url,email}, content {markdown,html}, submitted, addressHash and inReplyTo, so a webmention (TASK-51) lands in the same file with a different source and threads with everything else. Documented in the new backlog doc-6.

Rendering: a restricted markdown-it profile (html:false, an http/https/mailto link allowlist, images rendered as links, rel="nofollow ugc" on every link) rather than a sanitising pass over the site's renderer.

Defences, in order: honeypot, a minimum age on the form's hidden 'loaded' stamp (unsigned on purpose, and documented as a speed bump), a per-address rate limit reusing createLoginThrottle, then the CommentChecker seam. The checker is GeekityConfig.commentChecker and answers spam | discard | ham | unknown; the moderation screen calls reportSpam/reportHam when a human changes its mind, and a checker that throws is treated as no opinion so a service that is down never stops a site taking comments.

Closing rules are one function, commentsOpen(document, policy, now): the site switch is absolute, drafts and trash take none, front matter comments: true|false beats everything below in both directions, pages are closed, otherwise a post is open until commentsCloseAfterDays (14, 0 never) past its date. The editor exposes it as a three-value select rather than a checkbox, because there are three answers and the one a checkbox would lose is the default.

Addresses are never stored: content/_data/comments is published with the site and goes into git, so the file keeps sha256(salt + address) truncated, with the salt in data/comment-salt (0600). The checker gets the real address.

Deliberately out of scope, and worth its own task: the HTML representation's ETag is still a hash of the document alone, so a newly approved comment — like a newly arrived fediverse reply since TASK-49 — does not invalidate a browser's cached copy of the post.

Verification, all through the app rather than through the functions:
- AC1: src/comments/site.test.ts 'holds it for a moderator, and shows it once approved' — a POST is held pending, is on /admin/comments, and after approval is on the page inside the conversation section beside the fediverse thread; src/admin/comments.test.ts covers the queue and the approve action.
- AC2: 'approves an author a moderator has already let through' and 'holds a stranger using an approved commenter's name but another email'.
- AC3: 'drops a submission that filled the honeypot', 'refuses one posted faster than anybody types', 'takes one from a form that has been open long enough' (the legitimate case), 'refuses one from a form rendered a year ago', and 'stops one address after enough comments, and says how long to wait' — which also checks a second address is untouched.
- AC4: src/comments/records.test.ts for the file shape and the rebuild, and site.test.ts 'comes back with every comment, because the comments are the files' — every database file deleted between two boots over the same content directory.
- AC5: the five cases under 'a post that has stopped taking comments' (age, comments: false, comments: true, the global switch, closeAfterDays 0), plus 'is absent from a page', plus src/admin/comments.test.ts 'writes comments: false into the front matter, and closes the post' for the editor half. src/comments/policy.test.ts pins the rule itself.
- AC6: 'carry an approved comment, and count it in source:comments' and 'leaves a comment nobody has approved out of both'.
- AC7: src/comments/markdown.test.ts, and 'renders the comment from Markdown, with no HTML and every link marked' end to end.

Gates: pnpm build, pnpm test (1126 pass), pnpm test:11ty (all four projects pass), pnpm typecheck, pnpm lint and pnpm format:check all clean. The Eleventy mirror grew a native comment in the fixtures and a case in test/eleventy.test.ts, so TASK-49's fifth criterion still holds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Native comments: a form under an open post whose submissions become JSON files under content/_data/comments/ (decision-9, doc-6), indexed by a new comments table that is rebuilt from the files on every boot. Comments thread with the fediverse replies in the same conversation, are held for moderation unless the same name and email were approved before, and are rendered from Markdown with raw HTML off and every link marked nofollow ugc. A honeypot, a minimum form age and a per-address rate limit stand in front of a single CommentChecker seam (spam | discard | ham | unknown) that TASK-52 will plug Akismet into, with reportSpam/reportHam called from the moderation actions. Closing is a site switch, a commentsCloseAfterDays window and a per-post front-matter override, all read in one place. An admin Comments screen (pending/approved/spam with approve, spam, delete, reply) and a pending count on the dashboard; approved comments join the per-post and site-wide feeds and the source:comments count. Verified by 40 new tests through the app, and by the Eleventy mirror building the same thread from the same files.
<!-- SECTION:FINAL_SUMMARY:END -->
