---
id: TASK-103
title: 'A signed-in commenter comments as themselves, with the form to match'
status: To Do
assignee: []
created_date: '2026-09-20 11:52'
updated_date: '2026-09-20 12:20'
labels:
  - web
  - comments
milestone: m-16
dependencies: []
references:
  - packages/cms/themes/default/partials/comment-form.njk
  - packages/cms/src/comments/submission.ts
  - packages/cms/src/admin/session.ts
  - packages/cms/src/web/conversation.ts
  - packages/cms/src/comments/records.ts
type: feature
ordinal: 128800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The comment form asks everybody for a name, an email address and a website, because it assumes a stranger. Somebody signed in to the admin of their own site has already told it all three, and typing them again is both a chore and a way to end up with two spellings of the same person under one post.

When the request carries a valid admin session, draw the short form: the comment box, the reply-to line, and one sentence saying who it will be posted as, with a link to their profile. No name, email or website box, and no honeypot — the honeypot and the loaded-at timestamp are there to catch a robot filling a public form, and a session is better evidence than either.

The comment is then attributed from the account rather than from what was typed: the display name, or the username where there is no display name; the author archive as the website; the account's email, which is never shown, exactly as a stranger's is never shown.

Three things this has to get right, none of which are the obvious part:

**Moderation.** Geekity has one role, so anybody who can sign in can already publish a post and approve any comment. A comment from them waiting in a queue for them to approve is theatre. It should be approved on arrival and skip the spam check, and the task should say so where somebody later wonders why the Akismet call is not made.

**Cross-site request forgery.** The public comment form has no CSRF token today and does not need one: it acts on nobody's behalf. The moment it acts on a session, a page on another site can make a signed-in person post a comment under their own name without knowing it. The signed-in form needs the token the admin forms already use, checked the way `guard` checks it.

**Caching.** A post page is the same for everybody today. Once it says 'Commenting as ada' it is not, and a reverse proxy in front — which the Docker deployment documents — could hand one person's name to the next reader. The personalized response must say it is private, and the public one must stay cacheable.

The theme README documents the shape the comment form is handed, so whatever the signed-in form needs goes in there too: a theme that replaces `partials/comment-form.njk` has to be able to draw both.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With a valid session, the form asks only for the comment, names who it posts as, and carries no name, email, website or honeypot field, proven by a test
- [ ] #2 The comment stored carries the account's display name, its author archive as the site, and its email, proven by a test
- [ ] #3 A comment from a signed-in user is approved on arrival and no spam check is made for it, proven by a test
- [ ] #4 The signed-in form carries a CSRF token, and a submission without a matching one is refused, proven by a test
- [ ] #5 A page carrying the signed-in form is not cacheable by a shared cache, and the same page for a stranger is unchanged, proven by a test for each
- [ ] #6 A stranger's form is exactly as it is today, honeypot and all, proven by the existing tests passing unedited
- [ ] #7 An expired or forged session cookie falls back to the stranger's form rather than being trusted, proven by a test
- [ ] #8 The theme README documents what the form is handed when somebody is signed in
<!-- AC:END -->
