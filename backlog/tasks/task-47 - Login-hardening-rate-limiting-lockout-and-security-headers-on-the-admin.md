---
id: TASK-47
title: 'Login hardening: rate limiting, lockout, and security headers on the admin'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:34'
updated_date: '2026-09-04 06:14'
labels:
  - admin
  - security
milestone: m-5
dependencies:
  - TASK-9
references:
  - backlog/docs/doc-5 - Admin-UI.md
  - >-
    https://owasp.org/www-project-cheat-sheets/cheatsheets/Authentication_Cheat_Sheet.html
type: feature
ordinal: 27950
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Before a public deployment, `/admin/login` needs to resist guessing and the admin needs defensive headers. Throttle failed logins per username and per client address with a growing delay and a temporary lockout after a configurable number of failures, kept in memory (a restart clears it, which is fine) and logged. Send `Content-Security-Policy` (self only, with what the editor bundle and CodeMirror need), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `X-Frame-Options`/`frame-ancestors` on every admin response, and `Strict-Transport-Security` when the base URL is https. Keep the public site's headers minimal so themes are not constrained. Check that the session cookie already carries HttpOnly, Secure (under https) and SameSite=Lax and add a test if none pins it. Document the limits and how to tune them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After the configured number of failed logins for a username or address, further attempts are refused for the lockout period with a clear message, and a correct password during lockout is also refused
- [x] #2 Every admin response carries CSP, nosniff, referrer and frame headers, and HSTS under an https base URL; the editor, preview iframe and uploads still work under that CSP
- [x] #3 The session cookie's HttpOnly, Secure and SameSite attributes are pinned by a test
- [x] #4 Limits are configurable and documented
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New src/admin/throttle.ts: an in-memory login throttle keyed by username and client address, with an injectable Clock. A key over the attempt threshold is locked for lockoutSeconds, doubling for each further failure up to a cap; a success clears both keys. No artificial per-request sleep (it holds a connection open and is itself a lever), the growing wait is the delay.
2. New src/admin/headers.ts: baselineSecurityHeaders (nosniff everywhere, HSTS under an https baseUrl) and adminSecurityHeaders (a per-response CSP nonce on c.var.cspNonce, then CSP, Referrer-Policy, X-Frame-Options and the baseline on the way out). Mounted in front of everything in mountAdmin, including the static assets, and the baseline on the whole app in createCms.
3. CSP: default-src 'self'; script-src 'self'; style-src 'self' 'nonce-…'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' (the editor frames its own preview). Move the slug/permalink inline script out of document-editor.njk into admin/static/slug.js so the admin has no inline script at all; carry the nonce on the editor.js tag and read it back through the element's .nonce IDL so CodeMirror's runtime style-mod injection gets EditorView.cspNonce. Fall back to 'unsafe-inline' for style-src only if the nonce does not reach CodeMirror, and record why.
4. Config: loginAttempts (5, GEEKITY_LOGIN_ATTEMPTS), loginLockout seconds (900, GEEKITY_LOGIN_LOCKOUT) and trustProxy (false, GEEKITY_TRUST_PROXY, decides whether x-forwarded-for is believed over the socket address from @hono/node-server/conninfo).
5. POST /admin/login checks the throttle before verifying the password, so a correct password during a lockout is refused too, answers 429 with a wait message that is the same whether or not the username exists, records a failure on a wrong password and clears both keys on a success. Failures and lockouts are logged.
6. Tests first, red-green, through the existing admin harness: throttle unit tests on a fake clock, HTTP tests driving the clock through createCms({ now }), header tests on every kind of admin response and on a public one, and the session cookie attributes (already pinned; keep and extend).
7. Document the limits in packages/cms/README.md (config table and the admin section) and in the root README config section, and add the new options to templates/site/geekity.config.ts.
8. Verify: pnpm build, test, typecheck, lint, format:check from the root, then the demo on port 3000 — curl past the threshold and see the lockout refuse a correct password, curl the admin headers, and a browser pass over the editor, CodeMirror, the preview iframe and an upload reading the console for CSP violations.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decisions

- **The lockout is checked before the password is verified.** Otherwise an attacker who happened to guess right on the attempt that tripped the limit would be let straight in, which is precisely the case the limit exists for. AC #1's second half falls out of the ordering rather than being a separate check.
- **A growing lockout, not a growing sleep.** The task asks for "a growing delay". It is the lockout that grows — doubling per failure past the threshold, capped at 16x by `LOCKOUT_GROWTH_LIMIT` (four hours at the default). There is no artificial pause on an individual attempt: a sleep in the handler holds a connection open for as long as it lasts, so a hundred parallel guesses would cost the server a hundred idle sockets and the attacker nothing. The cap exists because an uncapped doubling reaches years, which is a denial of service against the site's own owner — anybody who can guess a username could lock it shut for good.
- **Two keys, and the username key is used whether or not the user exists.** `user:<lowercased>` and `addr:<client>`. A username nobody has is counted and locked out exactly as a real one is, so the 429 discloses nothing the 401 did not — which is what keeps TASK-9's deliberate single message intact. The largest of the two waits is reported.
- **In memory, per mount, cleared by a restart.** A failed login writes nothing an anonymous caller can grow. Proven live: after the lockout, restarting the demo let the correct password in again.
- **`trustProxy` defaults to false.** `X-Forwarded-For` is only believed when the site says a proxy sets it; otherwise the address is the socket's, through `getConnInfo` from `@hono/node-server/conninfo`, wrapped in try/catch because there is no socket when the app is driven in process (`app.request`) — then the username is the only key. Believing the header unconditionally would let one attacker put every guess on a different make-believe address.
- **Two layers of headers.** `baselineSecurityHeaders` on the whole app (nosniff, plus HSTS when `usesSecureCookies(config)` — the same test the session cookie's `Secure` uses, so the two cannot disagree); `adminSecurityHeaders` in front of everything under `/admin`, registered before the asset route and the guard so "every admin response" includes static files, redirects and 404s. HSTS is on the public site too because it is a statement about the host and the admin is the same origin; nothing else is, so a theme stays unconstrained.
- **`frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`, not DENY.** The editor's preview is a `srcdoc` iframe, which inherits the parent policy.
- **The nonce reached CodeMirror; `'unsafe-inline'` was never needed.** The one inline script in the admin (slug/permalink auto-fill) moved to `admin/static/slug.js`, so `script-src` is a bare `'self'`. The nonce goes on the `editor.js` tag and the bundle reads it back through the element's `.nonce` IDL property — verified in Chrome that the content attribute is blanked (`getAttribute('nonce') === ''`) while `.nonce` still returns the value, which is why a `data-` attribute was not used: it would be readable by a CSS selector. It is handed to `EditorView.cspNonce` (@codemirror/view 6.43.10).
- **`'self'` was enough for the sandboxed srcdoc preview.** The worry was that an opaque origin would stop `'self'` matching, forcing the request origin into the policy. It does not: CSP3 inherits the policy *and its self-origin*, so `/theme/style.css` and `/uploads/...` load inside the frame. Confirmed in the browser, so no looser preview policy and no explicit origin were needed.
- **`img-src 'self' data:`** so a preview of a post holding a data URI image does not lie about what publishing would show. `connect-src 'self'` covers the editor's preview and upload fetches.
- **AC #3 needed no new test.** `src/admin/routes.test.ts` already pins HttpOnly, SameSite=Lax, Path=/admin, Secure-under-https and Secure-off-under-http (`describe('the session cookie')`).

## Validation

Root gates, all clean on the final tree: `pnpm build`, `pnpm typecheck` (both projects), `pnpm lint`, `pnpm format:check`, `pnpm test` (807 in the package + 11 in the demo, up from 786 + 11 — 21 new: 9 in `src/admin/throttle.test.ts`, 6 header and 6 throttle HTTP tests in `src/admin/routes.test.ts`, 4 in `src/config.test.ts`), `pnpm test:11ty` (10 + 5). `npm pack --dry-run` shows `admin/static/slug.js` (2.2 kB) in the tarball.

The new tests were mutation-checked, not trusted. Each of these failed exactly the tests that name the behaviour and nothing else: dropping the growth cap, making `succeed` a no-op, skipping the lockout check in the login handler, dropping the nonce from `style-src`, dropping `nosniff` from the baseline.

Manual pass against `apps/demo` on port 3000 (`pnpm dev`), signed in as `ada`.

- **Headers, by curl.** `/admin/login`, `/admin/_static/admin.css`: `content-security-policy: default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'nonce-…'; img-src 'self' data:; font-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'self'`, plus `referrer-policy: same-origin`, `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`. `GET /`: `nosniff` and nothing else. No HSTS anywhere, correctly — the demo's baseUrl is http.
- **AC #1, by curl.** Five wrong passwords for `ada` -> 401 each. The sixth request, with the *correct* password -> `429`, `retry-after: 900`, and "Too many sign-in attempts. Try again in 15 minutes." rendered in the form. A seventh, also correct -> 429. The server log carried five `Failed sign-in for "ada" from ::1` and then `Refused a sign-in for "ada" from ::1: locked out for another 900s` — so the address key resolved through the real socket. Restarting the process cleared it: the correct password then returned 303. Repeated from inside the page with `fetch` (which also exercises `connect-src 'self'`): 401 x5 then 429 with `retry-after: 900`.
- **AC #2, in Chrome.** `/admin/posts/new`: `document.getElementById('editor-script').nonce` returned the same value as the policy while `getAttribute('nonce')` returned `''`; the `<style>` CodeMirror injected carried that nonce and had a live sheet of 146 rules; the editor rendered with its gutter, line numbers and Markdown highlighting. Typing into CodeMirror synced to the textarea. `slug.js` ran under `script-src 'self'`: typing a title filled the slug `a-csp-check` and the permalink `/2026/09/a-csp-check/`. Preview rendered the demo's own post layout inside the sandboxed `srcdoc` frame **with `/theme/style.css` applied** — serif type on the theme's cream ground — which is the evidence that `'self'` still matches inside an inherited policy. A real 1x1 PNG through the file input uploaded, put `![csp-probe](/uploads/2026/09/csp-probe.png)` at the cursor, and the preview then *decoded* it (a single coloured pixel, not a broken-image glyph), so `img-src 'self'` covers uploads in the frame too. Zero console messages through the whole pass (the reader was proved alive with a probe log).
- **The policy is enforced, not merely present.** Appending an inline `<script>` to the page did not run (`window.__cspProbeRan === false`) and an un-nonced `<style>` got no sheet, while CodeMirror's nonced one did.

Nothing was published from the demo, so `rpc.rsscloud.io` was never pinged. The test upload was deleted (`content/uploads` holds only the pre-existing `geekity-icon.png`), the tab was closed, the server was killed, `pgrep -fl "tsx watch"` is empty and port 3000 is free. The pre-existing uncommitted edit to `apps/demo/content/_data/site.json` is untouched.

## Public API

The new pieces are re-exported from `src/index.ts` alongside the rest of the admin, so a site that mounts its own admin routes can reuse them the way it already can `guard`: `adminSecurityHeaders`, `baselineSecurityHeaders`, `adminContentSecurityPolicy`, `createNonce`, `HSTS_MAX_AGE`, `HSTS_VALUE`, `NONCE_BYTES`, `createLoginThrottle`, `clientAddress`, `loginKeys`, `describeWait`, `LOCKOUT_GROWTH_LIMIT`, and the `LoginThrottle` / `LoginThrottleOptions` types. `GeekityEnv.Variables` gained `cspNonce: string | undefined`, set by `adminSecurityHeaders` and put in every admin template's context as `cspNonce`.

Re-ran the whole sweep after that barrel change: build, typecheck, lint, format:check and test (807 + 11) all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave the admin login a throttle and every admin response a set of defensive headers, without loosening anything the editor needs.

`src/admin/throttle.ts` counts failed sign-ins in memory against two keys — the username that was typed and the address the request came from — over an injectable clock. Past `loginAttempts` failures the key is locked for `loginLockout` seconds, doubling for each further failure up to sixteen times that. The check runs *before* the password is verified, so a correct password during a lockout is refused too; the wait is reported as a 429 with `Retry-After` and a message that reads the same whether or not the username exists, so the lockout cannot be used to enumerate accounts. There is no artificial sleep — that would hold a connection open and cost the server more than the attacker — and the counts are deliberately not in SQLite, so a failed login writes nothing an anonymous caller can grow. Both refusals are logged. The address comes from the socket unless `trustProxy` says a reverse proxy sets `X-Forwarded-For`.

`src/admin/headers.ts` puts `nosniff` on every response the CMS sends and `Strict-Transport-Security` on it when `baseUrl` is https — keyed off the same `usesSecureCookies` the session cookie uses. Everything under `/admin`, static files and redirects included, also gets `Referrer-Policy: same-origin`, `X-Frame-Options: SAMEORIGIN` and a `'self'` Content-Security-Policy. The public site gets nothing more, so a theme stays unconstrained. Getting to that policy took two moves: the admin's one inline script (the slug and permalink auto-fill) became `admin/static/slug.js`, so `script-src` is a bare `'self'`; and a per-response nonce is put on the editor bundle's tag, read back by the bundle through the element's `.nonce` property and handed to `EditorView.cspNonce`, so CodeMirror's runtime `<style>` injection is allowed without `'unsafe-inline'`. `img-src 'self' data:` keeps a data URI image in a preview honest, and `frame-ancestors 'self'` is what lets the editor frame its own preview.

Three new config options — `loginAttempts` (5), `loginLockout` (900) and `trustProxy` (false), each with a `GEEKITY_*` override — are documented in both READMEs and in the `geekity init` site template.

Verified with 21 new tests, every one mutation-checked, and a live pass against the demo. By curl: five wrong passwords then the *right* one refused 429 with `retry-after: 900` and "Try again in 15 minutes", the address key resolving through the real socket in the log, and a restart clearing it. In Chrome: the nonce attribute blanked while `.nonce` still carried it, CodeMirror's injected stylesheet live at 146 rules, the slug auto-fill running from its new file, the sandboxed `srcdoc` preview rendering through the demo's own layout *with the theme stylesheet applied* and a freshly uploaded PNG decoded inside it — with zero console messages, and an inline script and an un-nonced style both proved blocked. The session cookie's HttpOnly, SameSite=Lax, Path and Secure-under-https were already pinned by tests. Root `build`, `typecheck`, `lint`, `format:check`, `test` (807 + 11) and `test:11ty` (10 + 5) all pass, and `slug.js` is in the packed tarball.
<!-- SECTION:FINAL_SUMMARY:END -->
