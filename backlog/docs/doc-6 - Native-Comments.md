---
id: doc-6
title: Native Comments
type: specification
created_date: '2026-09-04 22:29'
updated_date: '2026-09-04 22:30'
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
        "email": "ada@example.com"
      },
      "content": {
        "markdown": "Good post.",
        "html": "<p>Good post.</p>\n"
      },
      "submitted": "2026-09-20T10:00:00.000Z",
      "addressHash": "0123456789abcdef0123456789abcdef",
      "inReplyTo": null
    }
  ]
}
```

`post` is the permalink, so a file read on its own knows where its comments
belong. `comments` is the list, oldest first.

| Key           | What it holds                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `id`          | Its name, unique across the site, and what a reply puts in `inReplyTo`. A UUID.                   |
| `source`      | `comment` (the form) or `webmention` (TASK-51). More may follow; an unknown one reads as `comment`. |
| `kind`        | `reply`, `like` or `boost` — the same three a conversation knows. A form only ever makes a `reply`. |
| `status`      | `pending`, `approved` or `spam`. Only `approved` reaches a reader.                                 |
| `author.name` | What the page shows.                                                                              |
| `author.url`  | Their website, or `null`. Marked `nofollow ugc` like every link in a comment.                     |
| `author.email`| **Never shown.** For the moderator, the auto-approval rule and the spam checker.                  |
| `content.markdown` | What was typed, which is the thing a person wrote.                                           |
| `content.html`| That Markdown through the restricted profile below.                                               |
| `submitted`   | An ISO 8601 instant (decision-11: a UTC instant, always).                                         |
| `addressHash` | A salted SHA-256 of the address it came from, truncated, or `null`.                               |
| `inReplyTo`   | The comment it answers, or `null` for one answering the post.                                     |

The shape is deliberately wider than a form submission, because a webmention
lands in the same file: it has a `url` and no email, it may be a like rather
than a reply, and it should thread with everything else rather than needing a
store of its own.

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
`Referer` — everything an Akismet-shaped API asks for. The verdicts map onto
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

## The admin screen

`/admin/comments`, three lists — pending, approved, spam — with approve, spam,
delete and reply on every row, and the pending count on the dashboard. There is
no email in this milestone, so the screen is the notification. Spam is kept
rather than deleted, so a mistake can be undone and so the checker can be told
it was wrong. See doc-5.

## What a reader sees

The theme's `partials/conversation.njk` renders native comments beside the
fediverse ones — the entry shape is identical, so nothing branches on `source`
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
