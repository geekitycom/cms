---
id: TASK-362
title: 'Comment records split into files, intake and migrations'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-12 01:46'
labels: []
milestone: m-35
dependencies:
  - TASK-361
type: chore
ordinal: 321800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
comments/records.ts (1208 lines) mixes path helpers, JSON parse and normalise, mutation, intake and moderation policy, the SQLite index rebuild and two one-off boot migrations with their own helpers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Intake and moderation policy is its own module
- [x] #2 File reading and writing is its own module
- [x] #3 The boot migrations are their own module
- [x] #4 Comment tests pass unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Keep comments/records.ts as the file module (paths, parse and normalise, serialise, mutation, moved-comment follow, index rebuild), matching contact/records.ts and federation/records.ts; it stays in place so its history follows.
2. Move intakeComment, heldWebmention and the policy helpers (siteStatusFor, statusFor, ask, announce) with their types into comments/intake.ts.
3. Move migrateCommentEmails, migrateCommentKeys and their helpers (renamer, rewriteDocuments, without) into comments/migrations.ts; export contactsIn, contactsJson and CommentContact from records.ts for them.
4. Repoint importers (index.ts, cli.ts, submission.ts, reply-notices.ts, webmention/receive.ts and service.ts, records.test.ts import lines); no re-export shim.
5. Verify: pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
records.ts stays in place as the file module (paths, parse/normalise, serialise, mutation, moved-comment follow, index rebuild), so git history follows the largest piece without a rename; 1190 -> 718 lines. intake.ts (273) holds intakeComment, heldWebmention and siteStatusFor/statusFor/ask/announce with CommentOrigin, ProposedComment, CommentNotices, IntakeCommentOptions, CommentIntakeOutcome. migrations.ts (227) holds migrateCommentEmails, migrateCommentKeys, renamer, rewriteDocuments, without and both report types. records.ts now exports contactsIn, contactsJson and CommentContact for the migrations (not re-exported from comments/index.ts). No re-export shim: importers repointed (comments/index.ts, cli.ts, submission.ts, reply-notices.ts, webmention/receive.ts, webmention/service.ts). records.test.ts changed only in its import lines; no test body changed.
Validation: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check all exit 0 (cms 5616/5616 pass, plugins and demo pass).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split comments/records.ts into records.ts (files: paths, parse, serialise, mutation, index rebuild), intake.ts (intake and moderation policy) and migrations.ts (boot migrations). Importers repointed rather than re-exported; comments/index.ts and exports.ts expose the same names. Behaviour unchanged. Verified with pnpm build, test (5616 cms tests pass, only import lines of records.test.ts changed), typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
