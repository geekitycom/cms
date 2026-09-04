---
id: TASK-52
title: 'Akismet: optional spam checking for native comments and webmentions'
status: To Do
assignee: []
created_date: '2026-09-04 01:39'
updated_date: '2026-09-04 01:39'
labels:
  - admin
  - web
milestone: m-7
dependencies:
  - TASK-50
  - TASK-51
references:
  - 'https://akismet.com/developers/comment-check/'
  - 'https://akismet.com/developers/submit-spam-missed-spam/'
  - 'https://akismet.com/developers/submit-ham-false-positives/'
type: feature
ordinal: 41500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-50 defends the comment form with a honeypot, a minimum submit time and a rate limit, and holds everything for moderation. That stops the crude half of spam; the rest needs a classifier, and Akismet is the one WordPress sites already use. Make it optional: an `akismetKey` setting (stored in `data/`, never in `site.json` or the public site, since it is a credential), verified with `verify-key` when saved and shown as connected or not on the settings screen. When a key is present, every native comment and every incoming webmention is sent to `https://rest.akismet.com/1.1/comment-check` with `blog`, `user_ip`, `user_agent`, `referrer`, `permalink`, `comment_type` (`comment` for a native comment, `webmention` otherwise), `comment_author`, `comment_author_email`, `comment_author_url`, `comment_content`, `comment_date_gmt` and `blog_lang` from the language setting. A `true` answer files the comment as spam; `true` with the `X-akismet-pro-tip: discard` header drops it without a queue entry; `false` leaves it on the moderation path TASK-50 already defines (auto-approve for a previously approved commenter, pending otherwise). Marking a comment spam or not-spam on the admin screen sends `submit-spam` or `submit-ham` with the same fields so the classifier learns. A failed or slow Akismet call never loses a comment: the comment is held pending and the failure is logged. Tests run against a stubbed endpoint and use `is_test=true` if any live call is ever made. Fediverse replies are not sent to Akismet.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With a key set, a submitted comment is checked with comment-check carrying the documented fields, proved against a stubbed endpoint; without a key nothing is sent
- [ ] #2 A true response files the comment as spam, true with X-akismet-pro-tip: discard drops it entirely, and false follows the normal moderation rules
- [ ] #3 Marking spam or not-spam in the admin sends submit-spam or submit-ham for that comment
- [ ] #4 An unreachable or erroring Akismet leaves the comment pending and logs the failure
- [ ] #5 The key is verified on save, stored under data/ with the other secrets, never mirrored to site.json, and the settings screen shows whether Akismet is connected
- [ ] #6 Incoming webmentions are checked the same way with comment_type webmention
<!-- AC:END -->
