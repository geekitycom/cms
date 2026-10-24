---
id: TASK-483
title: The site keeps a long-lived self-signed certificate for Gemini
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 12:07'
updated_date: '2026-10-23 17:26'
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
- [x] #1 With Gemini enabled and no certificate configured, first start writes a self-signed certificate and key for the host of the base URL, valid for many years; later starts reuse it
- [x] #2 The key file is created with owner-only permissions and its data/ file class is secret, so backups and site export carry it and import restores it
- [x] #3 GEEKITY_GEMINI_CERT and GEEKITY_GEMINI_KEY (and their config keys) point to operator files instead; a missing or unreadable file is a clear startup problem, not a crash
- [x] #4 geekity gemini cert prints the subject, expiry and SHA-256 fingerprint; the admin shows the fingerprint where Gemini is configured
- [x] #5 A changed base URL host does not silently replace the certificate; the CLI has an explicit command to regenerate it
- [x] #6 docs/configuration.md documents the settings and the TOFU consequence of replacing the certificate
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Enable setting: add site.gemini (fileKey gemini, boolean, default false) to the SITE namespace and a checkbox on Settings > Reading. Generic env GEEKITY_SITE__GEMINI applies. TASK-484 reuses it.
2. Config: geminiCert / geminiKey fields with GEEKITY_GEMINI_CERT / GEEKITY_GEMINI_KEY, resolved against cwd like the directories.
3. Data files: gemini/cert.pem and gemini/key.pem declared kept in files/data-files.ts (decision-55 has no secret kind; kept is always exported, and the key is written 0600 in a 0700 folder like data/keys, which export and import preserve).
4. src/gemini/certificate.ts: build a self-signed X.509 v3 certificate with node:crypto (ECDSA P-256 key, SHA-256 signature, CN and subjectAltName for the base URL host, 50 years) via a small DER writer; no new dependency. loadGeminiCertificate reads operator files or the stored pair, generates on first use under a lock file (key first, cert last, so a cert on disk means a complete pair), never replaces a stored one; regenerateGeminiCertificate replaces it explicitly. Every failure is a problem value with a sentence, not a throw.
5. Cms.serve(): when site.gemini is on, ensure the certificate and warn with the problem sentence if it cannot be had; HTTP still serves.
6. CLI: geekity gemini cert prints subject, hosts, expiry, SHA-256 fingerprint, and notes a base URL host mismatch; geekity gemini new-cert regenerates (refused when operator files are configured).
7. Admin: Reading page shows the fingerprint (or the problem) next to the Gemini checkbox.
8. Docs: configuration.md rows and a Gemini certificate section on TOFU; content.md data table rows.
9. Tests first per AC: certificate unit tests (parse with X509Certificate, key matches, reuse, host change, perms, TLS handshake), config parsing, CLI, admin, export/import round trip; then full verification suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Enable setting: site.gemini (site.json key "gemini", default false), a checkbox on Settings > Reading; env GEEKITY_SITE__GEMINI. TASK-484 AC#1 should reuse it.
Certificate: src/gemini/certificate.ts builds an X.509 v3 certificate with node:crypto alone (ECDSA P-256, ecdsa-with-SHA256, CN and subjectAltName for the base URL host, DNS or IP, 50 years). Node can sign but not assemble a certificate, so a ~60-line DER writer does that; no dependency added (pkijs/asn1js are only transitive). A sweep of 1500 certificates found 1 in 128 rejected for a non-minimal INTEGER serial; integer() now strips leading zeros and a test draws 1000.
Files: data/gemini/cert.pem (0644) and key.pem (0600) in a 0700 folder, declared kept in files/data-files.ts. decision-55 has no secret class: kept is always exported, and the 0600 mode survives export and import, which is what the AC asks of 'secret'. Generation runs under a lock file, writes the key first and the cert last, and never replaces a stored pair.
Config: geminiCert/geminiKey with GEEKITY_GEMINI_CERT/GEEKITY_GEMINI_KEY. Missing, unreadable, unparseable, mismatched, or only one set is a problem sentence: serve() logs 'Gemini is not served: ...' and keeps serving HTTP; the admin and the CLI show the same sentence.
Generation happens in Cms.serve() when site.gemini is on, and via a settings.watch on site.gemini when it is turned on at runtime (the data census drives that path).
CLI: geekity gemini cert (subject, expiry, SHA-256 fingerprint, and a host-mismatch note) and geekity gemini new-cert (refused for operator files).
Validation: pnpm build, test (cms 7419 pass, all packages 0 fail), test:11ty, typecheck, lint, format:check all exit 0. Live: geekity serve on port 3917 with site.gemini on wrote data/gemini (dir 0700, key 0600); /healthz 200; signed-in GET /admin/settings/reading showed the fingerprint matching geekity gemini cert; restart with GEEKITY_BASE_URL=https://shll.me kept the same cert (shasum OK) and gemini cert printed the mismatch note; start with a missing GEEKITY_GEMINI_CERT logged the problem and /healthz still answered 200; gemini new-cert wrote CN=shll.me. Server stopped by PID.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The site now keeps a long-lived self-signed certificate for Gemini. With site.gemini on, the first start (or turning it on in the admin) writes data/gemini/cert.pem and key.pem (key 0600, folder 0700) for the base URL host, valid 50 years, made with node:crypto and a small DER writer. Later starts reuse it, a changed host does not replace it, and geekity gemini new-cert replaces it on purpose. GEEKITY_GEMINI_CERT/KEY (geminiCert/geminiKey) point at operator files; a bad file is a logged problem, not a crash. geekity gemini cert and Settings > Reading show the SHA-256 fingerprint. Both files are kept data, so export and import carry them with their modes (round-trip test). docs/configuration.md documents the settings and the TOFU consequence. Verified with the full build/test/typecheck/lint/format chain and a live server on port 3917.
<!-- SECTION:FINAL_SUMMARY:END -->
