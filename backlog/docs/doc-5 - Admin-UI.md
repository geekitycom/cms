---
id: doc-5
title: Admin UI
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-13 03:14'
---
# Admin UI

The admin lives at `/admin` and borrows the shape of WordPress classic without its editors. Server-rendered Nunjucks pages, progressive enhancement only where it clearly helps (markdown preview, slug auto-fill).

## The menu

The navigation down the left is WordPress classic. A **section** is a heading
with one or more children; clicking the heading opens the section and lands on
the first of its children; the open section shows its children and the one you
are on is marked with `aria-current="page"`, so clicking Users tells you that
you are on Users > All users. Every section has at least one child even when it
has exactly one screen, because that is what makes the rule uniform: a second
child can appear later without the menu changing shape, and no screen has to
know whether it is the only one of its kind.

| Section    | Children                                     |
| ---------- | -------------------------------------------- |
| Dashboard  | Home                                         |
| Posts      | All posts, Add new, Categories, Tags         |
| Pages      | All pages, Add new                           |
| Media      | Library                                      |
| Comments   | All comments                                 |
| Messages   | All messages                                 |
| Users      | All users, Add new                           |
| Settings   | General, Reading, Permalinks, Discussion, Email, Federation |
| Federation | Followers                                    |

The terms are under Posts rather than at the top level because that is what
they are about: a tag with no post on it is nothing.

The whole menu is one registry, `src/admin/menu.ts`. A screen names its section
and its child — `render(c, template, { section: 'posts', child: 'tags', … })` —
and the registry renders the list; a pair it does not hold is refused rather
than drawn as a menu expanded around nothing, so a screen cannot ship naming a
child that does not exist. Adding a screen to the menu is one entry in a
section's `children` and the same `child` name on what that screen renders.

The menu needs no JavaScript. The server already knows which section is open,
so expanding one is a page the browser asks for rather than a class a script
toggles: it is a list of links, the open section a real nested `<ul>` inside its
section's `<li>`. On a narrow screen the column moves above the page and wraps
instead of becoming a sliver.

## Screens

| Route | Purpose |
| --- | --- |
| `/admin/login` | username + password form, with a Forgot password link |
| `/admin/forgot`, `/admin/reset` | ask for a reset link, and set a new password with one |
| `/admin` | dashboard: counts, recent posts, follower count |
| `/admin/posts` | table: title, author, tags, date, status; filters for all/published/draft/trash |
| `/admin/posts/new`, `/admin/posts/:slug` | editor |
| `/admin/pages`, `/admin/pages/new`, `/admin/pages/:slug` | same as posts, without date prefix or tags |
| `/admin/tags`, `/admin/categories` | every term in use with its post and file counts; rename, merge, delete (under Posts in the menu) |
| `/admin/comments` | pending, approved and spam, with approve, spam, delete and reply on every row |
| `/admin/messages` | what the contact form on a page collected: read, mark read, delete |
| `/admin/settings` | Settings > General: site title, tagline, author, base URL, time zone, language, and the avatar |
| `/admin/settings/reading` | what the homepage displays, posts per page, the site menu, the notify server |
| `/admin/settings/permalinks` | the tag and category bases, and the archive redirects the taxonomy screens recorded |
| `/admin/settings/discussion` | comments on or off and the closing window, webmentions sent and received, the Akismet key |
| `/admin/settings/email` | the mail provider, the From line and reply-to, the contact address, the credential and the test message |
| `/admin/settings/federation` | the actor handle and type, and the relays the site subscribes to |
| `/admin/users` | list, set each user's email, which notices go to it and how often, change your own password (single role: admin) |
| `/admin/users/new` | the add form, Users > Add new |
| `/admin/federation` | follower list, recent inbox activity, manual re-deliver |

## Editor

- Fields: title, slug (auto from title until touched), permalink preview, date, tags (comma separated), description, draft checkbox, comments (follow the site settings / open / closed), body. A page also carries **Show in navigation** with its menu order, and **Contact form**, which writes `contact: true` and puts a contact form under the page.
- Body is a plain `<textarea>` enhanced with CodeMirror 6 in markdown mode. A preview tab posts the body to `/admin/preview` and shows rendered HTML in the theme's post template.
- Save writes the file (see doc-1 sync model). The form carries the file hash it was loaded with; a mismatch on save returns the form with a warning and both versions.
- Buttons: Save draft, Publish, Update, Move to trash, View.

## Comments

- `/admin/comments` is three lists — Pending, Approved, Spam — with the count beside each, opening on Pending. The dashboard carries the number waiting and links here. With mail configured it is no longer the only notification: see Notifications below, and the one-click links that do the same four things out of an inbox.
- Every row shows the commenter's name, their website, **their email** (the one place it is ever shown), the rendered comment, the post it is on with links to edit and to view it, and a short form of the salted address hash so a run of submissions from one machine is visible.
- Four actions per row: **Approve**, **Spam**, **Delete**, and **Reply** — a Markdown box that posts an approved comment under the one it answers, signed with the site's `author` setting or the moderator's login.
- Spam is kept rather than deleted, so a mistake can be undone and so a spam checker can be told it was wrong. Marking something spam calls the checker's `reportSpam`; letting something out of the spam list calls `reportHam`. With an Akismet key stored, those are `submit-spam` and `submit-ham`.
- Every action rewrites the comment's file under `content/_data/comments/` and the index inside the same step. The file is the comment (decision-9); this screen only ever moves it. The whole format, the closing rules and the checker seam are in doc-6.

## Messages

- `/admin/messages` is the contact form's inbox: two lists, **Inbox** and **Spam**, with the count beside each, opening on the Inbox. The dashboard carries the number unread and links here.
- Every row shows who wrote, **their email address** (this screen and the Comments screen are the only two that ever show one), the subject, the message as plain text, the page the form was on, when it arrived, and a short form of the salted address hash so a run of submissions from one machine is visible.
- Three actions per row: **Reply**, which is a `mailto:` with `Re:` already on the subject; **Mark read**, which toggles back to Mark unread; and **Delete**, which deletes the file.
- A message is one JSON file under `data/contact/`, written **before** anything is emailed, so a provider that is down costs a notification rather than the message. There is no SQLite index over them: the screen reads the directory to sort it anyway, and a second copy of the truth would only be a second thing to keep true. They are under `data/` rather than `content/` because they carry the sender's address and were never meant to be published.
- A message a spam checker called spam is kept, on the Spam list, and is not emailed on: a false positive on a contact form is somebody's message vanishing, which is worse than a list to glance at. One it said to discard, and one that filled the honeypot, was never stored at all.
- **Without mail.** Submissions are still stored and still listed here. This screen is the notification, exactly as `/admin/comments` was before there was any email.

## Settings

- Settings is six pages, WordPress's own names where the CMS has the same thing: **General** (title, tagline, author, base URL, time zone, language, and the avatar), **Reading** (what the homepage displays, posts per page, the site menu, the notify server), **Permalinks** (the tag and category bases, with the recorded archive redirects listed under them), **Discussion** (comments and the closing window, webmentions sent and received, and the spam checker), **Email** (the provider, the From line, the reply-to, the contact address, the credential and the test message) and **Federation** (the actor handle and type, and the relays). `/admin/settings` is the General page, which is where the Settings heading lands.
- Every page is one form of its own with its own POST, and every one of them rewrites `content/_data/site.json` through the same update (decision-9). A page writes the fields it carries and no others, onto the file as re-read inside the write, so two people saving two different pages at the same moment both land and a key the settings do not model is kept. A page validates its own fields and no others: a refused save comes back on the page it was sent from, with the problems on the fields that have them, having written nothing at all.
- Three things are not fields of any form, and each is its own pair of forms — save and remove — because none can travel in that body and because a rejected one must not lose an edit beside it: the **avatar**, on General; the **Akismet key**, on Discussion; and the **mail credential**, on Email.
- **Spam checking.** The Akismet key lives in `data/akismet.json` at mode `0600` rather than in `site.json`, which is public and in git. Saving one checks it with Akismet's `verify-key` first; the panel then says connected, "does not recognise this key", "could not be reached", or not connected, and shows the last four characters rather than the key. Remove key turns Akismet off. See doc-6.
- **Email.** How the site sends mail is four settings on the Email form — `mailProvider` (`none`, `brevo` or `smtp`), the From name and address, and the reply-to — and one credential below it. The Brevo API key and the SMTP host, port, TLS flag, user and password live in `data/mail.json` at mode `0600`, never in `site.json`. Neither secret is printed back: the panel shows the last four characters of the key and the non-secret half of the SMTP connection, and a blank secret keeps the stored one. **Send test email** takes an address and sends the theme's `test` message through the whole chain, reporting the provider's own answer and its message id on the flash. With no configuration, nothing is sent and every feature that emails still succeeds. See the Email section of the package README.
- **What the homepage displays.** WordPress's own question, and its two answers: **Your latest posts**, the archive at `/`, or a page picked from the site's published pages, which is then served at `/` while its own URL redirects there. A second pick, the **Posts page**, gives the listing a page of its own: that page's URL carries it, under the page's title and words, paginated beneath it, and `/page/N/` at the root redirects there. A posts page with no homepage is refused, as WordPress refuses it, and so is one page picked as both. The two are stored in `site.json` as the slugs `homepage` and `postsPage` — absent altogether for the latest posts — so an Eleventy build of the same directory shows the same front page. A pick whose page is later drafted, trashed or deleted is off the list and the site is back to its latest posts; the setting keeps the slug and the page says which one has gone, because a select that had quietly reset itself would be the screen lying about what is stored. The pages list marks both rows the way WordPress does, **Front Page** and **Posts Page**, and the feeds stay at `/feed/` and its siblings whatever is chosen.
- **The contact address.** `contactEmail`, on the Email page, is where a message from a page's contact form is sent, with reply-to set to whoever wrote it. Empty falls back to the first admin with an email address, by username, so a fresh site with a mail credential takes messages without anybody visiting the field. It is read when a message arrives and is never put on a render context, so it cannot appear in the HTML of the page the form is on however a theme is written.
- **Side effects stay with the field.** Saving General or Federation tells the followers when what it changed is part of the actor's profile; saving Federation reconciles the relay list, sending a `Follow` for a line added and an `Undo` for one removed; saving or removing the avatar tells the followers too. The flash says what was sent.
- The code follows the same seam: `src/admin/settings.ts` is the settings themselves and nothing about a screen, `settings-page.ts` is what every page is made of, `settings-pages.ts` is the list, and each page is its own module beside its own template under `admin/layouts/settings/`.

## Auth

- Accounts live in `data/users.json` (decision-9): id, username, optional email, argon2id hash, created time, written atomically with 0600 permissions. Passwords hashed with argon2id.
- Session id in an `HttpOnly; Secure; SameSite=Lax` cookie, stored in SQLite with expiry.
- CSRF token per session on every mutating form.
- First run: if no users exist, `/admin` shows a setup form that creates the first admin and writes initial settings.

## User email and password recovery

- **The address.** Every user may have an email address, and most will not: a login is a username and a password, and the address only buys password recovery and, later, the notices TASK-55 sends. It is set on the `/admin/users` table — one inline field per row, any row, since there is one role and every user already has every power — on the add form at `/admin/users/new` beside the username, and by `geekity user add <name> --email <address>`. An empty box removes it. It never appears on the public site.
- **Asking.** `/admin/forgot` takes a username *or* an email address and always answers with the same sentence, whether the name matched, did not match, or matched somebody with no address. That is the whole point of the screen: an answer that varied would be a list of which accounts the site has. Requests are rate limited by username and by address exactly as sign-ins are, on a throttle of its own, so a flood of resets for one person cannot lock them out of logging in.
- **The link.** A match with an address gets a message from the theme's `password-reset` template carrying `/admin/reset?token=…` — 256 random bits, hex. Only the token's SHA-256 is stored, in the `password_resets` table beside the sessions, so a copy of `geekity.db` is not a stack of working links. It expires an hour out and works once. The token is never rendered into the page of the browser that asked for it.
- **Setting it.** The reset form holds the new password to the same rules every other door does, then deletes every reset that user had outstanding, signs out every session they had, and sends the theme's `password-changed` confirmation, which carries no link back in. Both screens are unauthenticated and carry the session CSRF token and the admin security headers like every other form.
- **Without mail.** With no provider or credential, `/admin/forgot` offers no form: it says the site cannot send email and points at `geekity user add`, which is how a site with no way in gets a fresh admin from a shell. Saving a credential on the Settings screen turns the form on for the next visitor, with no restart.

## Notifications

- **The switchboard.** Every user's row on `/admin/users` carries one switch per event this version knows about, beside their email address. The registry is `src/notifications/preferences.ts`: adding an event — a new follower, a digest of failed deliveries — is one entry there, and the checkbox, the storage and the "who wants this" query all follow from it. An event a user has said nothing about is at its default, so a notice that ships turned on reaches everybody with an address without anybody visiting this screen; only turning one off is written down, as `notifications` in `data/users.json`. A key naming an event this version does not know is dropped on the way in, so a file written by a newer version leaves no switch nothing can reach.
- **How often.** An event whose registry entry says `batched: true` carries a second control beside its switch: **As they arrive**, **Hourly digest** or **Daily digest**, posted to `/admin/users/notifications/mode`. The two are separate questions — whether, and how often — so a user who wants none of a notice turns it off and a user who wants it once a day is still a recipient. The same two rules apply: `immediately` is the default and is never written down, and a mode this version does not know is dropped on the way in and read as the default. It is stored as `notificationModes` in `data/users.json`, a second map rather than a widening of `notifications`.
- **New comments**, the one event so far. A comment or a webmention entering the moderation queue emails every user with an address who has not turned it off. Not a comment Akismet filed as spam, and not one it said to discard: the notice is about what is waiting for a person. A webmention re-sent by a page somebody edited sends nothing either — only the first storing of one is news. A user on an hourly or a daily digest is deliberately not written to at that moment: doc-6 has what they get instead.
- **The one-click links.** The message carries approve, spam and delete. Each is `/_geekity/moderate?action=…&token=…`, has no session behind it, and lands on a page with a single button; only the button acts. That is not politeness — mail readers and corporate link scanners fetch the URLs in a message as a matter of course, and a link that moderated on being opened would be a mail gateway silently deleting the site's comments. The token is an HMAC-signed claim rather than a stored row, taken with a secret in `data/notification-secret`, so a link in an inbox goes on working across a `geekity rebuild`; it is bound to one action on one comment, lasts a week, and is spent against the `spent_tokens` table the first time it is used. This and the buttons on `/admin/comments` both go through the same `moderateComment`, so the two doors cannot disagree about what an action does or about when the spam checker is told a human disagreed with it.
- **Reply notices** go to commenters rather than to users; doc-6 has them.
- **Contact messages** are not part of this switchboard. They go to one address — the `contactEmail` setting, or the first admin with one — rather than to everybody who wants a notice, because a contact form is a site's inbox rather than an event people subscribe to.
- **Without mail.** Nothing is sent, no signing secret is ever minted, no digest runs, and every path still works. `/admin/comments` is the notification it was before.

## Out of scope for phase one

- Roles beyond admin.
- Media library UI (uploads are copied into `content/uploads` by an upload endpoint used from the editor).
- Revisions. Git on the content directory is the recommended history mechanism.
