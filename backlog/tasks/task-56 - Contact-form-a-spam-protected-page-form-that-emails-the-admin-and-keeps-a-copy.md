---
id: TASK-56
title: >-
  Contact form: a spam-protected page form that emails the admin and keeps a
  copy
status: To Do
assignee: []
created_date: '2026-09-04 01:42'
labels:
  - web
  - admin
  - email
milestone: m-8
dependencies:
  - TASK-52
  - TASK-53
type: feature
ordinal: 51500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A page may carry `contact: true` in its front matter (editor checkbox) to render a contact form below its content: name, email, subject, message. Submissions are protected the way comments are (honeypot, minimum submit time, per-address rate limit, and Akismet with `comment_type` `contact-form` when configured), then emailed to the site's contact address (a setting, defaulting to the first admin with an email) with reply-to set to the sender, and stored as a file under `data/contact/` so a message survives a mail outage; an admin Messages screen lists them with read and delete. The form works without JavaScript, shows a thank-you page, and never reveals the destination address. Without mail configured, submissions are still stored and the admin screen shows them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A page with contact: true renders the form and a submission emails the contact address with reply-to set to the sender, proved against the stubbed mail service
- [ ] #2 Every submission is stored under data/contact and listed on the admin Messages screen with read and delete, including when mail is not configured
- [ ] #3 The honeypot, minimum submit time, rate limit and Akismet contact-form check each reject a submission in tests
- [ ] #4 The form works without JavaScript and shows a thank-you page; the destination address never appears in the HTML
<!-- AC:END -->
