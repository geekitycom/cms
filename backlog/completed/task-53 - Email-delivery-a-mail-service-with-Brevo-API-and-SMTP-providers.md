---
id: TASK-53
title: 'Email delivery: a mail service with Brevo API and SMTP providers'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:42'
updated_date: '2026-09-05 02:00'
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
- [x] #1 With Brevo configured, a test email from the settings screen calls the transactional endpoint with the documented fields, proved against a stubbed endpoint, and the screen shows the outcome
- [x] #2 With SMTP configured, the same test goes through nodemailer to the configured server, proved with a local test SMTP server
- [x] #3 Credentials live under data/, are never written to site.json, and are masked on the settings screen
- [x] #4 A failed send is retried with backoff and every attempt is logged with its outcome
- [x] #5 With no mail configuration, features that send email still succeed and log that the message was not sent
- [x] #6 A theme can override a message template
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add nodemailer and @types/nodemailer to packages/cms.
2. src/mail/provider.ts: the MailProvider seam — OutgoingMail, MailAddress, MailDelivery, MailProviderName ('none' | 'brevo' | 'smtp'). A provider throws on failure; the service decides what a failure costs.
3. src/mail/memory.ts: createMemoryMailProvider() — records every OutgoingMail, can be told to fail the next n sends. Exported from the package so TASK-54/55/56 can observe mail in tests.
4. src/mail/brevo.ts: createBrevoProvider({ apiKey, fetch?, timeoutMs? }) — POST https://api.brevo.com/v3/smtp/email with an api-key header and sender/to/replyTo/subject/textContent/htmlContent. Tested against an injected fetch.
5. src/mail/smtp.ts: createSmtpProvider({ host, port, secure, user, password }) over nodemailer. Tested against a tiny loopback SMTP server in src/mail/__testing__/smtp-server.ts (node:net, ephemeral port, offline).
6. src/mail/credentials.ts: data/mail.json at 0600 — { brevo: { apiKey }, smtp: { host, port, secure, user, password } }. Read on every send, like data/akismet.json, so a key pasted into the settings screen works without a restart. Never written to site.json.
7. src/mail/templates.ts: renderMailTemplate over createTemplateEnvironment (themeDir first, packaged theme second), reading mail/<name>.subject.njk, mail/<name>.txt.njk and the optional mail/<name>.html.njk. Ships themes/default/mail/test.*.njk.
8. src/mail/service.ts: createMailService({ config, provider?, logger?, backoffMs?, attempts?, wait? }) -> MailService { configured(), from(), send({ to, subject?, template, data?, replyTo? }), sendRaw(OutgoingMail), settled() }. One serialised chain, retried with injectable backoff, every attempt logged with its outcome and the provider message id. No configuration is a logged no-op that resolves { ok: true, skipped: true }.
9. Settings: mailProvider, mailFromName, mailFromAddress, mailReplyTo join SiteSettings/site.json with validation; POST /admin/settings/mail saves and removes the credential (a blank secret keeps the stored one); POST /admin/settings/mail/test sends the 'test' template to an address on the form and flashes the provider's answer. The panel shows that a credential is set and never echoes it.
10. Wire it up: GeekityConfig.mailProvider (a named provider wins outright, as commentChecker does), Cms.mail, c.var.mail.
11. Docs: doc-5 Settings section, README (data/ table, a Mail section, theme overrides), themes/default/README.md if it lists overridable templates.
12. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the mail service behind a MailProvider seam (packages/cms/src/mail/).

- provider.ts is the seam: OutgoingMail in, MailDelivery or a throw out. Nothing about retries, queueing, templates or configuration is a provider's business, which is what makes a third provider a file rather than a redesign.
- brevo.ts posts the documented body (sender/to/replyTo/subject/textContent/htmlContent) to https://api.brevo.com/v3/smtp/email with an api-key header, and throws Brevo's own words on a refusal so the settings screen can name the field to fix.
- smtp.ts is nodemailer, a transport per message rather than a pool. Proved against a loopback SMTP server written for the purpose (src/mail/__testing__/smtp-server.ts, node:net, ephemeral port, no STARTTLS advertised so nodemailer stays on the plain socket). No new dev dependency, and the whole file runs in ~35ms.
- memory.ts is the in-memory provider, exported from the package so TASK-54/55/56 can read back the mail a feature would have sent and make it fail on demand.
- credentials.ts is data/mail.json at 0600, read tolerantly on every send like data/akismet.json. Both providers' credentials can be stored at once, so switching mailProvider back does not mean pasting a key in again.
- templates.ts renders mail/<name>.subject.njk, .txt.njk and .html.njk through the theme environment, so the site theme wins over the packaged one file by file. themes/default/mail/test.* ship.
- service.ts is the one door: configured(), providerName(), from(), send({to,template,subject?,data?,replyTo?}), sendRaw({to,subject,text,html?,replyTo?}), settled(). One serialised chain, attempts and backoffMs and wait injected, every attempt logged with its outcome and the provider message id, and no configuration is a logged no-op that resolves ok:true skipped:true.

Settings: mailProvider/mailFromName/mailFromAddress/mailReplyTo joined SiteSettings and site.json with validation; POST /admin/settings/mail saves and removes the credential (blank secret keeps the stored one) and POST /admin/settings/mail/test sends the test message and flashes the provider's answer. mailPanel() shows the last four characters of a key and the non-secret half of an SMTP connection and nothing more.

Wiring: GeekityConfig.mail is a MailOverrides object mirroring federation (provider, attempts, backoffMs, logger); a named provider wins outright the way commentChecker does. Exposed as cms.mail and c.var.mail, and settled in close().

Config note: three existing test fixtures that post the settings form gained mail_provider, because mailProvider is validated strictly the way actorType is.

Verification (repo root): pnpm build, pnpm test (1269 pass / 0 fail in @geekity/cms, 11 pass / 0 fail in the demo), pnpm typecheck, pnpm lint and pnpm format:check all pass.

Evidence per acceptance criterion:
#1 src/admin/mail.test.ts 'calls the transactional endpoint with the documented fields and reports the outcome' — a stubbed api.brevo.com sees one call carrying the api-key header, sender, to, replyTo, subject, textContent and htmlContent, and the settings screen afterwards reads 'test message was sent to ada@example.com via brevo' with the message id. A second test proves Brevo's own refusal reaches the screen.
#2 src/admin/mail.test.ts 'delivers the message to the configured server' — the Send test email button against a loopback SMTP server started by the test: the server records MAIL FROM, RCPT TO, the AUTH credentials and the Subject and body, and the screen reports it went via smtp. src/mail/smtp.test.ts proves the provider on its own.
#3 src/admin/mail.test.ts 'where mail credentials live' — data/mail.json holds the key and the SMTP password at mode 0600, neither string appears anywhere in content/_data/site.json, and neither appears in the rendered settings screen (only …1234 and the non-secret host and user do). src/mail/credentials.test.ts covers the file itself.
#4 src/mail/service.test.ts 'is tried again after a backoff and logged every time' — two refusals then a success: three attempts, waits of 1000 and 2000 from the injected backoff, three log lines naming attempt N of M, the last carrying the provider message id. 'gives up after the last attempt' proves the give-up line and that nothing throws.
#5 src/mail/service.test.ts 'a site with no mail configuration' — send resolves ok:true skipped:true with attempts 0, one log line saying the message was not sent and naming the recipient, and configured() flips to true the moment the credential file lands with no restart. src/admin/mail.test.ts proves the screen says so too.
#6 src/mail/templates.test.ts 'lets a theme override one part of a message and keep the rest' — a theme's mail/test.txt.njk replaces the body while the subject and the HTML twin still come from the packaged theme; a further test adds a message the package never shipped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a mail service behind a small MailProvider seam, with Brevo's transactional API and nodemailer SMTP as the two providers the package ships and an in-memory one exported for tests. Non-secret settings (mailProvider, From name and address, reply-to) joined content/_data/site.json; the Brevo key and the SMTP connection live in data/mail.json at mode 0600 and are never echoed back to the settings screen. Messages are Nunjucks templates under mail/ in the theme, so a site theme overrides one part of a message and keeps the rest. Sending is one serialised queue, retried three times with a growing wait, every attempt logged with its outcome and the provider message id; with no configuration send is a logged no-op that resolves successfully. Exposed as cms.mail and c.var.mail, with a Send test email button on /admin/settings that reports the provider's own answer. Verified with pnpm build, test (1269 pass, 0 fail), typecheck, lint and format:check, and per-criterion by the tests named in the implementation notes: Brevo against a stubbed endpoint, SMTP against a loopback server, the credential file's location and mode, the retry and its log, the unconfigured no-op, and a theme override.
<!-- SECTION:FINAL_SUMMARY:END -->
