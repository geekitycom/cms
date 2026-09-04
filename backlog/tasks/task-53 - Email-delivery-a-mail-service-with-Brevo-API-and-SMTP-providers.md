---
id: TASK-53
title: 'Email delivery: a mail service with Brevo API and SMTP providers'
status: To Do
assignee: []
created_date: '2026-09-04 01:42'
labels:
  - admin
  - email
milestone: m-8
dependencies:
  - TASK-14
references:
  - 'https://developers.brevo.com/reference/sendtransacemail'
  - 'https://developers.brevo.com/docs/send-transactional-email'
type: feature
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CMS sends no email. Add one mail service behind a small provider interface with two providers: Brevo's transactional API (`POST https://api.brevo.com/v3/smtp/email` with an `api-key` header, `sender`, `to`, `replyTo`, `subject`, `textContent`, `htmlContent`) and plain SMTP (nodemailer, which also covers Brevo's SMTP relay and every other provider). Settings: provider, from name and address, reply-to, and the credential (API key or SMTP host, port, user, password), with the credential stored under `data/` like the Akismet key and never in `site.json`; the public settings mirror carries none of it. The settings screen has a Send test email button that reports the provider's answer. Messages are plain text with an optional simple HTML twin, built from small templates the package ships and a site may override from its theme directory. Sending is queued off the request, serialised, retried with backoff a few times, and every attempt is logged with outcome and provider message id so a lost message is diagnosable; a missing configuration makes `send` a logged no-op rather than a crash, so features that email keep working without it. Expose the service on `Cms` and the Hono context for the tasks that follow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With Brevo configured, a test email from the settings screen calls the transactional endpoint with the documented fields, proved against a stubbed endpoint, and the screen shows the outcome
- [ ] #2 With SMTP configured, the same test goes through nodemailer to the configured server, proved with a local test SMTP server
- [ ] #3 Credentials live under data/, are never written to site.json, and are masked on the settings screen
- [ ] #4 A failed send is retried with backoff and every attempt is logged with its outcome
- [ ] #5 With no mail configuration, features that send email still succeed and log that the message was not sent
- [ ] #6 A theme can override a message template
<!-- AC:END -->
