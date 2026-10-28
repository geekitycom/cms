---
id: TASK-524
title: >-
  A form challenge seam with hCaptcha verification on the contact and comment
  forms
status: Done
assignee:
  - '@claude'
created_date: '2026-10-28T20:14:00Z'
updated_date: '2026-10-28T20:49:00Z'
labels: []
milestone: m-50
dependencies:
  - TASK-523
references:
  - decision-65
ordinal: 426800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-65: the public forms get a challenge step, built into core behind a seam a site can replace, as `commentChecker` is replaceable. hCaptcha is the one core ships. The operator chose to keep the forms working with JavaScript off, so a missing or failed token makes the submission spam rather than refusing it, and an unreachable hCaptcha counts as no opinion.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A config option names a form challenge; with none named, core uses hCaptcha, which does nothing while the site key or the secret is empty
- [x] #2 With hCaptcha configured, a contact submission and a stranger comment submission are verified against hCaptcha siteverify with the secret, the token, the site key and the client address
- [x] #3 A submission with no token, or one hCaptcha rejects, is stored with the `spam` status (the Spam list on Messages for contact, a spam comment for comments) and sends no email or notice
- [x] #4 A verification call that errors or times out is treated as no opinion, and the submission goes on exactly as it would with hCaptcha off
- [x] #5 The honeypot, form age and rate limit still run first, and Akismet still runs on whatever the challenge passes
- [x] #6 A signed-in commenter is never challenged; webmentions and moderator replies are never challenged
- [x] #7 The verification call is not held in dev mode, and the dev-mode site test still passes
- [x] #8 Storing or removing the keys takes effect on the next submission without a restart
- [x] #9 Tests cover pass, missing token, rejected token, unreachable hCaptcha, signed-in, and hCaptcha off, for both forms, with no real network call
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. forms/challenge.ts: the seam. FormChallenge { field; widget(): Promise<ChallengeWidget|undefined>; verify(attempt): Promise<'pass'|'fail'|'unknown'> }, ChallengeAttempt { token, address, type }.
2. comments/hcaptcha.ts: extract a shared siteverify POST helper used by the pair check and by createHcaptchaChallenge({settings, fetch, timeoutMs, logger}); HCAPTCHA_RESPONSE_FIELD = 'h-captcha-response', HCAPTCHA_SCRIPT_URL. Off (undefined widget, 'unknown' verdict, no call) while site key or secret empty; empty token = fail without a call; success = pass; success false = fail, except an error naming the pair (misconfigured secret) = unknown + warning; HTTP error, network error, timeout = unknown. Settings read on every call.
3. config.ts: formChallenge option on GeekityConfig and ResolvedConfig; cms/boot.ts withFormChallenge defaults to createHcaptchaChallenge when none named (like withCommentChecker). No holdOutbound.
4. Contact: ContactForm gains the token; submitContactMessage takes challenge, runs it after honeypot/validation/age/rate limit and before the checker; fail forces status spam (no mail, since delivery skips spam). Checker still runs; discard still wins.
5. Comments: CommentForm gains the token; submitComment runs the challenge at the same point and hands a 'spam' floor to intakeComment, whose status rule makes it spam (no notice). Signed-in path (submitReplyPost) and webmentions/moderator replies never see it.
6. Routes read the token from the body under the challenge's field.
7. Fix the settings-discussion save message if it is no longer true.
8. Tests first: unit tests for the challenge (pass, missing, rejected, unreachable/timeout, pair error, off, settings change without restart, params sent) and site tests for both forms (pass, missing, rejected, unreachable, off, signed-in), stubbed fetch only.
9. Run build, test, test:11ty, typecheck, lint, format:check; curl a running dev site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- Seam in packages/cms/src/forms/challenge.ts (ports layer, beside checker.ts): FormChallenge { field; widget(); verify(attempt) }, ChallengeWidget, ChallengeAttempt, ChallengeVerdict ('pass' | 'fail' | 'unknown'), askChallenge (a throwing challenge is no opinion) and challengeTokenOf (reads the token from a body under challenge.field).
- hCaptcha in packages/cms/src/comments/hcaptcha.ts: createHcaptchaChallenge({ settings, fetch?, timeoutMs?, logger? }), HCAPTCHA_RESPONSE_FIELD = 'h-captcha-response' (the field the widget names itself), HCAPTCHA_SCRIPT_URL. The siteverify POST is one shared helper used by the pair check and the token check. It sends secret, response, sitekey and remoteip (when the address is known).
- Config: formChallenge on GeekityConfig and ResolvedConfig; cms/boot.ts withFormDefences (renamed from withCommentChecker) builds the hCaptcha challenge when none is named. holdOutbound is not involved.
- Contact and stranger comments ask the challenge after the honeypot, validation, form age and rate limit, before the checker. Signed-in commenters take submitReplyPost and never reach it; webmentions and moderator replies (writeReplyPost, moderateComment) never pass a challenge to the intake.

Choices:
- fail + checker: the checker still runs on a failed challenge. discard still throws the submission away (keeps obvious bots off the spam list); anything else is filed as spam, ham included.
- hCaptcha answering with an error about the pair (invalid-input-secret, invalid-sitekey, missing-input-secret, sitekey-secret-mismatch) is no opinion and is logged, not a fail, so a bad secret cannot turn every stranger into spam.
- A stored pair with status 'invalid' turns the challenge off (no widget, no opinion): a widget drawn with a bad site key never yields a token. The Settings > Discussion messages for a refused pair now say no form is challenged until the pair is put right; the old wording (challenged with a pair that cannot pass) was no longer true.
- Docs: added formChallenge to docs/configuration.md and the four exported types to docs/public-api.md (public-api test requires it). The defence tables in docs/comments.md are left for TASK-526.

Verified: new unit tests in comments/hcaptcha.test.ts and site tests in comments/hcaptcha-site.test.ts (both forms: pass, missing token, rejected, unreachable, off, store/remove without restart, config-named challenge, honeypot/age first, checker on a pass, fail+discard, dev mode; webmention and signed-in never challenged), all with stubbed fetch. pnpm build, pnpm test (7764 cms tests pass, dev-mode-site included), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Live: a throwaway site on port 3317 with hCaptcha's published test keys in GEEKITY_HCAPTCHA__*; curl posts to /_geekity/contact and /_geekity/comments: no token -> spam, the test token -> received/pending (real siteverify), a forged token -> spam. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a form challenge seam (forms/challenge.ts) with hCaptcha as the default (comments/hcaptcha.ts, built in cms/boot.ts when the config names no formChallenge). The contact form and a stranger's comment ask it after the honeypot, form age and rate limit and before the checker: a missing or rejected token stores the submission as spam with no email or notice, an unreachable hCaptcha or an error about the pair is no opinion, and a checker discard still wins. Settings are read per call, so storing or removing the pair needs no restart; a pair hCaptcha refused turns the challenge off, and the Settings > Discussion wording now says so. Signed-in commenters, webmentions and moderator replies are never challenged; dev mode does not hold siteverify. Covered by stubbed-fetch unit and site tests for both forms; full build, test, test:11ty, typecheck, lint and format:check pass, and a curl run against a local site with hCaptcha test keys showed spam/received/spam for no token, the test token and a forged one. Follow-up: TASK-525 draws the widget from FormChallenge.widget(); TASK-526 documents the defence order.
<!-- SECTION:FINAL_SUMMARY:END -->
