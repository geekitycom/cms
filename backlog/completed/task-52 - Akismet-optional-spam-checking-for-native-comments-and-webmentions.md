---
id: TASK-52
title: 'Akismet: optional spam checking for native comments and webmentions'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:39'
updated_date: '2026-09-04 23:34'
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
- [x] #1 With a key set, a submitted comment is checked with comment-check carrying the documented fields, proved against a stubbed endpoint; without a key nothing is sent
- [x] #2 A true response files the comment as spam, true with X-akismet-pro-tip: discard drops it entirely, and false follows the normal moderation rules
- [x] #3 Marking spam or not-spam in the admin sends submit-spam or submit-ham for that comment
- [x] #4 An unreachable or erroring Akismet leaves the comment pending and logs the failure
- [x] #5 The key is verified on save, stored under data/ with the other secrets, never mirrored to site.json, and the settings screen shows whether Akismet is connected
- [x] #6 Incoming webmentions are checked the same way with comment_type webmention
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New module packages/cms/src/comments/akismet.ts: AKISMET_KEY_FILE ('akismet.json' under dataDir, mode 0600), readAkismetKey / writeAkismetKey / removeAkismetKey, verifyAkismetKey (POST verify-key with api_key + blog), and createAkismetChecker() returning a CommentChecker. fetch is injectable for tests and falls back to globalThis.fetch; every call carries a User-Agent and an AbortSignal timeout.
2. The checker reads the key file on every call, so a key added or removed on the settings screen takes effect without a restart. No key means nothing is sent and the verdict is 'unknown'.
3. Verdict mapping: 200 + 'true' -> spam; 'true' with X-akismet-pro-tip: discard -> discard; 'false' -> 'unknown' (the normal moderation path, not 'ham'); 'invalid', a non-200, a timeout or a thrown error -> 'unknown' with a logged failure.
4. comment_type is 'webmention' when submission.comment.source is 'webmention', 'comment' otherwise. blog_lang is the primary subtag of the language setting, read lazily so a settings change needs no restart.
5. reportSpam / reportHam post the same field set to submit-spam / submit-ham.
6. createCms builds the Akismet checker only when the site named no commentChecker of its own, so GeekityConfig.commentChecker wins outright.
7. Settings screen: a separate form at /admin/settings/akismet (like the avatar's), which verifies the key with verify-key on save and stores { key, status, checkedAt }; the screen shows connected / refused / unchecked / no key. Nothing goes into site.json.
8. Tests first, hermetic: unit tests against an injected fetch for the fields, the mapping and the reports; integration tests through createCms with a stubbed globalThis.fetch for a native comment, a webmention, a moderation report, the settings form and a fediverse reply that is never sent.
9. Document in doc-5, doc-6, doc-7 and the package README, including data/akismet.json in the durable-files table.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built `packages/cms/src/comments/akismet.ts`: the key file (`data/akismet.json`, mode 0600, read on every call so a key change needs no restart), `verifyAkismetKey` (POST verify-key with api_key + blog; valid / invalid / unchecked, where unchecked is 'we could not ask' rather than 'no'), and `createAkismetChecker`, a CommentChecker that posts comment-check, submit-spam and submit-ham. `fetch` is injectable and defaults to the global one; every call carries `Geekity CMS/1.0 | Akismet/1.1` and an AbortSignal timeout of ten seconds.

Verdict mapping: 200 + 'true' -> spam; 'true' with X-akismet-pro-tip: discard -> discard; 'false' -> unknown, NOT ham, so TASK-50's rule (approved for a previously approved name and email, pending otherwise) still decides; 'invalid', a non-200, a timeout or a thrown error -> unknown with the failure logged, including Akismet's own X-akismet-debug-help. The checker never throws, so the log names Akismet rather than saying only that a checker refused to answer.

Fields: api_key, blog, blog_charset, blog_lang (the language setting's primary subtag, which is the ISO 639-1 Akismet documents), user_ip, user_agent, referrer, permalink, comment_type ('webmention' when comment.source is 'webmention', else 'comment'), comment_author, comment_author_email, comment_author_url, comment_content, comment_date_gmt, honeypot_field_name for a form submission, and is_test when the checker is built with isTest. Empty values are omitted rather than sent blank. submit-spam and submit-ham send the same set minus user_ip, user_agent and referrer: a stored comment keeps a salted hash of the address and nothing else (doc-6), so those three are genuinely gone by the time a moderator disagrees.

Wiring: `createCms` does `resolved.commentChecker ??= createAkismetChecker(...)`, so a `commentChecker` in the site's config wins outright and the Akismet one is built only when the site named none. It is built whether or not a key exists, because it short-circuits without one; that is what makes a key saved on the settings screen filter the next comment with no restart. Both the language and the key are read lazily for the same reason.

Settings: a second pair of forms at /admin/settings/akismet, like the avatar's, because the key is a credential rather than a setting and a key Akismet will not take must not lose an edit to the title. Saving verifies with verify-key and stores { key, status, checkedAt }; the panel reads Connected / 'Akismet does not recognise this key' / 'Akismet could not be reached' / Not connected and shows only the last four characters. A key Akismet refuses is stored and marked refused rather than thrown away: comment-check with an unknown key answers 'invalid', which is no opinion, so it can do no harm, and the screen can then say what is wrong instead of silently discarding what somebody pasted.

Tests, all hermetic (temp dirs, injected or stubbed fetch, no network):
- packages/cms/src/comments/akismet.test.ts (20) — verify-key's three answers, the key file and its 0600 mode, the whole comment-check field set asserted as one object, the four verdict mappings, the three failure modes with their log lines, comment_type webmention, is_test, and submit-spam / submit-ham.
- packages/cms/src/comments/akismet-site.test.ts (8) — a whole CMS with a key file and no configured checker: a comment posted through the public form is checked and lands pending on 'false', spam on 'true', nowhere at all on discard, and pending with a logged failure on a 503; an incoming webmention through /_geekity/webmention is checked as a webmention; a fediverse reply logged into the inbox reaches the post page with Akismet hearing nothing; a site with no key sends nothing; a site with its own commentChecker is asked instead of Akismet.
- packages/cms/src/admin/akismet.test.ts (10) — the settings panel's four states, verify-key on save, the 0600 file, the key's absence from site.json and from the rendered screen, removal, an empty key refused, a key saved into a running CMS filtering at once, and the moderation screen's submit-spam / submit-ham (and its silence with no key).

Verified from the repo root: pnpm build, pnpm test (1223 + 11 pass, 0 fail), pnpm test:11ty (15 + 5 pass), pnpm typecheck, pnpm lint and pnpm format:check all pass.

Documented in doc-5 (a new Settings section and the moderation bullet), doc-6 (a new Akismet section: the key file, precedence, the field set, the verdict table and the reports), doc-7 (an incoming webmention is sent as comment_type webmention) and the package README (an Akismet subsection under Comments, and data/akismet.json in the durable data/ table). The precedence is also in the JSDoc on GeekityConfig.commentChecker and ResolvedConfig.commentChecker.

Known limits, worth a follow-up rather than scope here: submit-spam and submit-ham cannot send user_ip, user_agent or referrer, because a stored comment keeps only a salted hash of the address — Akismet documents user_ip as required for those two, so a correction is weaker than the original check; the stored key's status is only ever written by the settings screen, so a key that Akismet stops recognising later shows as Connected until it is saved again (a comment-check answering 'invalid' could downgrade it); and AKISMET_USER_AGENT hard-codes 1.0 the way WEBMENTION_USER_AGENT does rather than tracking the package version.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Akismet is now the one spam checker @geekity/cms ships, off until a site has a key. The key is a credential, so it lives in data/akismet.json at mode 0600 rather than in the public site.json, is checked with verify-key when it is saved on a Spam checking panel of its own on /admin/settings, and is read on every call so a key added or removed takes effect without a restart. With a key, every native comment and every incoming webmention goes to comment-check with the documented fields (comment_type webmention for the latter); true files it as spam, true with X-akismet-pro-tip: discard drops it without a queue entry, false leaves TASK-50's moderation rules to decide, and any failure — invalid, a non-200, a timeout, an unreachable host — is no opinion plus a logged failure, so no comment is ever lost. Moderating something to or out of spam posts submit-spam or submit-ham. A commentChecker in the site's config wins outright over all of it. Proved by 38 hermetic tests across packages/cms/src/comments/akismet.test.ts, packages/cms/src/comments/akismet-site.test.ts and packages/cms/src/admin/akismet.test.ts — a stubbed endpoint at the unit level and a whole CMS at the integration level, including a fediverse reply that Akismet never hears about — with pnpm build, test, test:11ty, typecheck, lint and format:check all passing from the repo root.
<!-- SECTION:FINAL_SUMMARY:END -->
