---
id: TASK-523
title: hCaptcha settings on Settings > Discussion
status: Done
assignee:
  - '@claude'
created_date: '2026-10-28T20:14:00Z'
updated_date: '2026-10-28T20:31:00Z'
labels: []
milestone: m-50
dependencies: []
references:
  - decision-65
ordinal: 425800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-65 puts hCaptcha in core next to Akismet. Before a form can ask for a challenge, a site needs somewhere to store a site key and a secret, and an operator needs a screen to set them on. The Akismet key is the pattern: a settings namespace over a credential data file, environment overrides, and a section of Settings > Discussion that stores, checks and removes it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An `hcaptcha` settings namespace stores `site_key` and `secret` in `data/hcaptcha.json`, declared as a credential data file; `secret` is a secret setting and `site_key` is not
- [x] #2 `GEEKITY_HCAPTCHA_SITE_KEY` and `GEEKITY_HCAPTCHA_SECRET` override the file, and the screen says when a value is set elsewhere, as it does for the Akismet key
- [x] #3 Settings > Discussion has an hCaptcha section that saves both values, removes them, and never prints the stored secret back into the page
- [x] #4 Saving checks the pair against hCaptcha where hCaptcha allows it, and the screen shows the result; a failed check still saves, as the Akismet key does
- [x] #5 The settings golden file, the data-file census and the settings CLI cover the new namespace
- [x] #6 docs/configuration.md and docs/comments.md describe the settings
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. packages/cms/src/settings/hcaptcha.ts: HCAPTCHA_FILE (data/hcaptcha.json, credential) and HCAPTCHA namespace (site_key plain text, secret secret text, status valid/invalid/unchecked, checked_at), envPrefix GEEKITY_HCAPTCHA; register in CORE and CORE_NAMESPACES.
2. packages/cms/src/comments/hcaptcha.ts: HCAPTCHA_VERIFY_URL and verifyHcaptchaPair({settings, at, by, fetch?, timeoutMs?}) posting secret, a dummy response and sitekey to siteverify; invalid-sitekey / invalid-input-secret / missing-input-secret / sitekey-secret-mismatch read as invalid, any other answer as valid (hCaptcha checks nothing else without a solved challenge), a thrown or non-2xx call as unchecked; stores status and checked_at.
3. Settings > Discussion: HCAPTCHA_PATH endpoint (save both, remove, check again), hcaptchaPanel merged into the page's panels; site key shown, secret never printed; per-value 'set by' for env overrides; a failed check still saves.
4. Template: an hCaptcha card on discussion.njk beside Spam checking.
5. Tests first: credentials.test (namespace, file mode, env override), comments/hcaptcha.test (pair check codes, unreachable, no network), admin/hcaptcha.test (save, remove, secret never printed, env set elsewhere, failed check saves), registry.test list + data files, cli-settings test, data census, remaining-screens titles, cli help/export docs.
6. Docs: docs/configuration.md, docs/comments.md, docs/settings.md, docs/cli.md, export help text.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Namespace hcaptcha (packages/cms/src/settings/hcaptcha.ts): site_key (not secret), secret (secret), plus status (valid/invalid/unchecked) and checked_at, mirroring akismet, so the screen can report the last check. File data/hcaptcha.json, credential, 0600. Registered in CORE and CORE_NAMESPACES.
- Environment variables follow the registry's spelling, GEEKITY_HCAPTCHA__SITE_KEY and GEEKITY_HCAPTCHA__SECRET (double underscore, as GEEKITY_AKISMET__KEY). AC #2 spells them with one underscore; the registry builds <PREFIX>__<KEY> for every namespace, so the double-underscore names are the ones that work and the ones the docs give.
- Pair check verifyHcaptchaPair (packages/cms/src/comments/hcaptcha.ts) posts secret, a placeholder response and sitekey to https://api.hcaptcha.com/siteverify. Probed the live API by hand (not from tests): with a placeholder token hCaptcha answers invalid-input-response for any secret, right or wrong, and adds invalid-sitekey only for a malformed site key; it does not report invalid-input-secret or sitekey-secret-mismatch without a solved challenge. So invalid-sitekey, invalid-input-secret, missing-input-secret and sitekey-secret-mismatch read as invalid, any other JSON answer as valid, a throw/non-2xx/non-JSON as unchecked. The screen says the secret is proven by the first real submission. That is the 'where hCaptcha allows it' of AC #4.
- Settings > Discussion: POST /admin/settings/hcaptcha saves (blank secret keeps the stored one; empty site key or no secret at all is refused), removes (forgetStored), or re-checks (action=verify). A failed or unreachable check still saves. The panel prints the site key and nothing of the secret; a value set by the environment is shown as set by its variable, with no box for it.
- Verified: pnpm build, pnpm test (cms 7729 pass, all packages 0 fail), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Curl against a scratch site under geekity serve: saving the hCaptcha test pair stored data/hcaptcha.json at 0600 with status valid and the page showed Connected with no secret in the HTML; site key 'nonsense' stored with status invalid and the Refused badge; Remove left {} and Not connected; with GEEKITY_HCAPTCHA__SITE_KEY/SECRET set the page said 'set by' for both, showed no boxes and no secret, and a typed secret was refused. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adds the hcaptcha settings namespace (site_key, secret, plus the last check's status and time) in data/hcaptcha.json as a credential file with GEEKITY_HCAPTCHA__* overrides, and an hCaptcha card on Settings > Discussion that saves, checks, re-checks and removes the pair without ever printing the secret. The check calls siteverify with a placeholder token; hCaptcha can only refuse a malformed site key that way, so the screen says the secret is proven by the first real submission. A failed check still saves, as Akismet does. Covered by settings, pair-check (stubbed fetch), admin, CLI, registry, data-class and data-census tests; docs/comments.md, configuration.md, settings.md, admin.md and cli.md describe it. No form is challenged yet; that is the next task.
<!-- SECTION:FINAL_SUMMARY:END -->
