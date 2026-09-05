---
id: doc-5
title: Admin UI
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-05 02:18'
---
# Admin UI

The admin lives at `/admin` and borrows the shape of WordPress classic without its editors. Server-rendered Nunjucks pages, progressive enhancement only where it clearly helps (markdown preview, slug auto-fill).

## Screens

| Route | Purpose |
| --- | --- |
| `/admin/login` | username + password form, with a Forgot password link |
| `/admin/forgot`, `/admin/reset` | ask for a reset link, and set a new password with one |
| `/admin` | dashboard: counts, recent posts, follower count |
| `/admin/posts` | table: title, author, tags, date, status; filters for all/published/draft/trash |
| `/admin/posts/new`, `/admin/posts/:slug` | editor |
| `/admin/pages`, `/admin/pages/new`, `/admin/pages/:slug` | same as posts, without date prefix or tags |
| `/admin/tags`, `/admin/categories` | every term in use with its post and file counts; rename, merge, delete |
| `/admin/comments` | pending, approved and spam, with approve, spam, delete and reply on every row |
| `/admin/settings` | site title, tagline, base URL, timezone, posts per page, comments on/off and closing window, actor handle and type, the Akismet key, the mail provider and its credential |
| `/admin/users` | list, add, set each user's email, change your own password (single role: admin) |
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
- Spam is kept rather than deleted, so a mistake can be undone and so a spam checker can be told it was wrong. Marking something spam calls the checker's `reportSpam`; letting something out of the spam list calls `reportHam`. With an Akismet key stored, those are `submit-spam` and `submit-ham`.
- Every action rewrites the comment's file under `content/_data/comments/` and the index inside the same step. The file is the comment (decision-9); this screen only ever moves it. The whole format, the closing rules and the checker seam are in doc-6.

## Settings

- Every setting is a field of one form that rewrites `content/_data/site.json` (decision-9), with two exceptions: the avatar, which is an image, and the Akismet key, which is a credential. Both are their own pair of forms — save and remove — because neither can travel in that body, and because a rejected one must not lose an edit to the title.
- **Spam checking.** The Akismet key lives in `data/akismet.json` at mode `0600` rather than in `site.json`, which is public and in git. Saving one checks it with Akismet's `verify-key` first; the panel then says connected, "does not recognise this key", "could not be reached", or not connected, and shows the last four characters rather than the key. Remove key turns Akismet off. See doc-6.
- **Email.** How the site sends mail is three settings on the main form — `mailProvider` (`none`, `brevo` or `smtp`), the From name and address, and the reply-to — and one credential below it. The Brevo API key and the SMTP host, port, TLS flag, user and password live in `data/mail.json` at mode `0600`, never in `site.json`, and are its own pair of forms for the reason the Akismet key is. Neither secret is printed back: the panel shows the last four characters of the key and the non-secret half of the SMTP connection, and a blank secret keeps the stored one. **Send test email** takes an address and sends the theme's `test` message through the whole chain, reporting the provider's own answer and its message id on the flash. With no configuration, nothing is sent and every feature that emails still succeeds. See the Email section of the package README.

## Auth

- Accounts live in `data/users.json` (decision-9): id, username, optional email, argon2id hash, created time, written atomically with 0600 permissions. Passwords hashed with argon2id.
- Session id in an `HttpOnly; Secure; SameSite=Lax` cookie, stored in SQLite with expiry.
- CSRF token per session on every mutating form.
- First run: if no users exist, `/admin` shows a setup form that creates the first admin and writes initial settings.

## User email and password recovery

- **The address.** Every user may have an email address, and most will not: a login is a username and a password, and the address only buys password recovery and, later, the notices TASK-55 sends. It is set on the `/admin/users` table — one inline field per row, any row, since there is one role and every user already has every power — on the add form beside the username, and by `geekity user add <name> --email <address>`. An empty box removes it. It never appears on the public site.
- **Asking.** `/admin/forgot` takes a username *or* an email address and always answers with the same sentence, whether the name matched, did not match, or matched somebody with no address. That is the whole point of the screen: an answer that varied would be a list of which accounts the site has. Requests are rate limited by username and by address exactly as sign-ins are, on a throttle of its own, so a flood of resets for one person cannot lock them out of logging in.
- **The link.** A match with an address gets a message from the theme's `password-reset` template carrying `/admin/reset?token=…` — 256 random bits, hex. Only the token's SHA-256 is stored, in the `password_resets` table beside the sessions, so a copy of `geekity.db` is not a stack of working links. It expires an hour out and works once. The token is never rendered into the page of the browser that asked for it.
- **Setting it.** The reset form holds the new password to the same rules every other door does, then deletes every reset that user had outstanding, signs out every session they had, and sends the theme's `password-changed` confirmation, which carries no link back in. Both screens are unauthenticated and carry the session CSRF token and the admin security headers like every other form.
- **Without mail.** With no provider or credential, `/admin/forgot` offers no form: it says the site cannot send email and points at `geekity user add`, which is how a site with no way in gets a fresh admin from a shell. Saving a credential on the Settings screen turns the form on for the next visitor, with no restart.

## Out of scope for phase one

- Roles beyond admin.
- Media library UI (uploads are copied into `content/uploads` by an upload endpoint used from the editor).
- Revisions. Git on the content directory is the recommended history mechanism.
