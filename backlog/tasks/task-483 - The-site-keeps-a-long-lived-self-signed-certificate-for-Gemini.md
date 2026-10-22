---
id: TASK-483
title: The site keeps a long-lived self-signed certificate for Gemini
status: To Do
assignee: []
created_date: '2026-10-22 12:07'
labels:
  - gemini
  - ops
milestone: m-45
dependencies: []
references:
  - packages/cms/src/config.ts
  - docs/configuration.md
ordinal: 408800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gemini clients pin a server certificate on first sight (TOFU), so the certificate must be stable for years (decision-60). On first start with Gemini enabled the site generates a self-signed certificate for its host and stores it under data/ as a secret. Config can point to an operator certificate and key instead.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With Gemini enabled and no certificate configured, first start writes a self-signed certificate and key for the host of the base URL, valid for many years; later starts reuse it
- [ ] #2 The key file is created with owner-only permissions and its data/ file class is secret, so backups and site export carry it and import restores it
- [ ] #3 GEEKITY_GEMINI_CERT and GEEKITY_GEMINI_KEY (and their config keys) point to operator files instead; a missing or unreadable file is a clear startup problem, not a crash
- [ ] #4 geekity gemini cert prints the subject, expiry and SHA-256 fingerprint; the admin shows the fingerprint where Gemini is configured
- [ ] #5 A changed base URL host does not silently replace the certificate; the CLI has an explicit command to regenerate it
- [ ] #6 docs/configuration.md documents the settings and the TOFU consequence of replacing the certificate
<!-- AC:END -->
