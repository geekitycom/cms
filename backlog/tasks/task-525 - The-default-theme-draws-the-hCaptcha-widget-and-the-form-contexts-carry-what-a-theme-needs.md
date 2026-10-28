---
id: TASK-525
title: >-
  The default theme draws the hCaptcha widget, and the form contexts carry what
  a theme needs
status: Done
assignee:
  - '@claude'
created_date: '2026-10-28T20:14:00Z'
updated_date: '2026-10-28T21:29:00Z'
labels: []
milestone: m-50
dependencies:
  - TASK-524
references:
  - decision-65
ordinal: 427800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-65: a theme has to be able to draw the challenge. The default theme partials currently promise no script, and a site without hCaptcha should keep that. A site that replaces either partial needs the same data to draw the widget itself, or its stranger submissions all count as spam.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `contactForm` and `commentForm` carry the challenge when one is on: the provider, the site key, the script URL and the field name; without one, nothing extra is on the context
- [x] #2 The default theme renders the hCaptcha widget and loads its script only when the challenge is on and only for a stranger; a signed-in comment form and a site without hCaptcha get no script
- [x] #3 The widget follows the site colour mode (light, dark or the visitor preference) and the page language
- [x] #4 With JavaScript off, the form says the message may need a manual check and still submits
- [x] #5 The widget is reachable by keyboard and labelled in the form order, and the accessibility checks still pass
- [x] #6 docs/theme/comment-form.md and docs/theme/contact-form.md document the new context fields and say what happens to a replaced partial that draws no widget
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Resolve the challenge widget once per request in the request-start middleware (app.ts), beside devMode and mailConfigured: c.var.challengeWidget and a requestChallenge() in render-scope, through a challengeWidgetOf() helper in forms/challenge.ts that treats a throwing widget() as off.
2. Add an optional challenge field to CommentFormContext and ContactFormContext and a withChallenge() helper; drawnFor(form, viewer, challenge) adds it only for a stranger, signedInCommentForm drops it; commentFormFor/contactFormFor take a challenge option, page-sources passes requestChallenge(), and the refused-form pages in comment-routes and contact-routes pass c.var.challengeWidget.
3. Default theme: partials/form-challenge.njk macro drawing a labelled group with <div class=h-captcha data-sitekey> and a hint that says a message may wait for a manual check without it, before the submit button in both forms; base.njk loads static/hcaptcha.js (outside the scripts block, not in the editor preview) only when a drawn form carries an hcaptcha challenge, with the api.js URL in a data attribute. hcaptcha.js finds the widgets, picks light/dark from data-mode or prefers-color-scheme, and loads api.js with render=explicit, onload and hl=<html lang>.
4. Styles for the challenge group in src/style.css, rebuild the stylesheet.
5. Tests first per AC: context fields (unit + site), scripts only for strangers with a pair, mode/lang data, the hint, labelled order before submit, existing a11y/no-script checks updated.
6. Docs: docs/theme/comment-form.md, contact-form.md (and page-shell.md where scripts are listed).
7. Verify: build, test, test:11ty, typecheck, lint, format:check; curl a running site; Playwright with the hCaptcha test key.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned.

- The widget is resolved once per request in the request-start middleware (app.ts), beside devMode and mailConfigured, through challengeWidgetOf() (a throwing widget() is off and logged). It is c.var.challengeWidget for the routes and requestChallenge() in render-scope for the synchronous renderer.
- withChallenge() in forms/challenge.ts puts 'challenge' on a form only when a widget is on. drawnFor(form, viewer, challenge) adds it only for a stranger; signedInCommentForm drops it. commentFormFor/contactFormFor take a challenge option (page-sources passes requestChallenge()); the refused pages in comment-routes and contact-routes pass c.var.challengeWidget.
- Default theme: partials/form-challenge.njk macro widget(challenge, prefix, noun) draws a role=group div labelled by a visible 'Spam check' span and described by a hint that says the message or comment is still sent but may need a manual check if the check does not appear or JavaScript is off; an empty div.h-captcha[data-sitekey] in between. Both form partials call it just before p.form-submit.
- base.njk loads <script src=/theme/hcaptcha.js data-script=<scriptUrl> defer> at the end of body, outside the scripts block and not in the editor preview, when commentForm.challenge or (contactForm.challenge and no contactNotice) has provider hcaptcha. static/hcaptcha.js does nothing unless the page has a .h-captcha[data-sitekey]; then it loads api.js with render=explicit, onload=geekityDrawChallenge and hl=<html lang>, and renders each widget light or dark from <html data-mode> (light/dark), else prefers-color-scheme. So a replaced partial that draws no widget makes no request to hCaptcha.
- eslint: the theme's static scripts join the admin-static block (browser globals, sourceType script).
- CSS: .form-challenge-label styled as a label; .h-captcha keeps 78px min height.
- 11ty: the static build has no form contexts (forms need the server), so no widget or script is drawn there; pnpm test:11ty passes. Markdown and gemtext of /contact/ carry nothing about hCaptcha (tested).

Verification:
- New src/comments/hcaptcha-theme.test.ts: contexts (AC1), drawn widget/script only for strangers with a stored pair, none with no pair, an invalid pair, a signed-in viewer, or after ?contact=sent (AC2), refused forms keep it, hint text (AC4), labelled group inside the form before submit (AC5), and hcaptcha.js run in node:vm for render=explicit, hl, per-widget site key, and light/dark/system theme choice (AC3).
- Live: served a CMS on :3077 with hCaptcha test key 10000000-ffff-ffff-ffff-000000000001 and test secret, curl /contact/ shows the widget and script. Headless Chromium: iframe drawn theme=light / theme=dark under each prefers-color-scheme with colorMode system; theme=dark under a light preference with colorMode dark; hl=fr with language fr; Tab from the message box lands on hCaptcha's checkbox iframe; clicking it gave a token and the submission was stored as received (real siteverify). With JavaScript disabled the hint is visible, the form submits to ?contact=sent, and the message is stored as spam. Comment form widget drawn on an open post. Server stopped.
- Origins seen in Chromium: js.hcaptcha.com (script), newassets.hcaptcha.com (frame), api.hcaptcha.com (xhr), *.w.hcaptcha.com (fetch).

Checks: pnpm build, typecheck, lint, format:check and test:11ty pass. Full cms suite passed 7778/7778 in one run; in the later pnpm test run src/mcp/inspect/remote.test.ts hung once (cancelled, 0 failures) and passed 15/15 alone in 1 s, so it is a flake unrelated to this change. All other packages' suites pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The contact form and a stranger's comment form now carry the site's form challenge as 'challenge' { provider, siteKey, scriptUrl, field } while one is on, and nothing otherwise. The widget is resolved once per request at request start (c.var.challengeWidget, requestChallenge()), so the synchronous renderer, the page sources and the refused-form pages all see it; the signed-in comment form never carries it.

The default theme draws it through a new partials/form-challenge.njk macro: a labelled 'Spam check' group with div.h-captcha[data-sitekey] and a hint that the message may need a manual check without it, ahead of each submit button. base.njk loads a local static/hcaptcha.js only when a drawn form carries an hCaptcha challenge; that script loads api.js with explicit rendering, hl from <html lang>, and renders each widget light or dark from data-mode or prefers-color-scheme, and asks hCaptcha for nothing when no widget is on the page. A site without hCaptcha keeps forms with no script.

Verified by a new test file (contexts, drawn markup, script behaviour in node:vm), the full suites, and a live run with hCaptcha's test key in headless Chromium: widget drawn in both modes and in French, Tab reaches it, a solved check stores the message as received, and with JavaScript off the form submits and the message is stored as spam. Docs: docs/theme/comment-form.md and contact-form.md. Follow-up in TASK-526: privacy text, docs/comments.md (its 'The form has no script' line), CSP origins.
<!-- SECTION:FINAL_SUMMARY:END -->
