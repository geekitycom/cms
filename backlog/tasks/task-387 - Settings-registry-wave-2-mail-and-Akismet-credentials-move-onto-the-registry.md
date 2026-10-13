---
id: TASK-387
title: 'Settings registry wave 2: mail and Akismet credentials move onto the registry'
status: To Do
assignee: []
created_date: '2026-10-13 16:45'
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
- [ ] #1 The `mail` and `akismet` namespaces are declared with secret flags, defaults, descriptions and legacy readers; an existing data/mail.json or data/akismet.json in the old nested shape is read correctly and rewritten flat at mode 0600 on the next save
- [ ] #2 The Email page saves, forgets and tests the Brevo key and the SMTP connection through the registry; the Discussion page saves, verifies and forgets the Akismet key through it; neither page prints a secret back; their existing tests pass
- [ ] #3 A secret set in the environment (GEEKITY_MAIL__SMTP_PASSWORD, GEEKITY_AKISMET__KEY) is in effect, shown as set by the environment on the page, and refused by `set`
- [ ] #4 mail/credentials.ts is deleted; readAkismetKey, writeAkismetKey, removeAkismetKey and AkismetKeyRecord are deleted; createAkismetChecker and verifyAkismetKey read the registry
- [ ] #5 MailService.configured(), providerName() and from() are async; every caller awaits them; the renderer receives mailConfigured as an input and does not read the registry
- [ ] #6 `geekity settings list mail` prints `(set)` or `(not set)` for each secret and never a value
- [ ] #7 docs/settings.md Credentials and docs/email.md and docs/comments.md describe the namespaces and the environment variables; pnpm lint, typecheck and test pass
<!-- AC:END -->
