# Comments and the contact form

## Comments

A visitor can comment on a post on the page. Comments appear in the same thread
as fediverse replies, not in a separate section.

Each post's comments are a file, `content/_data/comments/{slug}.json`. A slug
that is not plain ASCII is percent-encoded in the file name, so `i-♥-rss` is
`i-%E2%99%A5-rss.json`. Each comment holds these fields:

- its id, source, kind and status
- its author
- the Markdown and the HTML rendered from it
- when it was submitted
- a salted hash of the commenter's IP address
- what it answers

Because comments are files:

- They are in git beside the posts.
- An Eleventy build of the same directory shows them.
- The `comments` table is an index. The server empties it and reads it back
  from the files on every boot.

The commenter's email is not in that file. Everything under `content/` is
published and goes into git, so the email is in `data/comments/{slug}.json`
(mode `0600`), keyed by comment id. On a site upgrading from a version that kept
the email in the comment file, the next boot moves it there. The next boot also
moves an email that someone typed into a comment file by hand.

### Keys

Every comment has one key of 16 lowercase hex digits (decision-51). The key is
used in these places:

- the comment's `id` in its file
- its anchor `#comment-{key}` on the post
- its replies feed `/replies/{key}/`
- its page `/comment/{key}/`, for a comment left through the form

Every URL the site prints uses this key, and no other id format.

| Comment                                         | Its key                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Left through the form                           | 16 random hex digits, created when it is submitted.                                         |
| A webmention                                    | The first 16 hex digits of the SHA-256 of its source URL, a space and the post's permalink. |
| A fediverse reply, like or boost                | The first 16 hex digits of the SHA-256 of its note or activity id.                          |
| Imported, with an identity elsewhere (`origin`) | The key the same comment would get if it arrived here, from its `origin`.                   |
| Imported, with none (a WordPress form comment)  | The first 16 hex digits of the SHA-256 of its old comment URL.                              |

The server refuses a comment file that holds any other id. The error names the
file and the id.

On a site upgrading from 0.29, the next boot re-keys two kinds of old id in
place: UUID ids, and the URL ids that plugin-wordpress 0.2.0 wrote. Each gets
the key of its old id. These follow the change:

- the replies that name them
- the emails in `data/comments/`
- any Markdown that links `/comment/{old}/` or `#comment-{old}`

The old URLs do not redirect. On a site whose ids are all keys, the boot reads
the files and writes nothing.

### Migrated comments

A comment imported from another system carries `migrated: true`. If it had an
identity elsewhere, it also carries `origin`:

- a fediverse reply's note id
- a like's or a boost's activity id
- a webmention's source URL

A migrated fediverse comment also carries `actor`, the id of the actor who wrote
it, when the export named one. plugin-wordpress writes all three.

A migrated comment shows on its post, in its thread and on its own page like any
other comment, and replies to it thread under it. It is in no feed, and in no
count that a feed advertises:

- not `/comments/feed/`
- not `{permalink}feed/`
- not `/replies/{key}/`
- not `source:comments`

Why: it was published before the site moved here. A subscriber to the old
comments feed sees nothing new at cutover.

A native reply under a migrated comment is new, so it appears in the feeds. It
names the migrated comment in `source:inReplyTo` by its guid. The guid is the
`/comment/{key}/` page for an imported form comment, otherwise its `origin`,
otherwise its `url`.

If the same comment arrives again, the site keeps the stored one, with the
moderator's decision on it. The server matches arrivals as follows:

- A resent webmention matches by its source.
- A redelivered `Create` or `Like`, and a note that the
  [reply backfill](federation.md#replies-to-fediverse-replies) reads, match by
  note or activity id against the stored comment's `origin`. The inbox line is
  not shown, and the backfill does not log the note.
- A like or a boost from the same actor as an imported one is the same
  reaction. The server matches the inbox line's actor against the stored
  comment's `actor`.

An answer to an imported fediverse note threads under the imported comment. The
backfill reads that note's `replies` collection by its `origin`.

Three settings and one front-matter key decide whether a post still accepts
comments. The server reads them in one place, so the form and the endpoint
always agree.

| Where                                      | What it says                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `comments` in `site.json`                  | Whether the site takes comments at all. On by default; off is off everywhere.      |
| `commentsCloseAfterDays` in `site.json`    | Days after a post's `date` that it closes. `14` by default; `0` never closes.      |
| `comments: true` / `false` in front matter | The post's own answer, which beats both, in both directions. The editor offers it. |
| The document's type                        | A page is closed unless it says otherwise.                                         |

These settings do not affect the fediverse. A reply, a like or a boost arrives
because a remote server sent it, and a closed post shows all of them.

The server holds a comment for a moderator unless the same **name and email**
had a comment approved before. WordPress uses the same rule. Before that check,
a submission must pass three defences:

- a honeypot field
- a minimum time between rendering the form and submitting it
- a per-address rate limit

Comments render from Markdown with raw HTML off, images not embedded and every
link marked `rel="nofollow ugc"`.

A site can pass every submission to a service:

```ts
export default defineConfig({
  commentChecker: {
    async check(submission) {
      // submission carries the comment, the post's URL, and the commenter's
      // address, user agent and referrer, which is everything Akismet asks for.
      return 'spam' | 'discard' | 'ham' | 'unknown';
    },
    async reportSpam(report) {}, // a moderator marked a comment as spam
    async reportHam(report) {}, // a moderator moved a comment out of spam
  },
});
```

If a checker throws, the server logs the error and treats it as no opinion. A
service that is down never stops a site from taking comments.
`/admin/comments` is the moderation queue. The dashboard shows how many
comments are waiting.

### A comment's own page

A comment left through the form has its own page at `/comment/{key}/` (see
[Keys](#keys)). That page is the comment's URL in the thread and in both
comments feeds. A site that replies to the comment fetches the comment, not the
whole post. The `#comment-{key}` anchor on the post stays, so an old link still
scrolls to the comment. A webmention or a fediverse reply has no such page. Its
URL is the page it came from.

The page layout:

- The comment is the page's one `h-entry`. Its `u-in-reply-to` is the post or
  the comment it answers.
- Above it is the thread from the post down. Each step is a nested
  `u-in-reply-to h-cite`.
- Below it are the replies to it, at every depth.

If a visitor may not see an ancestor, the page shows a placeholder that says the
comment is no longer shown. The thread on the post shows the same placeholder
above an approved reply to a pending, spam or deleted comment.

The page answers only for an approved comment, and only when the post would:

- 410 once the post is deleted.
- 404 while the post is not public or is not showing its conversation.

The page is `noindex`. It is absent from the sitemap, the post feeds and
search. Backlog doc-6 has the rules.

### Replying while signed in

A comment is something a visitor says on the site. A post is something a
signed-in user says. So when a signed-in user replies, in the thread or in the
Reply box on the moderation screen, the reply is a reply post, not a comment. It
is one file under `posts/`, saved the same way the editor and Micropub save
posts. The thread shows it inline under what it answers. Its `in-reply-to` is
what it answers:

| Answering          | `in-reply-to`                     | It also                                                  |
| ------------------ | --------------------------------- | -------------------------------------------------------- |
| The post           | The post's permalink              |                                                          |
| A native comment   | The comment's `/comment/{key}/`   | Emails the commenter once, if they asked about replies.  |
| A webmention reply | The page the webmention came from | Sends that page a webmention.                            |
| A fediverse reply  | The note's id                     | Federates in reply to the note, addressed to its author. |
| A reply post       | The reply post's permalink        |                                                          |

The signed-in form and the moderation screen's Reply box have an "Include in
posts and feeds" checkbox. It is unchecked by default.

- Unchecked, the reply post is [unlisted](content.md#unlisted-posts). It has
  its own page and appears in the thread, but in no listing or post feed.
- Checked, it is public.

Either way, it reaches the comment or reply it answers. A visitor's form has no
such checkbox.

A signed-in user gets a Reply link on every reply in a thread, including
webmentions and fediverse replies. A visitor gets one on native comments only. A
visitor's reply is always a native comment, so a visitor's answer to a fediverse
reply sends nothing over ActivityPub.

A reply post written in the editor or over Micropub joins a thread the same way,
when its `in-reply-to` names the post or anything in its thread:

- a comment's page or `#comment-` anchor
- a webmention's page
- a note's id

Its reply context quotes that comment from the site's own records, not from the
page it is on, and says "In reply to a comment by" and the comment's author. A
reply post that answers one of the site's own posts or pages takes that post's
title, words and author from the index too. The site never fetches its own
page.

For a reply post from any of these sources, the server emails the commenter
once. It sends the email when the reply post is first published. It does not
send it again when the reply post is edited, trashed and restored, or when the
site restarts.

In the thread, a reply post's author link has no `rel="nofollow ugc"`. That
attribute is for visitors, webmentions and the fediverse. A webmention or a
fediverse reply to a reply post also threads under it in the original thread.
Comments written before this feature stay comments. Backlog doc-6 and
decision-47 have the rules.

### Being told about one

With mail configured, a comment or a webmention entering the queue sends an
email to every user who has an address and has not turned the notice off on
their `/admin/users/<id>` screen. The message holds the comment, the post it is
on, and approve, spam and delete links that work without a login. The server
sends nothing about a comment that Akismet filed as spam or told the site to
discard. It sends only about comments that wait for a person.

Each link opens a small page with a button. Only the button acts.

Why: mail readers, spam filters and corporate link scanners fetch the URLs in a
message automatically. If opening a link moderated a comment, a mail gateway
could delete this site's comments without anyone knowing.

Each link:

- is signed, not stored
- is bound to one action on one comment
- lasts a week
- is spent the first time it is used

The signing secret is `data/notification-secret`, so a link keeps working
across a `geekity rebuild`.

Commenters get reply notices. The form offers "email me when somebody replies
to this", but only on a site that can send mail. Ticking it stores
`notify: true` beside the commenter's address in `data/comments/{slug}.json`.
The site never renders the address or the flag: not on the page, not in the
JSON or Markdown representations, and not in the comments feeds.

When a reply to that comment is **approved**, the server sends one message with
the reply in it and an unsubscribe link at the bottom. Unsubscribing applies to
the whole site, by address. The address goes into `data/comment-optouts.json`,
and the site never emails it about replies again. The comments are not changed.

### One message an hour instead of one a comment

Beside each switch on a user's `/admin/users/<id>` screen is a frequency
setting for that notice:

- as they arrive
- an hourly digest
- a daily digest

The setting is per user. It starts at "as they arrive", so nothing changes for a
user who does not touch it.

On a digest, a comment entering the queue sends nothing. Instead, after each
window, the server sends one message that lists every item **still waiting**.
Each item has its own approve, spam and delete links. The server builds a digest
from the queue as it is at that moment, not from a list of events. An item
that someone moderated in the meantime is not in it, and no separate queue has
to survive a restart.

A user with nothing waiting gets no message. Their window starts only when
something is waiting. Each frequency sends at most one message per window, and
a quiet site sends none.

A digest lists up to a hundred items. A longer queue, such as a spam wave that
Akismet let through, ends with a line that counts the rest and points to
`/admin/comments`.

The server records only when each user last got a digest, in
`data/notification-digests.json`.

- It is a file, not a database row, because decision-9 lets a site delete the
  database whenever the site is stopped. A lost timestamp would skip a window
  or send a digest twice.
- It is a separate file, not a field in `data/users.json`, because that file
  records who may sign in. A timestamp rewritten every hour is bookkeeping, not
  data about the user.

Digests do not affect reply notices to commenters. Each reply notice is one
message about one reply, sent when the reply is approved.

With no mail configured, none of this runs and nothing breaks:

- The form does not offer the reply checkbox.
- The server sends no notices.
- No digest runs.
- The moderation screen is the only notification, as before.

Notices are per user and keyed by event name. To add one, such as a new
follower or a digest of failed deliveries, add one entry to the registry in
`src/site/notification-preferences.ts`. Its checkbox appears on the users screen
automatically. An entry with `batched: true` also gets the frequency select. An
event a user has not set is at its default, so turning one on for a site needs
no visit to the users screen.

### Akismet

Akismet is the one checker the package ships. It is off until a site has a key.
The key is a credential, not a setting. It is in `data/akismet.json` at mode
`0600`, beside the password hashes and the users' private keys. It is never in
`content/_data/site.json`, which is public, in git and published with the site.

To connect Akismet, paste the key into **Spam checking** on
`/admin/settings/discussion`. The server checks the key with Akismet's
`verify-key` before it stores it. The panel then shows one of these:

- Connected
- "Akismet does not recognise this key"
- "Akismet could not be reached"
- Not connected

The panel never shows the key. It shows the last four characters, so you can
tell which key is stored. The **Remove key** button turns Akismet off.

The server reads the file on every call. A key saved on that screen filters the
next comment, and a removed key stops filtering at once. Neither needs a
restart.

A `commentChecker` in the config always takes precedence. The server builds the
Akismet checker only when the config names none.

Every comment and every incoming webmention that passes the honeypot, the
form's age and the rate limit goes to `comment-check` with these fields:
`blog`, `user_ip`, `user_agent`, `referrer`, `permalink`, `comment_type`
(`comment` or `webmention`), `comment_author`, `comment_author_email`,
`comment_author_url`, `comment_content`, `comment_date_gmt`, `blog_lang`,
`blog_charset` and, for a form submission, `honeypot_field_name`. The server
never sends fediverse replies to Akismet. They never reach the checker.

| Akismet says                              | What happens                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `true`                                    | Filed as spam, where a moderator can still see it and change the decision.                     |
| `true` with `X-akismet-pro-tip: discard`  | Dropped without a queue entry.                                                                 |
| `false`                                   | The site's own rules decide: approved for a name and email approved before, pending otherwise. |
| `invalid`, a non-200, a timeout, no route | The same as `false`, and the failure is logged with whatever Akismet said was wrong.           |

The server does not treat `false` as approval. Akismet cannot cause a lost
comment. Every failure counts as no opinion, no opinion sends the comment to the
queue, and the server abandons a call after ten seconds.

When a moderator marks a comment as spam or not spam on `/admin/comments`, the
server posts `submit-spam` or `submit-ham` with the same fields, minus
`user_ip`, `user_agent` and `referrer`. A stored comment keeps only a salted
hash of the IP address.

## The contact form

A page with `contact: true` in its front matter renders a contact form under its
content, with fields for name, email, subject and message. The pages editor
offers it as a **Contact form** checkbox. The key works wherever it is written,
so a theme that includes `partials/contact-form.njk` in its post layout gets a
form there too.

The form has no script and works with JavaScript off. It posts to
`/_geekity/contact`. When the server stores a message, it redirects back to the
page with `?contact=sent`, which shows a thank-you in place of the form. A
refresh does not send the message twice.

**The destination address never appears in the HTML.** The server reads the
contact address when a submission arrives. The address is not in any render
context, so no theme can print it and no form carries it.

### Where a message goes

| Where                               | What                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `data/contact/<id>.json`, mode 0600 | Every message, written **before** anything is emailed.                      |
| The `contactEmail` setting          | Where the `contact-message` email is sent, reply-to the sender.             |
| `/admin/messages`                   | The inbox: read, mark read, delete. The dashboard carries the unread count. |

`contactEmail` is on the Settings screen under Email. If it is empty, the server
uses the first admin with an email address, sorted by username. A new site with
a mail credential takes messages with no change to the field.

The server writes the file first and sends the mail after the redirect. If the
provider is down, the key has expired or the address bounces, only the
notification is lost, not the message. **With no mail configured at all, the
server still stores submissions and shows them on the Messages screen**. That
screen is the notification, as `/admin/comments` was before the site sent email.

Messages are under `data/`, not `content/`, because they hold the sender's
address and are not for publication. No SQLite index covers them. The screen
reads the directory to sort it anyway, and an index would be a second copy to
keep in sync. Each message is one JSON file, named by an id that begins with the
instant it arrived, so `ls` lists the inbox in order. Deleting a message on the
screen deletes its file.

### What is in a message file

```json
{
  "id": "20260920T120000000Z-1a2b3c4d",
  "received": "2026-09-20T12:00:00.000Z",
  "status": "received",
  "read": false,
  "page": { "slug": "contact", "permalink": "/contact/", "title": "Say hello" },
  "from": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "subject": "About the analytical engine",
  "message": "It is a lovely machine. Please write back.",
  "addressHash": "9f2c…"
}
```

`addressHash` is the same salted hash a comment keeps, with the salt in
`data/comment-salt`. A run of submissions from one machine is visible across
comments and messages, and the visitor's IP address is never stored.

### The defences in front of it

A message passes the same four defences as a comment, from the same modules, so
the two public forms always follow the same rules.

| Defence             | What it refuses                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The honeypot        | A hidden field a person never fills in. A submission that filled it gets the thank-you and is dropped in silence. |
| The form's age      | Submitted under three seconds after the page loaded, or from a form rendered more than a day ago.                 |
| The rate limit      | Five messages per address per ten minutes, on the same limiter the login form uses. The sixth is a 429.           |
| The comment checker | The `commentChecker` seam, told `comment_type: contact-form`. With an Akismet key stored, that is Akismet.        |

A checker's `discard` stores nothing. Its `spam` **stores the message** on the
Spam list of the Messages screen, and sends no email. Why: a false positive on
a contact form loses someone's message, which is worse than a spam list to
check. If a checker is down or throws, the server treats it as no opinion and
stores the message as it would with no checker.
