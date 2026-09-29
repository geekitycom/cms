---
id: TASK-135
title: Retention and minimisation for commenter and contact data
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 03:47'
labels:
  - privacy
  - comments
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/privacy/data-minimization/'
priority: medium
type: feature
ordinal: 159800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commenter email addresses are stored in plain text in the comment records inside the content files (src/comments/records.ts), and nothing is ever purged. Contact-form messages are also kept forever. Only a salted IP hash is stored, which is good. A site owner should be able to collect less, and keep what they collect only as long as they need it, without editing files by hand.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A site can configure how long commenter emails, IP hashes and contact messages are kept, with conservative defaults documented
- [x] #2 A scheduled job removes or redacts data past its retention period from the content files and the cache, and is idempotent
- [x] #3 Removing a commenter's email does not break the comment thread, its moderation history, or its display
- [x] #4 An admin can erase one commenter's personal data on request, from the admin
- [x] #5 README lists every piece of personal data the CMS stores and where
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: CommentRecord gains optional redacted: ('email'|'addressHash'|'author')[] (absent when nothing was removed, so existing files stay byte-identical). The index gets a redacted column (migration 20) and hasApprovedAuthor ignores rows whose email was redacted.
1. Settings: three site.json settings on Settings > Discussion: commentEmailRetentionDays, addressHashRetentionDays, contactMessageRetentionDays. An absent key is 0 (keep forever), so upgrading deletes nothing; geekity init writes the recommended 180/30/365; the screen says 'Kept forever' or 'Removed after N days' and recommends the periods.
2. src/privacy/: pure rules plus createRetentionService (sweep/start/stop/settled like the avatar service), started in serve(), stopped and awaited in close(), exposed as Cms.retention. Comment files are rewritten under withFileLock via records.ts rewriteComments; contact files via updateContactMessage or deleteContactMessage.
3. Email removal also clears notify; moderation links key on comment id.
4. Tools > Personal data: find by email, confirm, anonymise comments, delete contact messages, drop the opt-out. Behind the admin guard.
5. README: personal data inventory, retention and erasure sections, upgrade note.
6. Tests first per AC; full gate plus curl against a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions:
- Retention periods are site settings in content/_data/site.json (commentEmailRetentionDays, addressHashRetentionDays, contactMessageRetentionDays; 0 keeps forever), on Settings > Discussion beside commentsCloseAfterDays. How long a site keeps readers' data is an owner policy decision that a privacy notice quotes, so a public admin-editable file fits better than geekity.config.ts.
- Defaults (revised after orchestrator review): an absent key reads as 0, forever, so an upgraded site (for example one whose site.json predates this) loses nothing on its first sweep. New sites opt in: the init/seed template packages/cms/templates/site/content/_data/site.json writes the recommended 180 / 30 / 365 (RECOMMENDED_* constants in src/privacy/policy.ts). apps/demo/content/_data/site.json also sets 180 / 30 / 365, so the demo shows what a new site gets; the demo tracks no comment files, so a sweep there rewrites nothing in git. The Discussion screen says 'Kept forever' for a 0 period and 'Removed after N days' otherwise, and each hint names the recommended value so an existing owner opts in with one save.
- CommentRecord gains optional redacted: ('email'|'addressHash'|'author')[], omitted when empty so unswept files stay byte-identical. Index column comments.redacted (migration 20). hasApprovedAuthor skips rows whose email was redacted: without it, stripping Ada's email would auto-approve anyone typing 'Ada' with no email (proved: the retention test fails with the clause removed).
- The sweep reads files, not the index: comments via new records.ts rewriteComments(records, slug, fn) under withFileLock with writeFileAtomicallySync, putting each changed entry into the index in the same step; contact messages via new updateContactMessage (locked, re-decides on the locked copy) or deleteContactMessage. setContactMessageRead now delegates to updateContactMessage.
- Email removal also clears notify, so a reply subscription just stops. Moderation links carry the comment id and keep working (tested).
- Erasure (Tools > Personal data, /admin/tools/personal-data): find by email, a confirm step with counts, then anonymise every matching comment (name 'Anonymous', email/url/avatar/addressHash null, notify false), delete their contact messages, remove them from data/comment-optouts.json (new removeCommentOptOut). Comments are anonymised rather than deleted so replies keep their parent. Behind the admin guard (CSRF + crossSiteWrite, both tested).
- Service lifecycle mirrors avatars: createRetentionService in index.ts, start() in serve(), stop()+settled() in close(), Cms.retention.sweep() for tests. Runs every 6 hours.
- Follow-up: TASK-182 moves commenter emails out of content/ so they stop entering git history.
Validation: pnpm build && pnpm test (2417 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Tests include an upgrade test (site.json without the keys keeps an old email, hash and year-old message through a sweep) and an init test (a fresh site has 180/30/365). Live: a scratch site whose site.json had no retention keys served from the built CLI on :3918; the boot sweep left the old comment and contact files byte-identical (md5), and the Discussion screen showed 'Kept forever' three times with the recommended values. Earlier live run on :3917 with periods set: the sweep stripped old data, and Tools > Personal data refused a cross-site post (403) and erased on confirm (303). Servers stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added retention and erasure for commenter and contact data. Three site settings on Settings > Discussion (commentEmailRetentionDays, addressHashRetentionDays, contactMessageRetentionDays) drive a sweep (src/privacy/retention.ts) that runs when the site serves and every 6 hours. An absent key means keep forever, so upgrading never deletes data; geekity init and the demo write the recommended 180 / 30 / 365, and the screen shows 'Kept forever' or 'Removed after N days' and suggests the recommended values. The sweep rewrites comment files and contact messages under their file locks, updates the SQLite index in the same step, and writes nothing on a second run. A removed email clears the reply subscription and marks the entry redacted, so it no longer counts toward auto-approval; the thread, status, words and moderation links are unchanged. Tools > Personal data erases one person's data by email: comments anonymised, contact messages deleted, and the address removed from the opt-out list. packages/cms/README.md lists every piece of personal data and where it lives, with retention, erasure and upgrade notes; the root README and doc-6 point to it. Verified with tests in src/privacy/retention.test.ts, src/admin/personal-data.test.ts, settings-discussion.test.ts and cli-init.test.ts, the full gate, and curl against running built sites. Follow-up TASK-182 moves commenter emails out of content/ so they stop entering git history.
<!-- SECTION:FINAL_SUMMARY:END -->
