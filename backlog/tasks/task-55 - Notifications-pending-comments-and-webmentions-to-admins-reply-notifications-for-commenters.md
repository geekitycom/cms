---
id: TASK-55
title: >-
  Notifications: pending comments and webmentions to admins, reply notifications
  for commenters
status: To Do
assignee: []
created_date: '2026-09-04 01:42'
labels:
  - admin
  - email
milestone: m-8
dependencies:
  - TASK-50
  - TASK-51
  - TASK-53
type: feature
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Email is what makes moderation timely. When a native comment or webmention lands in the moderation queue, email every admin who has an email address and has the notification on, with the comment, the post, and one-click links to approve, spam or delete that carry a signed single-use token so they work without a login form in the way. Do not notify for comments Akismet discarded. Commenters may tick "Notify me of replies" on the form, which stores the email with their comment (never shown) and emails them when a reply to their comment is approved, with an unsubscribe link that works without a login. Notifications are per-user preferences on the users screen: new comments, and later other events (new follower, failed delivery digest) behind the same switchboard so adding one is one line. Everything goes through the mail service and is a no-op without it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A comment entering moderation emails every opted-in admin with the content and working approve, spam and delete links that are single-use and need no login
- [ ] #2 A commenter who opted in is emailed when a reply to their comment is approved, and the unsubscribe link stops further mail
- [ ] #3 Per-user notification preferences are edited on the users screen and respected
- [ ] #4 Comments Akismet discarded send nothing
- [ ] #5 Nothing is sent and nothing breaks when mail is not configured
<!-- AC:END -->
