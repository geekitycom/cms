---
id: doc-5
title: Admin UI
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-02 13:23'
---
# Admin UI

The admin lives at `/admin` and borrows the shape of WordPress classic without its editors. Server-rendered Nunjucks pages, progressive enhancement only where it clearly helps (markdown preview, slug auto-fill).

## Screens

| Route | Purpose |
| --- | --- |
| `/admin/login` | username + password form |
| `/admin` | dashboard: counts, recent posts, quick draft |
| `/admin/posts` | table: title, author, tags, date, status; filters for all/published/draft/trash |
| `/admin/posts/new`, `/admin/posts/:slug` | editor |
| `/admin/pages`, `/admin/pages/new`, `/admin/pages/:slug` | same as posts, without date prefix or tags |
| `/admin/settings` | site title, tagline, base URL, timezone, posts per page, actor handle and type |
| `/admin/users` | list, add, change password (single role: admin) |
| `/admin/federation` | follower list, recent inbox activity, manual re-deliver |

## Editor

- Fields: title, slug (auto from title until touched), permalink preview, date, tags (comma separated), description, draft checkbox, body.
- Body is a plain `<textarea>` enhanced with CodeMirror 6 in markdown mode. A preview tab posts the body to `/admin/preview` and shows rendered HTML in the theme's post template.
- Save writes the file (see doc-1 sync model). The form carries the file hash it was loaded with; a mismatch on save returns the form with a warning and both versions.
- Buttons: Save draft, Publish, Update, Move to trash, View.

## Auth

- Passwords hashed with argon2id.
- Session id in an `HttpOnly; Secure; SameSite=Lax` cookie, stored in SQLite with expiry.
- CSRF token per session on every mutating form.
- First run: if no users exist, `/admin` shows a setup form that creates the first admin and writes initial settings.

## Out of scope for phase one

- Roles beyond admin.
- Media library UI (uploads are copied into `content/uploads` by an upload endpoint used from the editor).
- Revisions. Git on the content directory is the recommended history mechanism.
