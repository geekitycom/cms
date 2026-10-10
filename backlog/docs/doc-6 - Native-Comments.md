---
id: doc-6
title: Native Comments
type: specification
created_date: '2026-09-04 22:29'
updated_date: '2026-10-10 18:57'
---
# Native comments

WordPress lets a reader answer a post on the page. This CMS does too, and what
they leave joins the same thread as the fediverse replies, the likes and the
boosts (doc-4, "The conversation on the page"): every entry says its `source`,
and a theme that prints one prints them all.

Per decision-9, a comment is a **file**. Nothing else holds it and no other
server can be asked for it again, so `content/_data/comments/` is the source of
truth and the `comments` table is an index of it, emptied and read back on
every boot and by `geekity rebuild`.

## The files

One JSON file per post, named after the post's slug:

```
content/_data/comments/{slug}.json
```

A post keeps its slug for its whole life — the editor gives an existing
document the slug it already has — so the file that holds a post's comments
never has to move. The whole directory is in git beside the posts, and an
Eleventy build of the same content directory reads it.

```json
{
  "post": "/2026/09/hello-world/",
  "comments": [
    {
      "id": "0199e5f4-...-a1b2",
      "source": "comment",
      "kind": "reply",
      "status": "approved",
      "author": {
        "name": "Ada Lovelace",
        "url": "https://ada.example/",
        "avatar": null
      },
      "content": {
        "markdown": "Good post.",
        "html": "<p>Good post.</p>\n"
      },
      "submitted": "2026-09-20T10:00:00.000Z",
      "addressHash": "0123456789abcdef0123456789abcdef",
      "inReplyTo": null,
      "url": null
    }
  ]
}
```

`post` is the permalink, so a file read on its own knows where its comments
belong. `comments` is the list, oldest first.

| Key           | What it holds                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `id`          | Its name, unique across the site, and what a reply puts in `inReplyTo`. A UUID.                   |
| `source`      | `comment` (the form) or `webmention` (doc-7). More may follow; an unknown one reads as `comment`.  |
| `kind`        | `reply`, `like`, `boost`, `repost` or `mention` — the five a conversation knows. A form only ever makes a `reply`. |
| `status`      | `pending`, `approved` or `spam`. Only `approved` reaches a reader.                                 |
| `author.name` | What the page shows.                                                                              |
| `author.url`  | Their website, or `null`. Marked `nofollow ugc` like every link in a comment.                     |
| `author.email`| **Not in this file** (TASK-182). It lives in `data/comments/{slug}.json`; see "The email, in `data/`" below. For the moderator, the auto-approval rule, reply notices and the spam checker. |
| `author.avatar`| Their face, or `null`. Only a webmention has one; a form asks nobody for a picture.               |
| `content.markdown` | What was typed, which is the thing a person wrote.                                           |
| `content.html`| That Markdown through the restricted profile below.                                               |
| `submitted`   | An ISO 8601 instant (decision-11: a UTC instant, always).                                         |
| `addressHash` | A salted SHA-256 of the address it came from, truncated, or `null`.                               |
| `inReplyTo`   | The comment it answers, or `null` for one answering the post.                                     |
| `url`         | Where it lives when it lives somewhere else: a webmention's source page, `null` for one written here. |
| `notify`      | **Not in this file** either: it sits beside the email in `data/comments/{slug}.json`. Whether the commenter asked to be told when somebody answers them, only ever `true` alongside an email; a comment with no entry there asked for nothing. |
| `redacted`    | What was removed from it for privacy (TASK-135): any of `email`, `addressHash` and `author`. Absent when nothing was. An author whose email was removed does not count toward auto-approval. |
| `via`         | The page whose entry carried it, for a webmention reply read out of another webmention's source (a salmention, TASK-320). Absent for every other comment. |

The shape is deliberately wider than a form submission, because a webmention
lands in the same file: it has a page of its own and no email, it may be a like
or a mention rather than a reply, and it should thread with everything else
rather than needing a store of its own. doc-7 is that half. A webmention entry
looks like this, and every rule below applies to it unchanged:

```json
{
  "id": "0199e5f4-...-c3d4",
  "source": "webmention",
  "kind": "mention",
  "status": "pending",
  "author": {
    "name": "Grace Hopper",
    "url": "https://grace.example/",
    "avatar": "https://grace.example/me.jpg"
  },
  "content": {
    "markdown": "Somebody else wrote about this",
    "html": "<p>Somebody else wrote about this</p>"
  },
  "submitted": "2026-09-21T09:00:00.000Z",
  "addressHash": "0123456789abcdef0123456789abcdef",
  "inReplyTo": null,
  "url": "https://grace.example/2026/09/about-that/"
}
```

`url` is its **identity** as well as its address: a page that sends its
webmention again updates the entry it made rather than adding a second, and one
whose link has gone deletes it. `content.markdown` for a webmention is the
source's own words as text rather than Markdown somebody typed — there is no
Markdown to keep — and a like or a repost carries neither, because a page's
title is not something its author said about this post. `addressHash` is the
hash of the address the webmention was *sent from*, hashed exactly as a
commenter's is.

### Where a received reply goes (TASK-319)

A webmention's `inReplyTo` comes from its source's `u-in-reply-to`. Each URL
the entry answers is offered to the conversation's `replyNamed`, and the first
that names a reply on the target post is the parent:

- a comment's own page, `/comment/{id}/`, its id percent-decoded;
- the post's anchor for a comment, `{permalink}#comment-{id}`;
- an earlier webmention, by the page it was sent from (its `url`);
- a fediverse reply on the post, by its `url` or its `id`.

A source that names none of them, names only the post, or names a comment on a
different post stays at the top, `inReplyTo: null`, as before. One that does
answer a reply on this post is stored as a `reply` even when it never names the
post itself. Every stored comment on the post is a candidate whatever its
status, because what a reply answers is a fact about it: whether a reader may
see the comment it answers is decided when the thread is read. A source that is
edited and sent again is matched by its `url` as always, and its `inReplyTo` is
rewritten with the rest, so it moves to whatever it answers now. Its own `url`
stays its sender's page.

A webmention may be aimed at a comment's page rather than at the post. The
endpoint and the pingback endpoint take `/comment/{id}/` as a page here when it
names an approved native comment, and what is said to it lands on that
comment's post, where its `u-in-reply-to` threads it under the comment.

### The email, in `data/`

Everything under `content/` is published and goes into git, and a line removed
from a file in git stays in its history until somebody rewrites it, which few
site owners will do. So a commenter's email, and the `notify` flag that only
means anything beside it, are kept in a private file per post instead:

```
data/comments/{slug}.json   (mode 0600)
```

```json
{
  "comments": {
    "0199e5f4-...-a1b2": { "email": "ada@example.com", "notify": true }
  }
}
```

Keyed by comment id, holding only the comments that have an email: a post
whose comments are all webmentions has no file here. `src/comments/records.ts`
is the only reader and writer of both files. A comment read there has its
email merged back in, so the index, the auto-approval rule, the reply notices,
the spam checker and the moderation screen see the same `CommentRecord` they
always did; a comment written there is split again. The private file is written
inside the lock on the post's comment file and **before** it, so a crash
between the two leaves an email in both places or in `data/` alone, never in
neither.

**Migration.** Boot runs `migrateCommentEmails` before rebuilding the index. A
comment file that still carries `author.email` or `notify` — written before
TASK-182, or edited by hand since — has them moved into the private file and
taken off the entry, editing the JSON as it finds it so a key this version does
not know and an entry it cannot read both survive. An email the private file
already holds for that id wins. A file with nothing to take off is not written,
so a second boot writes nothing. Until boot has run, a reader still reads an
email left in the comment file, so nothing is lost in between.

**Git history.** Moving the emails out of `content/` stops new ones reaching
git. It does nothing about the ones a site committed while they were still in
the comment files: those stay in the repository's history until that history
is rewritten, whatever the retention sweep or an erasure does to the files
today.

### Reading and writing them

- A file that will not parse, or an entry that makes no sense, is dropped
  rather than throwing. A comment file is public, in git and editable by hand,
  and a typo in one post's file should cost that entry rather than take the
  site down on the next boot. `followers.json` throws for the opposite reason:
  forgetting a follower is irreversible.
- An entry with no `id` or no `author.name` is refused. Everything else it
  leaves out gets the value that means "the site was not told", and an entry
  that does not say its `status` reads as `pending` — showing something nobody
  approved is the one mistake a moderation queue cannot make.
- Every write goes through a per-file lock, writes the file atomically, and
  updates the index inside the same step. Two comments arriving at once cannot
  leave the index saying something the file does not.

### The address hash

The address itself is never stored: the file is published with the site and
goes into git, and an IP address there would be a reader's home written into a
public repository. The hash is `sha256(salt + address)`, truncated, with the
salt in `data/comment-salt` (mode `0600`, minted on first use). Unsalted, an
IPv4 hash *is* the address — four billion candidates is seconds of work. Losing
the salt costs the ability to compare old hashes with new ones and nothing
else.

### Retention (TASK-135)

A sweep removes the email (and `notify` with it) from `data/comments/{slug}.json` and `addressHash` from the comment file once
they outlive `commentEmailRetentionDays` and `addressHashRetentionDays` in
`site.json` and marks the entry `redacted`. An absent key is `0`, forever,
so an upgraded site loses nothing it did not choose to; `geekity init` writes
180 and 30 for a new site. It
rewrites each file under the same per-file lock as every other writer and puts
each changed entry back into the index, and a second sweep writes nothing.
Tools > Personal data erases one commenter's data by email: the entry keeps its
id, status, thread and words, signed `Anonymous`.

The spam checker gets the real address, because that is the one thing it cannot
work without; see the seam below.

## The restricted Markdown

A post is written by somebody who has signed in. A comment is written by
anybody at all, so it gets its own renderer rather than a sanitising pass over
the site's (`src/comments/markdown.ts`):

- **No raw HTML.** `html: false`, so a `<script>` somebody typed is the word
  they typed.
- **Every link marked `rel="nofollow ugc"`** — links written, bare URLs that
  linkify found, reference definitions, all of them.
- **No embedding.** An image becomes a link to it: an `<img>` would let a
  commenter put a stranger's file, and a tracking pixel that logs every
  reader's address, on somebody else's page.
- **An allowlist of schemes**: `http`, `https`, `mailto`. A denylist would miss
  the next scheme somebody thinks of.

The comments feeds run the same HTML through `sanitizeCommentHtml` on the way
out, exactly as they do a fediverse reply, so what is published is checked in
one place whatever wrote it.

## Whether a post is taking comments

None of this applies to a webmention either. `commentsOpen` is asked by the form
and by the form's endpoint and nowhere else, so a closed post still takes what
another page sends it, exactly as it still takes a fediverse reply.


`commentsOpen(document, policy, now)` is the whole rule, read in one place so
the form under a post and the endpoint that refuses a submission can never
disagree — which is the only way a comment form can lie to somebody who has
just typed a paragraph.

1. The site switch (`comments` in `site.json`, on by default) is absolute. Off
   is off everywhere.
2. A draft or a trashed document takes none: nobody can read it to comment on.
3. `comments: true` or `comments: false` in the front matter is the post's own
   answer and beats everything below, in both directions. The editor offers it
   as a three-value field — follow the site, open, closed — because a checkbox
   could only spell two of the three and the one it would lose is the default.
4. A **page** is closed. Standing content, as WordPress defaults it.
5. Otherwise a post is open until it is `commentsCloseAfterDays` old, counted
   from its `date`. Fourteen by default, WordPress's own; `0` never closes one.
   A post with no date has no age and stays open.

None of this touches the fediverse. A reply, a like or a boost arrives because
a remote server sent it, which nothing here can stop and nothing here should
hide: a closed post shows every one of them, and only the form is gone.

## Getting past the form

Three defences run before anything is written, in the order that costs least
and gives away least, and then the checker:

1. **A honeypot** — `website`, hidden from sight and from assistive technology
   and told not to autofill. A submission that filled it is dropped without a
   word and answered with the same redirect a held comment gets: telling a
   robot why it failed is telling it how to succeed.
2. **A minimum form age.** The form carries the moment it was rendered and a
   submission under three seconds later is refused. The field is not signed, so
   this is a speed bump rather than a control; it is here because the naive
   half of the traffic does not bother. A form older than a day is refused too,
   and the words are handed back either way.
3. **A per-address rate limit** — five comments, then a growing wait, using the
   same limiter the login form uses. In memory, so a restart clears it, which
   is the right trade for state an anonymous caller can create.

Then auto-approval: a comment whose **name and email together** have had a
comment approved before is approved again. WordPress's rule. Both have to
match, so a stranger typing a regular's name is still held.

## The spam checker seam

One interface, named in the site's config as `commentChecker`. Nothing else in
the CMS knows such a service exists.

```ts
interface CommentChecker {
  check(submission: CommentSubmission): CommentVerdict | Promise<CommentVerdict>;
  reportSpam?(report: CommentReport): void | Promise<void>;
  reportHam?(report: CommentReport): void | Promise<void>;
}

type CommentVerdict = 'spam' | 'discard' | 'ham' | 'unknown';
```

`CommentSubmission` carries the comment as it would be stored, the post's slug,
title and absolute URL, and the **unhashed** address, the `User-Agent` and the
`Referer` — everything an Akismet-shaped API asks for. An incoming webmention
goes through the very same seam, with `comment.source` reading `webmention`, so
a checker can label it as one without anything else knowing it exists. The verdicts map onto
what happens: `spam` files it as spam where a moderator can still see it,
`discard` throws it away without storing it, `ham` lets it through even where
the site would have held it, and `unknown` leaves the site's own rules to
decide. A checker that throws is treated as `unknown` and logged, so a service
that is down never stops a site taking comments.

`check` has exactly one caller — the intake below — so those four answers mean
the same thing whatever proposed the comment.

The two report methods are the only training such a service gets, and they are
called from the moderation screen when a human disagrees: `reportSpam` when an
approved or pending comment is filed as spam, `reportHam` when one is let out
of the spam list. Approving something that was merely waiting reports nothing —
a service charged per call should not be told what it already assumed.

## One door in

Two things write a comment — the form under a post and the webmention endpoint
(doc-7) — and both go through one function: `intakeComment`, in `src/comments/records.ts`. It is handed a
proposed comment and where it came from, and it owns everything between that
and a comment existing: hashing the address, the auto-approval rule above, the
`CommentChecker` call, the verdict-to-status rule below, the file and index
write inside the per-file lock, and the message to whoever was waiting to hear.

What the callers keep is what is really theirs. `src/comments/submission.ts`
parses the form and runs the three defences; `src/webmention/receive.ts`
fetches the source, checks that it really links here and reads its
microformats. Neither builds a comment record, asks a checker, maps a verdict onto a status, or sends
a notice.

### The verdict-to-status rule

One rule, in one place, and this is the whole of it.

| Verdict   | A new comment                              | A webmention this site already holds      |
| --------- | ------------------------------------------ | ----------------------------------------- |
| `discard` | Nothing is stored at all.                  | The held entry is deleted.                |
| `spam`    | Filed as spam.                             | Filed as spam.                            |
| `ham`     | Approved.                                  | The moderator's decision stands.          |
| `unknown` | Where the site's own rules put it.         | The moderator's decision stands.          |

"Where the site's own rules put it" is the auto-approval rule for a form
comment — approved for a name and email approved before, pending otherwise —
and `pending` for a webmention, which is a stranger's words like any other.

A source re-sending its webmention must not take an approved mention back into
the queue and must not quietly let a spam one out, which is why only a fresh
`spam` moves one: that is a new fact about the content rather than a repeat of
an old one. The entry's id, its post and its source never move, because those
are what make it the same comment; its kind, author, words and date are
replaced by what the page says now.

### Who is told

The intake decides that too, so the rule is written once rather than at each
writer:

- A **new entry that is waiting** sends the moderation notice, once.
- A **webmention that was merely rewritten** sends nothing. The moderators
  heard the first time, and it has been in the queue ever since.
- An **auto-approved comment** sends no moderation notice — nothing is waiting
  — and instead tells whoever it answers, if they asked to be told.

## Akismet

The one checker this package ships, and the only one a site turns on without
writing code. Off until there is a key.

- **The key is a credential**, so it lives in `data/akismet.json` at mode
  `0600`, beside the password hashes and the actor's private keys — never in
  `content/_data/site.json`, which is public, in git and published with the
  site. The file holds `key`, `status` and `checkedAt`, where `status` is what
  `verify-key` said when it was saved: `valid`, `invalid` or `unchecked`.
- **The settings screen** has a Spam checking panel. A pasted key is checked
  with `verify-key` before it is stored, and the panel then reads Connected,
  "Akismet does not recognise this key", "Akismet could not be reached", or Not
  connected. The key is never printed back; the last four characters are, so
  somebody can tell which key is in there. Remove key turns Akismet off.
- **The file is read on every call**, so a key saved on that screen filters the
  next comment and a removed one stops filtering at once. Neither needs a
  restart, which is the point of reading rather than caching it.
- **Precedence.** A `commentChecker` in `geekity.config.ts` wins outright: the
  Akismet checker is built only when the site named none, because a site that
  wrote a checker meant it.

Every comment and every incoming webmention that gets past the three defences
goes to `comment-check` with `blog`, `user_ip`, `user_agent`, `referrer`,
`permalink`, `comment_type`, `comment_author`, `comment_author_email`,
`comment_author_url`, `comment_content`, `comment_date_gmt`, `blog_lang` (the
language setting's primary subtag, which is what Akismet documents),
`blog_charset` and — for a form submission — `honeypot_field_name`.
`comment_type` is `comment` for a native comment and `webmention` for a
webmention. A submission may also name its own type: the contact form (TASK-56)
goes through this same seam as `contact-form`, which is a value Akismet
documents, so a site that named a `commentChecker` of its own sees everything
the public can post at it and nothing needs a second seam. Fediverse replies are
never sent, because they never reach the seam at all: a remote server delivering
a `Create` is not something this site is deciding whether to accept.

| Akismet says | Verdict | What happens |
| --- | --- | --- |
| `true` | `spam` | Filed as spam, where a moderator can still see it. |
| `true` with `X-akismet-pro-tip: discard` | `discard` | Dropped without a queue entry. |
| `false` | `unknown` | The site's own rules decide: approved for a name and email approved before, pending otherwise. |
| `invalid`, a non-200, a timeout, an unreachable host | `unknown` | The same, and the failure is logged with whatever Akismet said was wrong. |

`false` is deliberately not `ham`. `ham` approves a comment outright, and
Akismet seeing nothing wrong is not the same as saying a stranger's first
comment should skip the queue. Nothing Akismet does can lose a comment: every
failure is no opinion, no opinion is the queue, and a call is abandoned after
ten seconds.

Marking something spam or not spam on the moderation screen posts `submit-spam`
or `submit-ham` with the same fields, minus the three a stored comment no longer
has — `user_ip`, `user_agent` and `referrer` — because the file keeps a salted
hash of the address and nothing else.

## The admin screen

`/admin/comments`, three lists — pending, approved, spam — with approve, spam,
delete and reply on every row, and the pending count on the dashboard. Spam is
kept rather than deleted, so a mistake can be undone and so the checker can be
told it was wrong. See doc-5, and "Being told about a comment" below for the
same actions done out of an inbox.

## Being told about a comment

Email is what makes moderation timely, and it is off until a site can send it (TASK-53). With no provider or credential nothing here happens and nothing here breaks.

### To the moderators

A comment or a webmention entering the queue emails every user who has an address and has not turned **New comments** off on `/admin/users`. Only `pending`: one Akismet filed as spam is not waiting for anybody, and one it said to discard was never stored. A webmention re-sent by a page somebody edited notifies nobody either — a source that updates its entry is not new news. And only the users who want it **as it arrives**: one on an hourly or a daily digest hears nothing at this moment, by definition of having chosen a window.

Which of those a comment is, is the intake's decision and not the form's or the endpoint's ("Who is told", above); who then gets a message, and whether they get it now or in a window, is this module's.

The message carries the words themselves, the post, and three links: approve, spam, delete. Each is `/_geekity/moderate?action=…&token=…`, needs no login, and lands on a page with one button on it. **Opening a link does nothing**; only the button acts. Mail readers, spam filters and corporate link scanners fetch the URLs in a message as a matter of course, and a link that moderated on being fetched would be a gateway silently deleting this site's comments.

The token is an HMAC-signed claim, not a stored row. The secret is `data/notification-secret` (mode `0600`, minted on first use, the `comment-salt` pattern), so a link that has been in an inbox for three days goes on working across a restart, a rebuilt cache or a restored backup — all of which decision-9 says a site may do whenever it likes. What *is* stored is the fact that a link has been used: its SHA-256 in `spent_tokens`, swept once the signature has expired. Losing that table forgets which links were spent and costs nothing, because every action a link performs is idempotent. A link is bound to one action on one comment and lasts a week.

`moderateComment` is the single function behind both the screen's buttons and these links, so the two doors cannot drift apart over what an action does or over when `reportSpam` and `reportHam` are called.

### One message a window: the digest

Beside the **New comments** switch on `/admin/users` is how often it should arrive: **As they arrive** (the default, and what every site did before this existed), **Hourly digest** or **Daily digest**. It is per user. On a spam wave that Akismet let through, the difference is one message an hour rather than fifty.

A digest is **derived, not queued**. When a user's window has passed, the sender asks the index what is still `pending` and puts that in one message, each item with its own approve, spam and delete links, minted for that recipient because a link is spent the first time it is used. So an item somebody moderated in the meantime is simply absent, an item that arrived a minute ago is present, and there is no list of pending sends to keep true across a restart, a crash or a `geekity rebuild`.

Two rules follow from that:

- **Nothing waiting, nothing sent.** A user with an empty queue is not emailed, and their window does not start either — the timestamp only moves when a message actually goes. So the first comment on a quiet site goes out on the next tick rather than waiting out a window that had nothing in it, and the promise a mode makes — at most one message per window — still holds.
- **A very long queue is capped** at a hundred items, with the rest counted in a line pointing at `/admin/comments`. A message with three thousand entries and nine thousand signed links is one no provider would take and nobody would read.

The only new state is **when each user was last sent one**, in `data/notification-digests.json` (mode `0600`), keyed by event and then by user id. It is a file rather than a row because decision-9 lets a site delete the database whenever it is stopped, and a forgotten timestamp would mean a window silently skipped or a digest sent twice; it is its own file rather than a field in `data/users.json` because that file answers "who may sign in", and a timestamp the sender rewrites every hour is runtime bookkeeping rather than anything about the person.

The job is an in-process timer, the way scheduled posts are (TASK-44): it ticks about once a minute, and each user's own mode decides whether they are due. `createCms` starts it in `serve()` and stops it in `close()`, and the timers are injectable so a test fires a tick rather than waiting a minute. Nothing is caught up on boot: a site that was down over a window simply sends the next one, with everything still waiting in it.

Reply notices to commenters are unaffected and stay immediate — they are one message about one reply, and they go when the reply is approved. With no mail configured, no digest runs and nothing is written down.

### To the commenter

The form offers **"Email me when somebody replies to this"**, but only on a site that can send mail — a box promising a message nothing could deliver would be a lie on a form. Ticking it stores `notify: true` beside the commenter's email in `data/comments/{slug}.json`. Neither is ever rendered: not in the thread, not in the JSON or Markdown representation of the post, and not in the comments feeds.

One message goes out, and only when a reply to that comment is **approved**. Not when it is submitted: an unapproved reply is not something a stranger should be emailed the text of, and a moderator should be able to delete a nasty one before anybody hears about it. Three things stop it — no address, an address that has unsubscribed, and a reply written by the very person who would be told.

The unsubscribe link at the bottom is signed the same way, lasts a year rather than a week, and is deliberately **not** single use: clicking it twice should say "you are unsubscribed", not "that link is dead". It is **site-wide by address**. Somebody who presses Stop means stop, and a site that then wrote to them about a different post would have read the button as "stop, on this page only". The address goes into `data/comment-optouts.json` (mode `0600`, in `data/` because it is a list of email addresses and `content/` is published). Comment files are untouched: the list is checked at the moment of sending, so nothing has to go back and rewrite entries a site has in git.

### Adding another notice

Preferences are a switchboard keyed by event name, not a field per notice. `src/notifications/preferences.ts` holds the registry; one entry there is a new checkbox on `/admin/users`, a new key in `data/users.json`, and a new answer from `notificationRecipients`. An event a user has said nothing about is at its default, so a notice that ships turned on reaches everybody with an address without anybody visiting that screen. An entry that says `batched: true` gets the how-often select beside its switch as well, and whatever sends it is then responsible for honouring a window; `immediately` is the default there, and a stored mode this version does not know is dropped and read as the default, exactly as an unknown event key is.

## One way out: the conversation

One function writes a comment and one module reads one back. `src/web/conversation.ts`
is that module — doc-4 calls it the conversation on the page — and
`createConversation({ admin, store, contentDir, baseUrl, users })` is the whole
of its interface:

- **`thread(document)`** — everything said about one post, threaded: the
  approved comments merged with the fediverse replies and the reply posts
  answering them (TASK-300) by the same `inReplyTo` rule, and the likes, boosts
  and mentions beside them. This is what the theme is handed as
  `conversation`.
- **`counts(documents)`** — how many answers each of a list of posts has, by
  permalink. The number `source:comments` puts beside an item of a post feed,
  counted off the two indexes rather than by threading each post, because it is
  asked for every item of a page and it goes into that feed's own ETag.
- **`latest(limit)`** — the site's newest answers, each with the post it
  answers, for `/comments/feed/`. One about a post that has since been
  unpublished or trashed is left out: the feed would be showing a conversation
  about nothing. Each also says who wrote the reply it answers, when it
  answers one a reader can see, so the feed's item reads "Bob replying to Ada
  on Hello" rather than "Bob on Hello".
- **`comment(id)`** — one native comment as its own page reads it (TASK-318):
  the comment with its replies threaded under it, the chain of what it answers
  from the top-level comment down, and the post in whatever state it is in.
  See "A comment's own page" below.
- **`replyNamed(document, url)`** — the id of the reply on a post that a URL
  names, which is how a received webmention finds its parent (TASK-319). See
  "Where a received reply goes" above.
- **`documentOf(url)`** — the document whose conversation a URL is in: the
  post a comment's page or anchor is on, the post a webmention was sent to,
  the post a fediverse reply answers however deep, or the document at the URL
  (TASK-320).
- **`upstreams(document)`** — every page in the conversation a document is in
  that answers something off this site, with the replies a reader sees under
  it: what a salmention is sent from. See "Salmention" below.
- **`replyAt(url)`** — the reply a reader can see that a URL names anywhere on
  the site, with the post it is on (TASK-300): a comment by its page or anchor,
  a webmention by its sender's page, a fediverse reply by its note id. A reply
  post answering one takes its reply context from here instead of fetching a
  page. See "A signed-in reply is a reply post" below.

A post's own comments feed is `thread` flattened by `spokenIn` — everything
somebody actually said, at every depth, with the likes and boosts left out
because a feed item with no words is nothing to publish — and `feedComments`
turns an entry from either reading into a feed item, so the page, the post's
feed and the site's feed cannot disagree about what a comment is or where it
lives. A fediverse reply is unmoderated and always `published`, because a
remote server published it before this site heard of it; a comment or a
webmention reaches a reader only at `approved`.

**Nothing outside this module and `intakeComment` reads the `comments` or
`ap_inbox` index to show a reader a conversation.** The moderation screen and
the notices read them and are not conversation display: they are about what a
moderator still has to decide, which is the one thing a reader never sees.

## What a reader sees

The theme's `partials/conversation.njk` renders native comments beside the
fediverse ones and the webmentions — the entry shape is identical, so nothing branches on `source`
unless a theme wants to — and `partials/comment-form.njk` renders the form
under an open post. Threading needs no JavaScript: a Reply link carries the
comment's id to the form as `?reply_to=`, and the CMS checks it names an
approved comment on that very post before putting a name on the form. A
visitor gets a Reply link on native comments only. Somebody signed in gets one
on every reply in the thread, and the CMS checks the id names a reply a reader
can see in that thread (TASK-300).

## A reply under a hidden comment

A comment can be pending, spam or deleted while a reply to it is approved: a
moderator approves the reply first, files the parent as spam later, or deletes
it, and a webmention answering a comment is threaded under it whatever that
comment's status (TASK-319). Such a reply is shown everywhere a reader looks,
under a placeholder for its parent (TASK-325, decision-46):

- **The thread on the post** prints the placeholder where the hidden comment
  would be: its `#comment-{id}` anchor, no author, no words, "This comment is
  no longer shown.", and the visible replies nested under it. A pending or spam
  comment still says what it answers, so its placeholder goes there; a deleted
  one is known by nothing, so its placeholder goes under the post. A
  placeholder sits where its first visible reply's date puts it.
- **A hidden comment with no visible reply under it prints nothing**: no empty
  placeholders.
- **The comment page** of the reply shows the same placeholder in its chain
  above, and the comment page of the comment the hidden one answers shows the
  placeholder among its replies. Its link to the whole conversation lands on
  the reply's anchor, which the thread now prints.
- **The comments feeds** — the post's and `/comments/feed/` — list the reply
  and never the placeholder. The site's feed titles it "{author} on {post}",
  since the comment it answers names nobody.
- **The counts** — the thread's title and `source:comments` on a post feed —
  count the visible replies only.

A reply under a fediverse note its author withdrew keeps the older rule: it
moves up to whatever that note answered, since a withdrawn note is the
author's own retraction rather than a moderator's.

## A comment's own page

A comment left through the form has a page of its own at `/comment/{id}/`, its
id percent-encoded (an id imported from WordPress is a URL). It used to have
only an anchor on the post, `{permalink}#comment-{id}`, and a site replying to
it fetched that URL and got the whole post page, so whether its reply context
quoted the comment or the post depended on its parser. The page is what the
comment's `url` is now: the thread's permalink on the post, both comments
feeds, and what a reply names. The anchor stays on the post, so an old link
still scrolls to the comment.

Only a native comment has one. A webmention's `url` is its sender's page and a
fediverse reply's is the remote note, and they stay so: `/comment/{id}/` 404s
for either.

A webmention sent to a comment's page is accepted and lands on the comment's
post, threaded under the comment (see "Where a received reply goes").

The page holds the comment as its one `h-entry`: author `h-card`, content,
`dt-published`, and `u-url` the page. Above it is the thread from the post
down, as nested `u-in-reply-to h-cite`s, so the comment's `in-reply-to` is its
parent (or the post, for a top-level comment), whose own is the next one up,
down to the post: its title or wordless label, author, date and excerpt. Below
are its replies, nested at every depth as the thread nests them, each a
`p-comment h-cite` of the entry, then a link to the comment on the post.

What it shows follows the thread's rules:

- **The comment.** An approved native comment answers 200. Pending, spam, a
  deleted comment, an unknown id and a webmention 404.
- **The post.** The page answers as the post would: 410 once the post is
  deleted, 404 while it is a draft, scheduled or otherwise not served, and 404
  while the post does not show its conversation (a page that does not take
  comments).
- **What it answers.** An ancestor a reader may not see, pending, spam,
  deleted or a withdrawn fediverse note, is shown as a placeholder saying the
  comment is no longer shown, with no author or words. The chain goes on past
  it through what that comment answered while the site still knows it; a
  deleted comment is known by nothing, so the chain goes from it to the post.
- **Its replies.** The same list the post's thread is built from, threaded
  from the comment rather than the post, so a reply waiting for a moderator is
  absent from both, and an approved reply to one is under the same
  placeholder in both (see "A reply under a hidden comment").

The page is `noindex`, in a meta tag and an `X-Robots-Tag` header, and on no
list: not the sitemap, the post feeds or search. It is
`layouts/comment.njk` in the theme, whose context the theme README documents
under "A comment's own page".

An Eleventy build of the same content directory shows the same thread:
`docs/eleventy.config.example.js` reads the same files and its `conversation`
filter takes the post's slug as a second argument. It reads them from disk
rather than through the data cascade on purpose — a namespaced
`_data/comments/` directory would arrive as a global called `comments`, and
`comments: true` in a post's front matter would shadow it on exactly the pages
that need it.

## A signed-in reply is a reply post

A comment is something somebody else says on the site: a visitor through the
form, a webmention or a fediverse reply. A post is something a signed-in user
says. So when somebody signed in replies, from the thread or from the
moderation screen, they write a reply post, one record, instead of a comment
(TASK-300, TASK-326, decision-47). Owner comments written before this stay
comments.

Both doors save it through `writeReplyPost` (`comments/reply-post.ts`), which
fills a blank editor form and hands it to `writeDocument`, the write path the
editor and Micropub share. Its federation, its webmentions and its reply context follow
from that save as for any other reply post. Its `in-reply-to` is what it
answers:

| It answers         | `in-reply-to`                          | What reaches them                                   |
| ------------------ | -------------------------------------- | --------------------------------------------------- |
| The post           | The post's absolute permalink          | Nothing more: it is on the post's thread.           |
| A native comment   | The comment's page, `/comment/{id}/`   | The reply notice, when the commenter asked for one. |
| A webmention reply | The page the webmention came from      | A webmention to that page.                          |
| A fediverse reply  | The note's id                          | A `Create` with `inReplyTo` that id, to its author. |
| A reply post       | The reply post's absolute permalink    | Nothing more: it is in the same thread.             |

The signed-in form carries one more field, `listed`, labelled "Include in
posts and feeds" and unchecked by default. Unchecked writes `visibility:
unlisted`: the reply post has its own `noindex` page and is on no listing, post
feed, outbox or sitemap, while its webmention and its fediverse delivery go out
as for any unlisted post. Checked writes a public reply post. A visitor's form
has no such field, and the endpoint never reads one from a visitor.

### From the moderation screen

Each card on `/admin/comments` has a Reply box. What it posts is a reply post
written as the signed-in user, answering the card's comment exactly as the
thread's form would: a native comment by its `/comment/{id}/` page, a
webmention by the page it came from. The box has the same "Include in posts and
feeds" checkbox, `listed`, unchecked by default, so a reply from the queue is
unlisted unless it is ticked. The thread shows it inline under the comment, as
it shows one written there. A comment still waiting for a moderator can be
answered too: the reply post threads under its placeholder until it is
approved.

### The reply notice

A commenter who asked to hear about replies is told about a reply post that
answers their comment once, whichever door it came in by: the thread, the
moderation screen, the editor, Micropub or a file. No door sends it. A
subscriber to the index (`comments/reply-notices.ts`), beside federation and
the webmention sender, sends it on the change that first makes the reply post
served:

- a scan, the boot scan included, is never news;
- a change whose previous version was already served (an edit, a file the
  watcher re-reads) is not news;
- the reply post's `in-reply-to` must resolve through `heldAt` to a native
  comment a reader can see;
- the key `reply-notice:{comment id}:{reply post permalink}` in the admin
  state must be unset, and is set before the message goes, so a reply post
  trashed and restored, or drafted and published again, tells nobody twice.

The ledger is derived state (decision-9): a deleted database forgets it, and
the boot scan that rebuilds the index sends nothing, so nothing is told twice
either way. The message itself is the comment reply notice of TASK-55, with
the reply post's author's account as the writer, so nobody is told about their
own reply.

### How the thread finds them

`gather` names every entry of a conversation by each URL a reply post could
use for it: the post by its permalink and object id, every entry by its id and
its `url`, and a native comment by its page and its `#comment-` anchor as well.
It asks the content index for every served post whose `in-reply-to` is one of
those URLs, unlisted ones included (`listRepliesTo`). Each reply post found
joins the thread as an entry with `source: 'post'`, its permalink as `url`, its
author's profile as the author and its rendered body as `content`. Its id is
its object id, so a fediverse reply to it already names it.

What was said under a reply post comes with it. A reply post's own
conversation is gathered the same way, and its entries join the thread with
their top-level answers set to the reply post. A webmention sent to the reply
post's page or a note answering it therefore threads under it on the original
post. The reply post's own page shows the same answers as its own thread. A
reply post is visited once per reading, so two reply posts naming each other
end.

The site-wide feed finds a reply post from the other side. It reads the newest
served reply posts and walks each one's `in-reply-to` up to the document at the
top of its thread. That walk goes through a comment's page to its post, a
webmention's sender page to the post it was sent to, and a note to the post it
answers. A reply post shows there only when that thread shows it.

### What a reader sees

- **The thread.** The reply post is shown once, inline under what it
  answers, with its author, its words and a `u-url` to its own page.
- **The comments feeds.** A reply post is an item of its thread's post feed
  and of `/comments/feed/`, linking to the reply post. It is there whether it
  is public or unlisted: unlisted keeps a post out of listings and post feeds,
  and the comments feed of a thread lists that thread.
- **The counts.** It counts as a reply in the thread's title. `source:comments`
  on a post feed counts the reply posts that answer the post, one of its
  comments or a note that answers it directly.
- **Its reply context.** A reply post whose `in-reply-to` names something
  this site holds takes its context from the index through `heldAt`, read when
  the page is drawn: a reply quotes the comment rather than the post page the
  comment is on, and a served post or page gives its title, words, author and
  date. The service never fetches a target `heldAt` answers, so a top-level
  reply never fetches the site's own page (TASK-326). That holds for a reply
  post written in the editor or over Micropub as well. A reply post citing a
  comment, a webmention or a fediverse reply says "In reply to a comment by"
  its writer; citing a post, a page or another reply post, it keeps the post
  wording.
- **Its author link.** The thread links a reply post's author to their author
  page with no `rel="nofollow ugc"`: they are a user of the site. Visitor,
  webmention and fediverse author links keep it.

### Its limits

- A visitor answering a fediverse reply leaves a native comment, which goes
  nowhere over ActivityPub. A visitor is not a user and has no actor.

## Salmention

With a plain webmention, a reply to a reply reaches the page it answers and
never the post at the top of the thread. [Salmention](https://indieweb.org/Salmention)
closes that gap when every site in the chain cooperates: the page that gained a
reply sends its webmention again upstream, and the upstream site fetches it
again and reads the replies nested inside its h-entry. This site does both
halves (TASK-320, decision-49). It cannot make another site do either.

### Receiving

A webmention from a source the site already holds fetches the source again
and rewrites the entry it made, matched by its `url` as always ("The files"
above). It also reads the replies nested in the source's chosen h-entry
(`sourceEntry` in `webmention/microformats.ts`):

- each `p-comment` item of the entry, an `h-cite` or an `h-entry`;
- each child `h-entry` or `h-cite` whose `u-in-reply-to` names the entry's
  `u-url`;
- and the same again inside each of those, at most 8 deep and 200 in all.

A nested reply with no `u-url` is passed over: its page is its identity.

Each nested reply becomes a comment record of its own on the same post, put
through `intakeComment` exactly as a webmention is, so the checker, the
verdict-to-status rule and the moderators' notice are the ones a webmention
gets. It is `source: webmention`, `kind: reply`, `url` its own page,
`inReplyTo` the source's entry (or the nested reply it sits under), and `via`
the source's URL. `via` is what lets the source take it away: when the source
is read again, every record whose `via` is that source and that the source no
longer carries is deleted, and when the source is deleted (it has gone, it
stopped linking here, or the checker discarded it) everything it carried goes
with it. A moderator's decision on a nested reply stands when the source sends
again, as it does for a webmention.

A nested reply is not copied when the site already has it some other way:

- its URL is on this site (a reply post, a comment's page, a post);
- the conversation already names it (`replyNamed`), and not as one this
  source brought: a webmention held from its own page, a fediverse note, a
  reply post, or a reply another source brought.

What is nested under one of those still threads under it. A nested reply
whose own page later sends a webmention is the same record from then on, with
`via` cleared, so the source dropping it no longer deletes it.

### Sending

Two kinds of page here answer a page elsewhere, and each one tells it when
the replies under it change:

| The page                | What it answers                          |
| ----------------------- | ---------------------------------------- |
| A reply post            | Its `in-reply-to`, when that is off-site |
| A comment's own page    | The webmention reply it is under         |

A comment page answering anything else (the post, another comment, a reply
post, a fediverse note) has nobody to tell: what it answers is on this site,
which already knows, or speaks ActivityPub rather than webmention. The silo
original a cited copy is of (TASK-197) is told too.

`ConversationReader.upstreams(document)` lists those pages for the whole
thread a document is in, each with the replies a reader sees under it. The
webmention service asks it whenever the conversation may have changed: on
every comment the index writes or forgets and every activity it logs
(`AdminStore.onConversationWrite`, which a rebuild of either index does not
fire), and on every content change but a scan. Writes that come together, such
as a source carrying several nested replies, are looked at once.

A page sends only when what a reader sees under it changed: the service keeps
a fingerprint of those replies (their ids, URLs, authors, words and dates) in
the admin state under `salmention:{page} {target}`, and a page that has never
sent counts as one with no replies. So a reply post's first webmention, on
publishing, stays the ordinary one, and a reply under it that is still waiting
for a moderator sends nothing until it is approved. The ledger is derived
state (decision-9): a deleted database costs at most one extra webmention per
page.

The reply post's page prints its replies inside its `h-entry`, as `p-comment
h-cite`s, so a receiver finds them there; its likes, boosts and mentions stay
below the entry. A comment's own page already prints its replies that way
(TASK-318).

### What stops a loop

Two sites that both do this, each answering the other, stop on their own. A
page here sends only when its replies changed, and reading the other site's
page back adds nothing, because what it nests of this site's is this site's
own and is not copied. The site tells it once more when its answer appears,
and then it has nothing new to say.

For a page that never settles, such as one that prints something different
each time it is read, one page tells one target at most 5 times an hour
(`SALMENTION_LIMIT`). A change past that is not sent; the next change after
the hour is.

### Its limits

- A page is told only that the replies under it changed. Salmention also asks
  a site to tell every page its post sent a webmention to; this site tells the
  page it answers and nothing else.
- A comment's own page sends nothing when the comment itself first appears or
  is removed, only when its replies change: a native comment answering a
  webmention reply does not send that page a webmention of its own.
- A change past the hourly limit waits for the next change to be sent.
- A failed send is not tried again until the replies change again.
- Nested replies are read off the source's chosen entry only, not off other
  entries on its page.
