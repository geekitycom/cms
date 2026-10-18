---
id: TASK-387
title: 'Settings registry wave 2: mail and Akismet credentials move onto the registry'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 16:45'
updated_date: '2026-10-13 19:30'
labels: []
milestone: m-38
dependencies:
  - TASK-386
references:
  - >-
    backlog/decisions/decision-53 -
    One-settings-registry-over-namespaced-files-declarations-overrides-migration-and-the-CLI.md
priority: medium
type: feature
ordinal: 346800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-53 section 7 (wave 2) moves the two credential files onto the settings registry built in wave 1: data/mail.json becomes the `mail` namespace (brevo_api_key, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password; kept, secret) and data/akismet.json becomes the `akismet` namespace (key, status, checked_at; kept, secret). The nested file shapes are read by the namespace's legacy reader and flattened on the next write. The Email and Discussion settings pages keep their own credential endpoints and templates but read and save through the registry. mail/credentials.ts and the key functions in comments/akismet.ts are deleted in the same PR. MailService configured(), providerName() and from() become async and mailConfigured is passed into the renderer as an input.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The `mail` and `akismet` namespaces are declared with secret flags, defaults, descriptions and legacy readers; an existing data/mail.json or data/akismet.json in the old nested shape is read correctly and rewritten flat at mode 0600 on the next save
- [x] #2 The Email page saves, forgets and tests the Brevo key and the SMTP connection through the registry; the Discussion page saves, verifies and forgets the Akismet key through it; neither page prints a secret back; their existing tests pass
- [x] #3 A secret set in the environment (GEEKITY_MAIL__SMTP_PASSWORD, GEEKITY_AKISMET__KEY) is in effect, shown as set by the environment on the page, and refused by `set`
- [x] #4 mail/credentials.ts is deleted; readAkismetKey, writeAkismetKey, removeAkismetKey and AkismetKeyRecord are deleted; createAkismetChecker and verifyAkismetKey read the registry
- [x] #5 MailService.configured(), providerName() and from() are async; every caller awaits them; the renderer receives mailConfigured as an input and does not read the registry
- [x] #6 `geekity settings list mail` prints `(set)` or `(not set)` for each secret and never a value
- [x] #7 docs/settings.md Credentials and docs/email.md and docs/comments.md describe the namespaces and the environment variables; pnpm lint, typecheck and test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. settings/types.ts: add check(value, others, dirs) to SettingDeclaration (others = the namespace's values after the change, each key in effect). registry.set runs the check of every key in the call over the merged values and refuses the whole call on a problem.
2. settings/kinds.ts: text, port (1..65535) and oneOf kinds.
3. settings/mail.ts MAIL (brevo_api_key secret, smtp_host, smtp_port 587 with the 465/587-vs-secure pairing check on port and secure, smtp_secure, smtp_user, smtp_password secret; data/mail.json, kept secret) with a legacy reader that flattens { brevo, smtp } (port fallback 465 when secure else 587, empty host = no SMTP). settings/akismet.ts AKISMET (key secret, status valid|invalid|unchecked, checked_at instant or empty; data/akismet.json kept secret) with a legacy reader that renames checkedAt. Append both to CORE. Registry tests: legacy files read and rewritten flat at 0600, env secrets in effect and refused by set, check refusal, settings list mail prints (set)/(not set).
4. MailService: configured(), providerName(), from() async over settings.values(MAIL); callers await (recovery, users, comment-routes, notifications/comments, digest). Renderer input: the app middleware reads dev mode and mail.configured() once per request into c.var.devMode/c.var.mailConfigured and runs the request under one request-input AsyncLocalStorage; the renderer hands notifiable to the commentForm source; page-sources loses mailConfigured.
5. Akismet: createAkismetChecker({ settings, language, ... }) reads akismet.key per call; verifyAkismetKey({ settings, blog, at }) checks the key in effect and stores status and checked_at through set. Delete readAkismetKey, writeAkismetKey, removeAkismetKey, AkismetKeyRecord, akismetKeyPath, AKISMET_KEY_FILE.
6. Admin: SettingsPage.panels may be async. Email page reads and saves mail.* through the registry (blank secret keeps stored, overridden non-secret fields skipped, env secrets shown as set by the variable, typed secret refused with the set sentence, forget unsets every key not overridden). Discussion page saves (set key then verify), checks again (verify action) and forgets through it; env key shown as set by GEEKITY_AKISMET__KEY. Delete mail/credentials.ts and its exports.
7. Migrate tests to the flat shape; delete credentials.test.ts after moving its legacy cases to the namespace tests.
8. Docs: settings.md Credentials, email.md, comments.md, configuration.md env names. Verify with pnpm build/test/typecheck/lint/format:check and a curl session on a scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built settings/mail.ts (MAIL) and settings/akismet.ts (AKISMET), appended to CORE after dev_mode. Choices and departures from decision-53:
- check(value, namespaceAfterSet, dirs) is back on SettingDeclaration. set runs the check of each key given in the call over the namespace's values as they would be after it (given keys parsed, the rest in effect) and refuses the whole call on a problem. The SMTP port rule is the one user: 465 needs smtp_secure true and 587 needs it false, declared on both smtp_port and smtp_secure so setting either alone is checked. decision-53 said the '465 when secure, else 587' fallback becomes smtp_port's check; that fallback is a read-time default, so it lives in the legacy reader (a nested file with no port reads 465 when secure, else 587) and the check is the pairing rule instead. It refuses saves that were accepted before (465 without TLS, 587 with TLS); those never connected.
- Writing a namespace whole is now an explicit NamespaceDeclaration.writtenWhole flag, set on maintenance and dev_mode, instead of following from having a legacy reader. mail and akismet have shape-detecting legacy readers (nested brevo/smtp keys; checkedAt), so their files hold only the keys set and Remove leaves {} rather than a file of empty defaults, and geekity settings list shows an unset secret as (not set) default rather than file.
- New kinds: text, port, oneOf. AkismetKeyStatus moved to settings/akismet.ts.
- verifyAkismetKey({ settings, blog, at, by }) checks the key in effect (stored or GEEKITY_AKISMET__KEY) and stores status and checked_at through set; it returns undefined with no key. createAkismetChecker takes settings instead of dataDir and reads akismet.key per call. The Discussion page saves (set key, status unchecked, checked_at empty, then verify), checks again (new action=verify, 'Check key with Akismet', which is how an env key is checked) and forgets through the registry.
- The Email page: a blank secret keeps the stored one, a blank host keeps the stored connection; fields set by env or config are drawn as 'set by X' without a box and left out of the save; a secret typed over an env one is passed to set, which refuses it, and the page flashes the set sentence plus 'Nothing was saved.'. Remove unsets every key nothing else sets (admin/setting-overrides.ts forgetStored) and names any env variable still in effect.
- SettingsPage.panels may return a promise; settingsScreen is async. decision-53 put this in wave 3; the Email and Discussion panels need it now.
- MailService.configured/providerName/from are async. The provider lookup moved inside the send queue so mail.settled() covers a message whose credential is still being read. The comment notifier's pending/replyApproved now await configured() on their own serial queue; CommentNotifier gains settled(), which the CMS lifecycle runs before mail.settled(). Tests that waited only on cms.mail.settled() after an intake now await cms.notifications.settled() first (records, comments, reply-post-paths, webmention receive, dev-mode-site) — records.test.ts failed four tests without it.
- Request inputs: the app middleware reads dev_mode.on and mail.configured() once per request into c.var.devMode and c.var.mailConfigured and runs the request under one AsyncLocalStorage (drawnWith({ devMode, mailConfigured })) that replaces wave 1's drawnInDevMode. The renderer passes notifiable to the commentForm source as a third argument; page-sources no longer takes mailConfigured. recovery, users and comment-routes read c.var.mailConfigured.
- Deleted mail/credentials.ts and its test, and readAkismetKey, writeAkismetKey, removeAkismetKey, AkismetKeyRecord, akismetKeyPath, AKISMET_KEY_FILE and their exports from mail/index.ts and comments/index.ts; none was in the public package API.
Evidence: settings/credentials.test.ts (legacy nested mail.json and camelCase akismet.json read and rewritten flat at 0600; env secrets in effect and refused; port/TLS check refused, shown failing with the check call removed: 'actual ok: true'); web/comment-notify-field.test.ts (notify box appears after saving the key, no restart); cli-settings.test.ts mail listing; admin/mail.test.ts and admin/akismet.test.ts env, port and verify cases.
Curl session against a scratch site (geekity serve on :4387 with a preload that stubs rest.akismet.com and blocks every other non-loopback host): legacy nested data/mail.json and camelCase data/akismet.json shown correctly (SMTP 127.0.0.1/postmaster, Brevo …9999, Akismet …4321 checked 2026-05-01); saving SMTP with a blank password rewrote mail.json flat at 0600 keeping the legacy password; Send test email reached the provider ('smtp would not send ... ECONNREFUSED 127.0.0.1:2525', nothing listening, no external call); Remove cleared it; Akismet save of bad-key -> 'does not recognise', stored invalid at 0600; Remove cleared it. No page contained any stored secret. Restarted with GEEKITY_MAIL__SMTP_PASSWORD and GEEKITY_AKISMET__KEY: both pages say 'set by <code>VAR</code> and cannot be changed here' with no box; typing a password or key answered 'mail.smtp_password is set by GEEKITY_MAIL__SMTP_PASSWORD and cannot be changed here. Nothing was saved.' (and the akismet sentence) and wrote nothing; saving host/user without a password configured SMTP; Check key verified the env key (stub log: verify-key api_key=env-akismet-key-5555) and stored status valid with key absent from the file; geekity settings list mail printed smtp_password '(set) env GEEKITY_MAIL__SMTP_PASSWORD'. Server stopped (pid checked by cwd).

Validation after the comment pass (22 narrating comments removed; check's second argument renamed namespaceAfterSet): pnpm build, typecheck, lint (doc links included) and format:check pass. Tests: packages/cms 5838 pass 0 fail; apps/demo 32, plugin-llm 48, plugin-tag-suggest 31, plugin-post-summary 22, plugin-wordpress 106, all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the mail and Akismet credentials onto the settings registry. data/mail.json is the mail namespace (brevo_api_key, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password) and data/akismet.json the akismet namespace (key, status, checked_at), both kept and secret at 0600, with legacy readers that read the nested and camelCase files and store them flat on the next save. SettingDeclaration gains check (the SMTP port/TLS pairing rule), writing a namespace whole became an explicit flag kept on maintenance and dev mode, and GEEKITY_MAIL__* and GEEKITY_AKISMET__KEY work as overrides the pages show and refuse to save over. The Email and Discussion pages keep their templates and endpoints and read and save through the registry; Discussion gains Check key. MailService.configured/providerName/from are async, the comment notifier queues its notices with a settled(), and mailConfigured reaches the renderer as a per-request input beside dev mode. Deleted mail/credentials.ts and the Akismet key functions. Docs: settings.md, email.md, comments.md, configuration.md. Verified with the full test suites, build, typecheck, lint, format check, and a curl session on a scratch site with a stubbed Akismet covering legacy files, save, forget, test email, verify, and env-set secrets refused.
<!-- SECTION:FINAL_SUMMARY:END -->
