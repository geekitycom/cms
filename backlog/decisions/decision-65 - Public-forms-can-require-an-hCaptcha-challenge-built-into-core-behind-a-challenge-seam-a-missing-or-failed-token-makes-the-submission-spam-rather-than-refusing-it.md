---
id: decision-65
title: >-
  Public forms can require an hCaptcha challenge, built into core behind a
  challenge seam; a missing or failed token makes the submission spam rather
  than refusing it
date: '2026-10-28T20:13:00Z'
status: accepted
---
## Context

The contact form and the stranger's comment form are protected by a honeypot, a form-age check, a per-address rate limit and the `commentChecker` seam, which is Akismet when a key is stored. The operator runs Akismet on every site and asked for hCaptcha on top, on both forms.

Both forms work with JavaScript switched off and carry no script. hCaptcha needs JavaScript and loads a script and an iframe from hCaptcha's servers, so turning it on changes both of those properties for the sites that do.

Akismet is built into core and configured on Settings > Discussion. The services added since then (Umami, the LLM plugins) are separate `@geekity/plugin-*` packages under decision-33. hCaptcha could have gone either way.

## Decision

**Built into core.** hCaptcha ships in `@geekity/cms`, next to Akismet, behind a new form challenge seam: a config option a site can set to a challenge of its own, as `commentChecker` is set. With none set, core builds the hCaptcha challenge, which does nothing until a site key and a secret are stored. Turnstile or reCAPTCHA can plug into the same seam later without a change to the forms.

**Settings.** The site key and the secret are an `hcaptcha` settings namespace in `data/hcaptcha.json`, a credential file, with `GEEKITY_HCAPTCHA_*` environment overrides, and are set on Settings > Discussion. The secret is a secret setting; the site key is not, because it is printed in the page. Like the Akismet key, they are read on every submission, so storing or removing them needs no restart.

**Which forms.** The contact form and the comment form as a stranger sees it. A signed-in commenter is not challenged, for the reason they skip the honeypot and the form-age check: a session is better evidence. Webmentions and moderator replies are not form submissions and are not challenged.

**A missing or failed token is spam.** A submission with no token, or one hCaptcha rejects, is not refused. It goes through the remaining defences and is stored with the `spam` status: on the Spam list of the Messages screen for a contact message, as a spam comment for a comment. Nobody is emailed about it. This keeps the forms usable with JavaScript off, at the cost of a list someone has to check, which is the same trade the contact form already makes for an Akismet false positive.

**hCaptcha unreachable is no opinion.** If the verification call fails or times out, the challenge has no opinion and the submission is treated as if hCaptcha were not configured. Akismet still runs either way.

**Dev mode does not hold it.** The `siteverify` call is part of deciding what to do with something received, as the Akismet check is, so `holdOutbound` does not apply to it.

**Themes.** The form contexts carry what a theme needs to draw the widget: whether a challenge is on, the site key, the script URL and the field name. The default theme draws the widget and loads the script only when a challenge is on, so a site without hCaptcha keeps forms with no script on them.

## Consequences

- A site that turns hCaptcha on loads a third-party script on every page with a form, and its privacy page needs to say so. The starter privacy page from `geekity init` and the demo's gain an hCaptcha section.
- A site that sets its own `Content-Security-Policy` through `securityHeaders` has to allow hCaptcha's script and frame origins. The public site sends no policy by default.
- A theme that replaces `partials/contact-form.njk` or `partials/comment-form.njk` draws no widget until it is updated, and its stranger submissions then all count as spam. The theme docs say so.
- Visitors with JavaScript off, and anyone hCaptcha's widget fails for, reach the operator only through the Spam list.
