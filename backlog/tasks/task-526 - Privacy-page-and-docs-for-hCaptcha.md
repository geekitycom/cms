---
id: TASK-526
title: Privacy page and docs for hCaptcha
status: Done
assignee:
  - '@claude'
created_date: '2026-10-28T20:14:00Z'
updated_date: '2026-10-28T21:38:00Z'
labels: []
milestone: m-50
dependencies:
  - TASK-525
references:
  - decision-65
ordinal: 428800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-65: a site that turns hCaptcha on loads a third-party script on its form pages and sends hCaptcha the visitor address, so its privacy page has to say so. A site with its own Content-Security-Policy has to allow hCaptcha, and operators need to know what a missing token does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The starter privacy page written by `geekity init` and `apps/demo/content/pages/privacy.md` gain an optional hCaptcha section beside the Akismet one, saying what is sent and linking hCaptcha privacy policy
- [x] #2 docs/comments.md lists the challenge in the contact form and comment form defence tables, in order, with what a missing or failed token does
- [x] #3 docs/configuration.md says which origins a site-set Content-Security-Policy must allow for hCaptcha
- [x] #4 `pnpm lint` passes, including the doc link check
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a failing seed test that the starter privacy page has an optional hCaptcha section linking hCaptcha's privacy policy.
2. Add the section to packages/cms/templates/site/content/pages/privacy.md and apps/demo/content/pages/privacy.md, after the Akismet one.
3. docs/comments.md: add the challenge to the comment-form defences and the contact-form defence table, in order, with what a missing or failed token does; reword the no-script sentence.
4. docs/configuration.md: CSP origins for hCaptcha (checked against docs.hcaptcha.com); point to it from docs/security.md.
5. Run build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Starter privacy page (packages/cms/templates/site/content/pages/privacy.md) and the demo's gain 'Spam checking with hCaptcha (optional)' after the Akismet section; seed.test.ts pins the heading, what hCaptcha receives, the signed-in case and the privacy-policy link. docs/comments.md: challenge added in order to the comment-form defence list and the contact-form defence table, an outcome table under ### hCaptcha (pass / no or rejected token = spam, nobody told, checker discard still drops / pair named or unreachable = no opinion), the no-script sentence reworded. docs/configuration.md: CSP origins https://hcaptcha.com and https://*.hcaptcha.com in script-src, frame-src, style-src, connect-src, confirmed against docs.hcaptcha.com on 2026-10-28, with an example; docs/security.md points to it. docs/personal-data.md lists hCaptcha as a third outside service. Verified: pnpm build, test (cms 7779 pass), test:11ty, typecheck, lint (every link resolves in 52 files), format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Documented hCaptcha for site owners and visitors. The starter privacy page written by geekity init and the demo privacy page say what hCaptcha receives (browser IP, user agent, page language, interaction and device signals; on submission the token and IP from the server), that signed-in commenters load nothing, and link https://www.hcaptcha.com/privacy. docs/comments.md puts the challenge in both defence lists in order and says what a missing, failed or unanswered token does; docs/configuration.md gives the CSP origins hCaptcha's own docs ask for, with an example securityHeaders policy; docs/personal-data.md and docs/security.md cross-reference it. A new seed test pins the starter page section. All checks pass. The starter page ships in @geekity/cms, so the commit is feat(cms).
<!-- SECTION:FINAL_SUMMARY:END -->
