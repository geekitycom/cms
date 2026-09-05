---
id: doc-6
title: Native Comments
type: specification
created_date: '2026-09-04 22:29'
updated_date: '2026-09-05 03:14'
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
        "email": "ada@example.com",
        "avatar": null
      },
      "content": {
        "markdown": "Good post.",
        "html": "<p>Good post.</p>\n"
      },
      "submitted": "2026-09-20T10:00:00.000Z",
      "addressHash": "0123456789abcdef0123456789abcdef",
      "inReplyTo": null,
      "url": null,
      "notify": true
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
| `author.email`| **Never shown.** For the moderator, the auto-approval rule and the spam checker.                  |
| `author.avatar`| Their face, or `null`. Only a webmention has one; a form asks nobody for a picture.               |
| `content.markdown` | What was typed, which is the thing a person wrote.                                           |
| `content.html`| That Markdown through the restricted profile below.                                               |
| `submitted`   | An ISO 8601 instant (decision-11: a UTC instant, always).                                         |
| `addressHash` | A salted SHA-256 of the address it came from, truncated, or `null`.                               |
| `inReplyTo`   | The comment it answers, or `null` for one answering the post.                                     |
| `url`         | Where it lives when it lives somewhere else: a webmention's source page, `null` for one written here. |
| `notify`      | Whether the commenter asked to be told when somebody answers them. Only ever `true` alongside an `author.email`; an entry that does not say it asked for nothing. |

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
    "email": null,
    "avatar": "https://grace.example/me.jpg"
  },
  "content": {
    "markdown": "Somebody else wrote about this",
    "html": "<p>Somebody else wrote about this</p>"
  },
  "submitted": "2026-09-21T09:00:00.000Z",
  "addressHash": "0123456789abcdef0123456789abcdef",
  "inReplyTo": null,
  "url": "https://grace.example/2026/09/about-that/",
  "notify": false
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

The two report methods are the only training such a service gets, and they are
called from the moderation screen when a human disagrees: `reportSpam` when an
approved or pending comment is filed as spam, `reportHam` when one is let out
of the spam list. Approving something that was merely waiting reports nothing —
a service charged per call should not be told what it already assumed.

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

A comment or a webmention entering the queue emails every user who has an address and has not turned **New comments** off on `/admin/users`. Only `pending`: one Akismet filed as spam is not waiting for anybody, and one it said to discard was never stored. A webmention re-sent by a page somebody edited notifies nobody either — a source that updates its entry is not new news.

The message carries the words themselves, the post, and three links: approve, spam, delete. Each is `/_geekity/moderate?action=…&token=…`, needs no login, and lands on a page with one button on it. **Opening a link does nothing**; only the button acts. Mail readers, spam filters and corporate link scanners fetch the URLs in a message as a matter of course, and a link that moderated on being fetched would be a gateway silently deleting this site's comments.

The token is an HMAC-signed claim, not a stored row. The secret is `data/notification-secret` (mode `0600`, minted on first use, the `comment-salt` pattern), so a link that has been in an inbox for three days goes on working across a restart, a rebuilt cache or a restored backup — all of which decision-9 says a site may do whenever it likes. What *is* stored is the fact that a link has been used: its SHA-256 in `spent_tokens`, swept once the signature has expired. Losing that table forgets which links were spent and costs nothing, because every action a link performs is idempotent. A link is bound to one action on one comment and lasts a week.

`moderateComment` is the single function behind both the screen's buttons and these links, so the two doors cannot drift apart over what an action does or over when `reportSpam` and `reportHam` are called.

### To the commenter

The form offers **"Email me when somebody replies to this"**, but only on a site that can send mail — a box promising a message nothing could deliver would be a lie on a form. Ticking it stores `notify: true` on the entry, beside the `author.email` that is already there. Neither is ever rendered: not in the thread, not in the JSON or Markdown representation of the post, and not in the comments feeds.

One message goes out, and only when a reply to that comment is **approved**. Not when it is submitted: an unapproved reply is not something a stranger should be emailed the text of, and a moderator should be able to delete a nasty one before anybody hears about it. Three things stop it — no address, an address that has unsubscribed, and a reply written by the very person who would be told.

The unsubscribe link at the bottom is signed the same way, lasts a year rather than a week, and is deliberately **not** single use: clicking it twice should say "you are unsubscribed", not "that link is dead". It is **site-wide by address**. Somebody who presses Stop means stop, and a site that then wrote to them about a different post would have read the button as "stop, on this page only". The address goes into `data/comment-optouts.json` (mode `0600`, in `data/` because it is a list of email addresses and `content/` is published). Comment files are untouched: the list is checked at the moment of sending, so nothing has to go back and rewrite entries a site has in git.

### Adding another notice

Preferences are a switchboard keyed by event name, not a field per notice. `src/notifications/preferences.ts` holds the registry; one entry there is a new checkbox on `/admin/users`, a new key in `data/users.json`, and a new answer from `notificationRecipients`. An event a user has said nothing about is at its default, so a notice that ships turned on reaches everybody with an address without anybody visiting that screen.

## What a reader sees

The theme's `partials/conversation.njk` renders native comments beside the
fediverse ones and the webmentions — the entry shape is identical, so nothing branches on `source`
unless a theme wants to — and `partials/comment-form.njk` renders the form
under an open post. Threading needs no JavaScript: a Reply link carries the
comment's id to the form as `?reply_to=`, and the CMS checks it names an
approved comment on that very post before putting a name on the form.

An Eleventy build of the same content directory shows the same thread:
`docs/eleventy.config.example.js` reads the same files and its `conversation`
filter takes the post's slug as a second argument. It reads them from disk
rather than through the data cascade on purpose — a namespaced
`_data/comments/` directory would arrive as a global called `comments`, and
`comments: true` in a post's front matter would shadow it on exactly the pages
that need it.
