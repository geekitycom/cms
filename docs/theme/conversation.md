# The conversation

`conversation` holds the responses to a post:

- the fediverse replies, likes and boosts sent to its inbox
- the fediverse posts that quoted it with its author's approval
- the comments visitors left on the page
- the webmentions other pages sent it

It is on the context of a rendered post **only when it has at least one
item**. A post with no responses renders no empty section. A layout tests for
the key:

```njk
{% if conversation %}
{% include "partials/conversation.njk" %}
{% endif %}
```

`layouts/post.njk` and `layouts/page.njk` both do this.

A page has a conversation the same way a post does, whether or not it takes
comments. Closing a page's comments, in its front matter, on Settings >
Discussion or for the whole site, removes the form and nothing else: what was
already said stays on the context. The CMS receives and moderates webmentions
to a page whether it is open or closed, the same as webmentions to a post.

`partials/conversation.njk` is the whole section:

1. A `div.reactions-section` of the likes, the boosts and the mentions, as
   facepiles grouped by kind.
2. The thread, as `div#comments.comments-area`.

To replace it, add a `partials/conversation.njk` to the site's theme, the same
as any other template. The partial defines two macros,
`face(item, icon, href)` and `group(items, label, kind, icon, source)`. To place
the pieces yourself, import them in a layout:

```njk
{% import "partials/conversation.njk" as reactions with context %}
{{ reactions.group(conversation.likes, "Likes", "p-like", "❤️") }}
```

`comment(reply, classes)` in `partials/comment.njk` renders one reply and
everything under it. The thread and a comment's own page both import it.
`classes` is the reply's microformat. Under a post it is `h-entry`, the
default. On a comment's page it is `p-comment h-cite`, because the comment is
the page's only entry.

A reply post prints its replies inside its own `h-entry`, as `p-comment
h-cite`s. The page it answers finds them there when it receives a salmention
(TASK-320). For a reply post, `layouts/post.njk` includes
`partials/conversation.njk` twice and sets `conversationPart`:

- `"replies"`, inside the entry, for the thread.
- `"reactions"`, below the entry, for the facepiles. Their links are not part
  of the entry.

When `conversationPart` is unset, the partial prints the whole section.

A document's Markdown carries the same conversation, with each reply's words
converted to Markdown. See [The Markdown representation](markdown.md).

## The shape

The conversation does **not** use ActivityPub's vocabulary. Native comments
and webmentions are in the same thread. Every entry says where it came from and
what it is. The rest of the entry has the same shape for every source. A theme
that ignores `source` renders every entry correctly. A theme that reads
`source` can style the sources differently. A theme must read `kind`: a
`mention` is in `conversation.mentions`, not in the thread, because it is not
an answer.

| Key                                                | What it holds                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `replies`                                          | The replies to the post, oldest first, each carrying its own `replies`. See below.                                      |
| `likes`                                            | The likes, oldest first, in the same shape.                                                                             |
| `boosts`                                           | The boosts, oldest first, in the same shape. A webmention `repost` is one of them.                                      |
| `mentions`                                         | The pages and fediverse quotes about this post, oldest first, in the same shape.                                        |
| `rsvps`                                            | An event's answers, each group `{ value, label, people }`, going, maybe, interested, not going, only with people in it. |
| `counts.replies`                                   | How many replies, counted through the whole thread, not only the top level.                                             |
| `counts.likes`, `counts.boosts`, `counts.mentions` | How many of each.                                                                                                       |
| `counts.rsvps`                                     | How many people answered an event, in every group.                                                                      |
| `counts.total`                                     | The sum of all counts. It is never zero in a template, because then there is no `conversation`.                         |

Each entry, whether a reply, a like or a boost, is:

| Key               | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Its identifier: a fediverse reply's note id, a reaction's activity id, a stored comment's key. An answer to the entry names this value.                                                                                                                                                                                                                                                                                                                                       |
| `key`             | Its key (decision-51): 16 lowercase hex digits, the comment's id for one stored on the site and the key of its guid for anything else. Its anchor is `#comment-{key}` and its replies feed `/replies/{key}/`.                                                                                                                                                                                                                                                                 |
| `guid`            | What the comments feeds call it: a native comment's `/comment/{key}/` page, a stored comment's origin (else its `url`), a fediverse note's id, a reply post's object id.                                                                                                                                                                                                                                                                                                      |
| `migrated`        | `true` for a comment imported from the site this one replaced (decision-51). It displays like any other entry, but no feed carries it, and no count that a feed advertises includes it.                                                                                                                                                                                                                                                                                       |
| `source`          | `"activitypub"` for a fediverse reply, `"comment"` for one left on the page, `"webmention"` for another page linking here, `"post"` for a reply post a user of the site wrote (its `url` is the post's permalink).                                                                                                                                                                                                                                                            |
| `kind`            | `"reply"`, `"like"`, `"boost"`, `"repost"` or `"mention"`. A `repost` comes from a webmention. A `mention` is a webmention or an approved fediverse quote.                                                                                                                                                                                                                                                                                                                    |
| `author.name`     | The best name available: their display name, else their handle, else their server, else their id. For a webmention, the source's `h-card` name, else its host.                                                                                                                                                                                                                                                                                                                |
| `author.handle`   | `@user@host`, or `null`. From the follower or actor profile the site holds, else guessed from the actor URL unless the URL ends in a number. `null` for a native comment.                                                                                                                                                                                                                                                                                                     |
| `author.url`      | Their profile page, the website a commenter typed, or a webmention author's `u-url`. May be `null`, so guard the link.                                                                                                                                                                                                                                                                                                                                                        |
| `author.avatar`   | Their avatar, or `null`. The site knows one for a fediverse actor whose profile it holds or whose imported comment brought their icon, and for a webmention whose `h-card` carried a `u-photo`. Always a same-origin `/_geekity/avatars/…` path, never the remote URL. See [Avatars](#avatars).                                                                                                                                                                               |
| `author.actorId`  | Their id, which identifies them whatever their name. `null` for a native comment, and for an imported one whose actor the export did not name.                                                                                                                                                                                                                                                                                                                                |
| `author.username` | The site user they are, or `null`: whoever wrote a reply post, or the user a comment imported from the site this one replaced names (a WordPress comment written signed in). Such a comment's `author` is that user's, as a reply post's is: their display name, avatar and author archive.                                                                                                                                                                                   |
| `url`             | Where it can be read: the remote note's `url` for a fediverse reply or quote, the source page for a webmention, and `/comment/{key}/`, its own page, for a native comment (see [A comment's own page](#a-comments-own-page)).                                                                                                                                                                                                                                                 |
| `content`         | The text, **already sanitised**. Print it with `\| safe`. Empty for a like or a boost.                                                                                                                                                                                                                                                                                                                                                                                        |
| `published`       | A `Date`: when it was published, or when it arrived if it did not say. Use the `date` filter.                                                                                                                                                                                                                                                                                                                                                                                 |
| `inReplyTo`       | What it answers: the post's ActivityPub id or another reply's id. `null` for a reaction.                                                                                                                                                                                                                                                                                                                                                                                      |
| `status`          | `"published"`. Recorded for the sources that are moderated.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `replies`         | The replies to this one, oldest first, nested as deep as the site has seen. One may be a placeholder. See below.                                                                                                                                                                                                                                                                                                                                                              |
| `rsvp`            | An RSVP: `{ value, label }`, its `p-rsvp` (`yes`, `no`, `maybe` or `interested`) and the words for it. Absent otherwise. A webmention reply that is an RSVP carries one, and the default theme prints it as a `data.p-rsvp` at the top of the comment's content. On an event, an RSVP is in `rsvps`, not in the thread. So is a fediverse `Accept` (`yes`), `TentativeAccept` (`maybe`) or `Reject` (`no`) of the event. Each person is there once, with their latest answer. |

### What the thread includes

The CMS applies four rules to the thread. A theme does not apply them.

1. A reply that its author deleted is removed. Its own answers move up to what
   the deleted reply answered.
2. A comment that visitors may not see (waiting for a moderator, spam or
   deleted) becomes a placeholder if it has a visible reply under it. Without a
   visible reply, it is not in the thread.
3. The CMS counts a like once per actor. An imported like and the same actor's
   like delivered to this site count as one. The like disappears when the actor
   undoes it.
4. A note that answers something unrelated to this post is left out.

A fediverse reply or reaction imported from the site this one replaced shows
once, however often its server sends it again or the reply backfill reads it.
The thread shows the imported comment, with the moderator's decision on it, and
the answers in its note thread under it.

A placeholder in `replies` is `{ id, withheld: true, replies }`: the hidden
comment's id and the replies under it. It has nothing that names the author or
gives the text. Test `reply.withheld` before printing an author. A pending or
spam comment's placeholder is where the comment would be. A deleted comment's
placeholder is directly under the post, because the CMS does not know what the
comment answered. `counts.replies` and the comments feeds count and carry only
the visible replies.

### Why `content` is safe to print

`content` is safe to print for every source:

- A fediverse reply is HTML from another server. The CMS rebuilds it from an
  allowlist of `a`, `p`, `br`, lists, `blockquote`, `pre`, `code` and the
  inline emphasis tags. Every link gets `rel="nofollow noopener noreferrer"`.
- A webmention's `e-content` goes through the same allowlist.
- A native comment is Markdown that the commenter typed. The CMS renders it
  with raw HTML off and no embedded images. Every link gets
  `rel="nofollow ugc"`.

Nothing else survives any of the three routes, so a theme can print all of
them directly.

### The packaged markup

The packaged partial draws each entry as the source design does:

- An `li.comment.h-entry` with `id="comment-{{ reply.key }}"` and a
  `comment-{{ reply.source }}` class.
- Inside it, an `article.comment-body`. Its `footer.comment-meta` holds:
  - The author, as a `.comment-author.vcard.p-author.h-card`. This shows the
    avatar, or the first letter of the name in a `span.comment-avatar-empty`
    when there is no avatar. The author link has `rel="nofollow ugc"`, unless
    `author.username` says the author is a user of the site, as for a reply
    post's author.
  - The permalink, as a `.comment-metadata` link around a `time.dt-published`.
  - A `span.comment-source` that says "via webmention" or "via the fediverse"
    for entries from those sources.
- The text, in `div.comment-content.e-content`.
- Answers, nested in an `ol.children` inside the entry they answer.

A Reply link in a `div.reply` goes on comments written on this site,
`source == "comment"`, while the post is open. It passes the comment's key to
the form as `?reply_to=`, so threading needs no JavaScript. Fediverse replies
and webmentions get no Reply link. A visitor answers a fediverse reply on the
server that holds it, and a webmention on the page that sent it.

A placeholder is an `li.comment.comment-placeholder` with the hidden comment's
anchor. It holds a `p.comment-withheld` that prints `withheld()` ("This comment
is no longer shown."), and its replies in an `ol.children`. A placeholder has
no microformat.

Above the thread, `group()` draws one `div.reaction-group` for each kind that
has entries. Each group has:

- the source theme's class: `p-like`, `p-repost` or `p-mention`
- an `h2.reaction-title` with the label, and the count in a
  `span.reaction-count`
- a `div.facepile` of `a.u-url` faces next to the title

A face is a round `u-photo` avatar. If the site has no picture of a reaction's
author, the face is the emoji badge of its kind and a `.reaction-name`. Likes
and boosts link to the person. A mention links to the page it came from,
because the page is what the visitor wants to read.

### A closed post

No key says that a post has stopped taking comments. **A closed post is a post
without `commentForm`.** The CMS puts the form on the context only while the
site switch, the setting for the document's type, the closing window and the
document's own front matter all allow comments. A closed page works the same
way. When there is no form, the packaged partial prints `p.no-comments`
under the thread. This is WordPress's "Comments are closed." message, and it
tells the visitor why there is no form.

### In an Eleventy build

An Eleventy build of the same content gets the same data from the same files.
`docs/eleventy.config.example.js` adds a `conversation` filter over
`federation.inbox`. It puts the post's ActivityPub id on the context as
`activityStreams` and its slug as `geekitySlug`. A layout reads:

```njk
{% set conversation = federation.inbox | conversation(activityStreams, geekitySlug) %}
```

Then it loops over the same keys as above. The slug names the post's comment
file under `content/_data/comments/`. Backlog doc-6 documents the format. Two
things differ:

- A native comment's `url` is its `#comment-{key}` anchor, because a static
  build writes no comment pages.
- The site's own reply posts (`source: "post"`) are not in the thread.

## A comment's own page

A comment left through the form has its own page at `/comment/{key}/`. That
page is its `url` everywhere: the thread's permalink, the comments feeds, and
the URL another site fetches when it replies to the comment. The
`#comment-{key}` anchor on the post still exists, so old links still scroll to
the comment. Webmentions and fediverse replies have no comment page. Their
`url` is where they came from.

`layouts/comment.njk` draws the page, with the comment as the page's only
`h-entry`. The page exists only while the post shows its conversation. It is
`noindex` and is on no list: not the sitemap, the post feeds or search. Its
context:

| Key         | What it holds                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `comment`   | The comment, an entry of the shape above, its `replies` nested at every depth by the thread's own rules.                                                                                               |
| `ancestors` | What it answers, from the top-level comment down to its parent. An ancestor that visitors may not see (waiting for a moderator, spam, deleted, withdrawn) is `null`, so the chain keeps its positions. |
| `post`      | The post it is on, as a listing entry is: `label`, `url`, `date`, `summary`, `author` and the rest.                                                                                                    |
| `threadUrl` | The comment's anchor on the post, for a link back to the whole conversation.                                                                                                                           |

The packaged layout prints the chain above the comment as nested
`u-in-reply-to h-cite`s. The comment cites its parent, the parent cites its own
parent, and so on up to the post. The post prints first, so a parser and a
visitor read the thread in the same order. A `null` ancestor is a cite with no
author and no text. It prints the same `withheld()` as the thread's
placeholder. The replies follow inside the entry as
`comment(reply, "p-comment h-cite")`, with no Reply links. A link to
`threadUrl` ends the page.

## Avatars

A visitor's browser never fetches an avatar from the remote server.
`author.avatar` is a path on this site, under `/_geekity/avatars/`. The CMS
fetches the picture, crops it to an 80-pixel square WebP, and stores it under
`data/avatars/`. 80 pixels is twice the 40 pixels at which the default theme
shows a commenter. Print the path as it is. It needs no filter.

The route serves only the pictures the site shows:

- any follower, because the admin's follower list shows them all
- another actor who has liked, boosted, quoted or answered a post
- the author of an approved comment or webmention

Any other URL returns 404, and the CMS fetches nothing for it.

| Event                                                                            | What the CMS does                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| The site starts, and every six hours after                                       | Fetches pictures in the background.                   |
| A picture is a week old                                                          | Fetches it again.                                     |
| Nothing shows a picture                                                          | Deletes it.                                           |
| A fetch fails, or the picture is over 2 MB or not a JPEG, PNG, GIF, WebP or AVIF | Serves a grey placeholder, and retries an hour later. |

`data/avatars/` is a cache. If you delete it, the CMS fetches every picture
again.
