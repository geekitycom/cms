# Comments and the contact form

## Comments

A reader can answer a post on the page, and what they leave joins the same
thread as the fediverse replies rather than sitting in a section of its own.

A comment is a file. `content/_data/comments/{slug}.json` holds one post's
comments (a slug that is not plain ASCII is percent-encoded in the name, so
`i-♥-rss` is `i-%E2%99%A5-rss.json`) — id, source, kind, status, author, the Markdown and the HTML it
rendered to, when it was submitted, a salted hash of the address, and what it
answers — so they are in git beside the posts, an Eleventy build of the same
directory shows them, and the `comments` table is an index emptied and read
back on every boot. The commenter's email is not in that file: it is in
`data/comments/{slug}.json` (mode `0600`), keyed by comment id, because
everything under `content/` is published and goes into git. A site upgrading
from a version that kept the email in the comment file has it moved there on
the next boot, and so does an email somebody types into a comment file by
hand.

### Keys

Every comment has one key, 16 lowercase hex digits (decision-51). It is the
comment's `id` in its file, its anchor `#comment-{key}` on the post, its
replies feed `/replies/{key}/` and, for a comment left through the form, its
page `/comment/{key}/`. No URL the site prints carries an id of any other shape.

| Comment                                         | Its key                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Left through the form                           | 16 random hex digits, minted when it is submitted.                                          |
| A webmention                                    | The first 16 hex digits of the SHA-256 of its source URL, a space and the post's permalink. |
| A fediverse reply, like or boost                | The first 16 hex digits of the SHA-256 of its note or activity id.                          |
| Imported, with an identity elsewhere (`origin`) | The key the same comment would get arriving here, from its `origin`.                        |
| Imported, with none (a WordPress form comment)  | The first 16 hex digits of the SHA-256 of its old comment URL.                              |

A comment file holding any other id is refused, naming the file and the id. A
site upgrading from 0.29 has its UUID ids, and the URL ids plugin-wordpress
0.2.0 wrote, re-keyed in place on the next boot to the key of the old id; the
replies naming them, the emails in `data/comments/` and any Markdown linking
`/comment/{old}/` or `#comment-{old}` follow. Nothing redirects from the old
URLs. A site whose ids are all keys reads its files and writes nothing.

### Migrated comments

A comment imported from another system carries `migrated: true`, and `origin`
when it had an identity elsewhere: a fediverse reply's note id, a like's or a
boost's activity id, a webmention's source URL. A migrated fediverse comment
also carries `actor`, the id of the actor who wrote it, when the export named
one. plugin-wordpress writes all three.

A migrated comment shows on its post, in its thread and on its own page like
any other, and replies to it thread under it. It is in no feed and no count a
feed advertises: not `/comments/feed/`, not `{permalink}feed/`, not
`/replies/{key}/` and not `source:comments`. It was published before the site
moved here, so a reader of the old comments feed sees nothing new at cutover. A
native reply under it is news, and names it in `source:inReplyTo` by its guid:
its `/comment/{key}/` page for an imported form comment, its `origin`
otherwise, else its `url`.

The same comment arriving again is the one the site holds, and the stored one
wins, with the moderator's decision on it. A resent webmention is matched by
its source. A redelivered `Create` or `Like`, and a note the
[reply backfill](federation.md#replies-to-fediverse-replies) reads, are matched by their
note or activity id against the stored comment's `origin`, so the inbox line is
not shown and the backfill does not log the note. A like or a boost from the
same actor as an imported one, matched by the inbox line's actor against the
stored comment's `actor`, is the same reaction.
An answer to an imported fediverse note threads under the imported comment,
and the backfill reads that note's `replies` collection by its `origin`.

Three settings and one front-matter key decide whether a post is still taking
them, and they are read in one place so the form and the endpoint can never
disagree:

| Where                                      | What it says                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `comments` in `site.json`                  | Whether the site takes comments at all. On by default; off is off everywhere.      |
| `commentsCloseAfterDays` in `site.json`    | Days after a post's `date` that it closes. `14` by default; `0` never closes.      |
| `comments: true` / `false` in front matter | The post's own answer, which beats both, in both directions. The editor offers it. |
| The document's type                        | A page is closed unless it says otherwise.                                         |

None of it touches the fediverse: a reply, a like or a boost arrives because a
remote server sent it, and a closed post shows every one of them.

A comment is held for a moderator unless the same **name and email** have had
one approved before — WordPress's rule. In front of that are a honeypot field,
a minimum time between the form being rendered and submitted, and a per-address
rate limit. Comments are rendered from Markdown with raw HTML off, images
unembedded and every link marked `rel="nofollow ugc"`.

A site can hand the whole thing to a service:

```ts
export default defineConfig({
  commentChecker: {
    async check(submission) {
      // submission carries the comment, the post's URL, and the commenter's
      // address, user agent and referrer — everything Akismet asks for.
      return 'spam' | 'discard' | 'ham' | 'unknown';
    },
    async reportSpam(report) {}, // a moderator filed something as spam
    async reportHam(report) {}, // …or let something out of the spam list
  },
});
```

A checker that throws is treated as having no opinion and logged, so a service
that is down never stops a site taking comments. `/admin/comments` is the
moderation queue and the dashboard carries the number waiting.

### A comment's own page

A comment left through the form has a page of its own at `/comment/{key}/`
(see [Keys](#keys)). That page is the comment's URL in the thread
and in both comments feeds, so a site that replies to the comment fetches the
comment rather than the whole post. The `#comment-{key}` anchor on the post
stays, so an old link still scrolls to it. A webmention or a fediverse reply
has no such page: its URL is where it came from.

The page holds the comment as its one `h-entry`, with `u-in-reply-to` the post
or the comment it answers. Above it is the thread from the post down, each step
a nested `u-in-reply-to h-cite`, and below it the replies to it at every depth.
An ancestor a reader may not see is a placeholder saying the comment is no
longer shown, and the thread on the post prints the same placeholder above an
approved reply to a pending, spam or deleted comment. The page answers only an approved comment, and only as the post
would: 410 once the post is deleted, 404 while the post is not public or not
showing its conversation. It is `noindex` and absent from the sitemap, the post
feeds and search. Backlog doc-6 has the rules.

### Replying while signed in

A comment is something somebody else says on the site. A post is something a
signed-in user says. So a reply written by somebody signed in to the site, in
the thread or in the Reply box on the moderation screen, is a reply post, not a
comment. It is one file under `posts/`, saved
the way the editor and Micropub save one, and the thread shows it inline under
what it answers. Its `in-reply-to` is what it answers:

| Answering          | `in-reply-to`                     | It also                                                  |
| ------------------ | --------------------------------- | -------------------------------------------------------- |
| The post           | The post's permalink              |                                                          |
| A native comment   | The comment's `/comment/{key}/`   | Emails the commenter once, if they asked about replies.  |
| A webmention reply | The page the webmention came from | Sends that page a webmention.                            |
| A fediverse reply  | The note's id                     | Federates in reply to the note, addressed to its author. |
| A reply post       | The reply post's permalink        |                                                          |

The signed-in form and the moderation screen's Reply box have an "Include in
posts and feeds" checkbox, unchecked by default. Unchecked, the reply post is [unlisted](content.md#unlisted-posts): its own page
and the thread, but no listing or post feed. Checked, it is public. It reaches
whoever it answers either way. A visitor's form has no such box.

Somebody signed in gets a Reply link on every reply in a thread, webmentions
and fediverse replies included. A visitor gets one on native comments only. A
visitor's reply is always a native comment, so a visitor answering a fediverse
reply sends nothing over ActivityPub.

A reply post written in the editor or over Micropub joins a thread the same way
when its `in-reply-to` names the post or anything in its thread: a comment's
page or `#comment-` anchor, a webmention's page, a note's id. Its reply context
quotes that comment from the site's own records instead of the page it is on,
and says "In reply to a comment by" its writer. A reply post answering one of
the site's own posts or pages takes that post's title, words and author from
the index too, so the site never fetches its own page. The commenter's email
goes once for a reply post from any of these doors, sent when the reply post is
first published and never again when it is edited, trashed and restored, or the
site restarts. In the thread, a reply post's author link carries no
`rel="nofollow ugc"`, which is kept for visitors, webmentions and the
fediverse. A
webmention or a fediverse reply to a reply post threads under it in the
original thread too. Comments written before this stay comments. Backlog doc-6
and decision-47 have the rules.

### Being told about one

With mail configured, a comment or a webmention entering the queue emails every
user who has an address and has not switched the notice off on their
`/admin/users/<id>` screen. The message carries the comment, the post it is on,
and three links — approve, spam, delete — that work without a login. Nothing is
sent about a comment Akismet filed as spam or told the site to discard: only
what is actually waiting for a person.

Each link lands on a small page with a button on it, and only the button acts.
That is not politeness. Mail readers, spam filters and corporate link scanners
fetch the URLs in a message as a matter of course, and a link that moderated on
being opened would mean a mail gateway silently deleting this site's comments.
A link is signed rather than stored — the secret is `data/notification-secret`,
so a link goes on working across a `geekity rebuild` — is bound to one action
on one comment, lasts a week, and is spent the first time it is used.

Commenters get the other half. The form offers "email me when somebody replies
to this", but only on a site that can actually send mail; ticking it stores
`notify: true` beside the commenter's address in `data/comments/{slug}.json`, and
nothing about either is ever rendered — not on the page, not in the JSON or
Markdown representations, and not in the comments feeds. When a reply to that
comment is **approved**, one message goes out with the reply in it and an
unsubscribe link at the bottom. Unsubscribing is site-wide by address: the
address goes into `data/comment-optouts.json` and this site writes to it about
replies again. The comments themselves are untouched.

### One message an hour instead of one a comment

Beside each switch on a user's `/admin/users/<id>` screen is how often that
notice should arrive: as they arrive, an hourly digest, or a daily one. It is
per user, and it starts as "as they arrive", so nothing changes for anybody who
does not touch it.

On a digest, a comment entering the queue sends nothing at all. Instead, once a
window has passed, one message goes out listing everything **still waiting**,
each item with its own approve, spam and delete links. A digest is built from
the queue as it stands rather than from a list of things that happened, so an
item somebody moderated in the meantime is simply not in it, and there is no
queue to keep true across a restart. A user with nothing waiting is not written
to at all, and their window does not start until something is: the promise a
mode makes is at most one message per window, and a quiet site sends none.

A very long queue — a spam wave Akismet let through — is listed up to a hundred
items, with the rest counted in a line pointing at `/admin/comments`.

The only thing written down is when each user last had one, in
`data/notification-digests.json`. It is a file rather than a row because
decision-9 lets a site delete the database whenever it is stopped, and a
forgotten timestamp would mean either a window silently skipped or a digest
sent twice. It is its own file rather than a field in `data/users.json` because
that file answers "who may sign in", and a timestamp rewritten every hour is
bookkeeping rather than anything about the person.

Reply notices to commenters are not affected: those are one message about one
reply, and they go when the reply is approved.

With no mail configured, none of this happens and nothing breaks: the box is
not offered, no notice is sent, no digest runs, and the moderation screen is
the notification it was before.

Notices are per user and keyed by event name, so a later one — a new follower,
a digest of failed deliveries — is one entry in the registry in
`src/notifications/preferences.ts` and a checkbox that appears by itself; an
entry that says `batched: true` gets the how-often select beside it too. An
event a user has said nothing about is at its default, which is why turning one
on for a site does not need anybody to visit the users screen.

### Akismet

The one checker the package ships. It is off until a site has a key, and the
key is a credential rather than a setting: it lives in `data/akismet.json` at
mode `0600` beside the password hashes and the users' private keys, never in
`content/_data/site.json`, which is public, in git and published with the site.

Paste it into **Spam checking** on `/admin/settings/discussion`. It is checked with
Akismet's `verify-key` before it is stored, and the panel then reads Connected,
"Akismet does not recognise this key", "Akismet could not be reached", or Not
connected. The key is never printed back — the last four characters are, so it
is possible to tell which key is in there. A **Remove key** button turns Akismet
off again.

The file is read on every call, so a key saved on that screen filters the next
comment and a removed one stops filtering at once. Neither needs a restart.

A `commentChecker` in the config wins outright: the Akismet checker is built
only when the site named none.

Every comment and every incoming webmention that gets past the honeypot, the
form's age and the rate limit goes to `comment-check` with `blog`, `user_ip`,
`user_agent`, `referrer`, `permalink`, `comment_type` (`comment` or
`webmention`), `comment_author`, `comment_author_email`, `comment_author_url`,
`comment_content`, `comment_date_gmt`, `blog_lang`, `blog_charset` and, for a
form submission, `honeypot_field_name`. Fediverse replies are never sent: they
do not reach the checker seam at all.

| Akismet says                              | What happens                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `true`                                    | Filed as spam, where a moderator can still see it and change its mind.                         |
| `true` with `X-akismet-pro-tip: discard`  | Dropped without a queue entry.                                                                 |
| `false`                                   | The site's own rules decide: approved for a name and email approved before, pending otherwise. |
| `invalid`, a non-200, a timeout, no route | The same as `false`, and the failure is logged with whatever Akismet said was wrong.           |

`false` is deliberately not a positive opinion. Nothing Akismet does can lose a
comment: every failure is no opinion, no opinion is the queue, and a call is
abandoned after ten seconds.

Marking something spam or not spam on `/admin/comments` posts `submit-spam` or
`submit-ham` with the same fields, minus `user_ip`, `user_agent` and `referrer`
— a stored comment keeps a salted hash of the address and nothing else.

## The contact form

A page carrying `contact: true` in its front matter renders a contact form
under its content — name, email, subject, message. The editor offers it as a
**Contact form** checkbox on the pages editor, and the key is honoured wherever
it is written, so a theme that includes `partials/contact-form.njk` in its post
layout gets one there too.

It works with JavaScript switched off, and there is no script on it. The form
posts to `/_geekity/contact`, and a message that is stored redirects back to
the page with `?contact=sent`, which draws a thank-you where the form was — so
a refresh sends nothing twice.

**Where the message goes never appears in the HTML.** The contact address is
read when a submission arrives; it is not on any render context, so no theme
can print it and no form carries it.

### Where a message goes

| Where                               | What                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `data/contact/<id>.json`, mode 0600 | Every message, written **before** anything is emailed.                      |
| The `contactEmail` setting          | Where the `contact-message` email is sent, reply-to the sender.             |
| `/admin/messages`                   | The inbox: read, mark read, delete. The dashboard carries the unread count. |

`contactEmail` is on the Settings screen under Email. Empty falls back to the
first admin with an email address, by username, so a fresh site with a mail
credential takes messages without anybody visiting the field.

The file is written first and the mail goes out behind the redirect, which is
the whole point of the design: a provider that is down, a key that has expired
or an address that bounces costs a notification rather than the message. **With
no mail configured at all, submissions are still stored and still shown on the
Messages screen** — it is the notification, exactly as `/admin/comments` was
before there was any email.

Messages live under `data/` rather than `content/` because they carry the
sender's address and were never meant to be published, and there is no SQLite
index over them: the screen reads the directory to sort it anyway, and a second
copy of the truth would only be a second thing to keep true. One JSON file per
message, named by an id that begins with the instant it arrived, so `ls` is the
inbox in order. Deleting a message on the screen deletes its file.

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

`addressHash` is the same salted hash a comment keeps — the salt is
`data/comment-salt` — so a run of submissions from one machine is visible
across both without a reader's address being written down.

### The defences in front of it

The same four a comment goes through, out of the same modules, so the two
public forms cannot drift into different rules:

| Defence             | What it refuses                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The honeypot        | A hidden field a person never fills in. A submission that filled it gets the thank-you and is dropped in silence. |
| The form's age      | Submitted under three seconds after the page loaded, or from a form rendered more than a day ago.                 |
| The rate limit      | Five messages per address per ten minutes, on the same limiter the login form uses. The sixth is a 429.           |
| The comment checker | The `commentChecker` seam, told `comment_type: contact-form`. With an Akismet key stored, that is Akismet.        |

A checker's `discard` stores nothing at all. Its `spam` **stores the message**,
on the Spam list of the Messages screen, and does not email it: a false
positive on a contact form is somebody's message vanishing, which is a worse
failure than a spam list to glance at. A checker that is down or throwing is no
opinion, and the message is stored as it would have been before anybody had
one.
