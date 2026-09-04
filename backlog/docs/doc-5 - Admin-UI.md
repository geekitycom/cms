---
id: doc-5
title: Admin UI
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-04 16:43'
---
# Admin UI

The admin lives at `/admin` and borrows the shape of WordPress classic without its editors. Server-rendered Nunjucks pages, progressive enhancement only where it clearly helps (markdown preview, slug auto-fill).

## Screens

| Route | Purpose |
| --- | --- |
| `/admin/login` | username + password form |
| `/admin` | dashboard: counts, recent posts, follower count |
| `/admin/posts` | table: title, author, tags, date, status; filters for all/published/draft/trash |
| `/admin/posts/new`, `/admin/posts/:slug` | editor |
| `/admin/pages`, `/admin/pages/new`, `/admin/pages/:slug` | same as posts, without date prefix or tags |
| `/admin/tags`, `/admin/categories` | every term in use with its post and file counts; rename, merge, delete |
| `/admin/comments` | pending, approved and spam, with approve, spam, delete and reply on every row |
| `/admin/settings` | site title, tagline, base URL, timezone, posts per page, comments on/off and closing window, actor handle and type |
| `/admin/users` | list, add, change password (single role: admin) |
| `/admin/federation` | follower list, recent inbox activity, manual re-deliver |

## Editor

- Fields: title, slug (auto from title until touched), permalink preview, date, tags (comma separated), description, draft checkbox, comments (follow the site settings / open / closed), body.
- Body is a plain `<textarea>` enhanced with CodeMirror 6 in markdown mode. A preview tab posts the body to `/admin/preview` and shows rendered HTML in the theme's post template.
- Save writes the file (see doc-1 sync model). The form carries the file hash it was loaded with; a mismatch on save returns the form with a warning and both versions.
- Buttons: Save draft, Publish, Update, Move to trash, View.

## Comments

- `/admin/comments` is three lists — Pending, Approved, Spam — with the count beside each, opening on Pending. There is no email in this milestone, so this screen is the notification: the dashboard carries the number waiting and links here.
- Every row shows the commenter's name, their website, **their email** (the one place it is ever shown), the rendered comment, the post it is on with links to edit and to view it, and a short form of the salted address hash so a run of submissions from one machine is visible.
- Four actions per row: **Approve**, **Spam**, **Delete**, and **Reply** — a Markdown box that posts an approved comment under the one it answers, signed with the site's `author` setting or the moderator's login.
- Spam is kept rather than deleted, so a mistake can be undone and so a spam checker can be told it was wrong. Marking something spam calls the checker's `reportSpam`; letting something out of the spam list calls `reportHam`.
- Every action rewrites the comment's file under `content/_data/comments/` and the index inside the same step. The file is the comment (decision-9); this screen only ever moves it. The whole format, the closing rules and the checker seam are in doc-6.

## Auth

- Accounts live in `data/users.json` (decision-9): id, username, argon2id hash, created time, written atomically with 0600 permissions. Passwords hashed with argon2id.
- Session id in an `HttpOnly; Secure; SameSite=Lax` cookie, stored in SQLite with expiry.
- CSRF token per session on every mutating form.
- First run: if no users exist, `/admin` shows a setup form that creates the first admin and writes initial settings.

## Out of scope for phase one

- Roles beyond admin.
- Media library UI (uploads are copied into `content/uploads` by an upload endpoint used from the editor).
- Revisions. Git on the content directory is the recommended history mechanism.
