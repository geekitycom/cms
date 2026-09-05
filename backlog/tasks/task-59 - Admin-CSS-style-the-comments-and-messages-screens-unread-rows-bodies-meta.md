---
id: TASK-59
title: 'Admin CSS: style the comments and messages screens (unread rows, bodies, meta)'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 10:58'
updated_date: '2026-09-05 11:42'
labels:
  - admin
  - email
milestone: m-8
dependencies:
  - TASK-56
references:
  - packages/cms/admin/static/admin.css
  - packages/cms/admin/layouts/comments.njk
  - packages/cms/admin/layouts/messages.njk
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: enhancement
ordinal: 93000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin stylesheet `packages/cms/admin/static/admin.css` has no rules for the classes the Comments screen (`admin/layouts/comments.njk`) and the Messages screen (`admin/layouts/messages.njk`) emit: `admin-comments`, `admin-comment`, `admin-comment-meta`, `admin-comment-author`, `admin-comment-email`, `admin-comment-site`, `admin-comment-where`, `admin-comment-body`, `admin-comment-reply`, `admin-comment-unread`, `admin-message-subject` and `admin-message-body`. Both screens therefore render as unstyled lists: an unread message looks like a read one, a long body runs the full width, and the meta line is indistinguishable from the content. Give both screens a consistent look in the existing admin style: unread rows visibly distinct, bodies constrained to a readable measure with preserved line breaks, meta lines quieter than content, and the moderation and read/delete action rows aligned. Keep the same classes so no template needs to change, and keep the stylesheet the only place styles live.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every class listed in the description that comments.njk and messages.njk emit has a rule in admin.css, verified by a test or script that diffs the class names in the two templates against the selectors in the stylesheet
- [x] #2 An unread message row is visually distinct from a read one and returns to the read style after Mark read
- [x] #3 Comment and message bodies wrap at a readable width with line breaks preserved, and the meta line is styled as secondary text
- [x] #4 Both screens checked in a browser at desktop and narrow widths with no horizontal scrolling
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write packages/cms/src/admin/styles.test.ts first: extract every admin-* class name from admin/layouts/comments.njk and admin/layouts/messages.njk (class attributes, Nunjucks {% %} branches stripped, {{ }} interpolations tracked separately) and assert each has a class selector in admin/static/admin.css; a second case expands the dynamic admin-status-{{ row.status }} over COMMENT_STATUSES. Watch it fail on the missing classes.
2. Add the missing rules to admin/static/admin.css in the existing style: .admin-comments/.admin-comment as surface cards like .admin-panel, .admin-comment-unread marked and tinted, meta line flex with muted secondary text, bodies capped at a readable measure (.admin-message-body with white-space: pre-wrap because a message is plain text while a comment is rendered HTML), .admin-message-subject, .admin-comment-reply details, comment/message status colours, and .admin-filters ul so the nav-wrapped filter list on these two screens matches the plain ul on the posts screen. No template changes.
3. Re-run the test green, then check both screens rendered through the admin test harness and in a browser at desktop and narrow widths for horizontal scrolling.
4. Run pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check from the repo root.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Test first. Added packages/cms/src/admin/styles.test.ts, which reads comments.njk and messages.njk, pulls every admin-* token out of their class attributes (Nunjucks {% %} tags dropped and their contents kept, {{ }} interpolations replaced by a marker), and diffs that against the class selectors in admin.css. It failed red on 14 classes: admin-comments, admin-comment, admin-comment-meta, admin-comment-author, admin-comment-site, admin-comment-email, admin-comment-where, admin-comment-body, admin-comment-reply, admin-comment-unread, admin-message-subject, admin-message-body, admin-status-pending, admin-status-spam. A third case expands the interpolated admin-status-{{ row.status }} over COMMENT_STATUSES, so admin-status-approved is covered too.

CSS added to packages/cms/admin/static/admin.css, no template changed. The two screens are cards on the surface colour, like .admin-panel; an unread message takes --admin-unread (#f0f6fc, a new token) and a 4px --admin-link left edge, the way a flash notice is marked. The meta line is a wrapping flex row, the author is 600, the site and email are muted at 0.9em and break anywhere, and .admin-comment-where is muted 0.9em. Bodies cap at 42rem, the measure the settings form already reads at. .admin-message-body takes white-space: pre-wrap because a contact message is plain text printed into the div, while a comment is rendered Markdown and must not be; the comment body also holds somebody else's markup, so images, pre and blockquote are constrained. Two rules beyond the missing classes: .admin-hint code breaks (a path with no spaces in it was pushing the comments screen 7px sideways at 390px), and .admin-filters ul is the same flex row the listings get from .admin-filters directly, because these two screens wrap their tabs in a nav for the aria-label and were rendering a bulleted stack.

Browser check, Chrome against a seeded site on localhost:3000 (a throwaway content/data dir with one post, four comments across the three lists and three contact messages, admin created through the real setup form). Screens measured at viewport widths 1440, 1024, 768, 600 and 390 for /admin/comments (pending, approved, spam) and /admin/messages (inbox, spam): scrollWidth minus clientWidth was 0 everywhere, so no horizontal scrolling. At 320 there is 5-12px left, and it is the shell rather than these rules: the nav column is a fixed 11rem, and at that width /admin/posts overflows by 374px and /admin/settings by 282px. No element inside .admin-main exceeds the viewport on either screen at 320.

AC #2 in the browser: the unread row computed to background rgb(240,246,252) with border-left 4px rgb(34,113,177); after clicking its own Mark read button the same row came back as rgb(255,255,255) with the 1px rgb(195,196,199) border, identical to the row that was already read, while the other unread row kept its mark. messages.test.ts now also asserts the class toggles, so the template state behind that is covered by the suite.

AC #3 measured: .admin-comment-body is 672px in a 1425px viewport on both screens; the message body computes white-space: pre-wrap and renders its four typed lines as four lines; the meta line is rgb(100,105,112) at 12.6px against body text rgb(29,35,39) at 14px.

Screenshots: /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/d418e794-555f-4eb4-b22e-85c4f4122a06/scratchpad/shots/{comments-desktop,messages-desktop,comments-390,messages-768}.jpg. The seeded site and its port were shut down afterwards.

Validation from the repo root: pnpm build, pnpm test (1376 pass 0 fail in @geekity/cms, 14 pass 0 fail in demo), pnpm typecheck, pnpm lint and pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave /admin/comments and /admin/messages the styles their templates were already asking for. A new test, packages/cms/src/admin/styles.test.ts, diffs every admin-* class the two Nunjucks templates emit against the selectors in admin/static/admin.css; it went red on 14 classes, and admin.css now carries rules for all of them plus the three comment statuses. The two screens are cards in the admin's existing surface-and-border style: an unread message is tinted and marked down its left edge and goes back to the plain card on Mark read, bodies cap at the 42rem measure with a contact message's line breaks preserved by white-space: pre-wrap, and the meta lines are muted secondary text. Two neighbouring fixes fell out of the browser check: inline code in a hint may now break, and the filter tabs these screens wrap in a nav get the same one-line row the listings have. No template changed. Verified by the new test, by messages.test.ts asserting the unread class toggles, and in Chrome against a seeded site: computed styles before and after Mark read, a 672px body measure, and zero horizontal overflow on both screens and all five lists at 1440, 1024, 768, 600 and 390. pnpm build, test, typecheck, lint and format:check all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
