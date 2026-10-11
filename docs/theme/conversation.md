# The conversation

`conversation` is what has been said about a post: the fediverse replies, likes
and boosts its inbox was sent, the fediverse posts that quoted it with its
author's approval, the comments people left on the page itself, and the
webmentions other pages sent it.
It is on the context of a rendered post **only when there is something in it**,
so a post nobody has answered renders no empty section and a layout can simply
ask:

```njk
{% if conversation %}
{% include "partials/conversation.njk" %}
{% endif %}
```

That is what `layouts/post.njk` does, and `layouts/page.njk` with it.

A page takes part only while it takes comments: when its front matter says
`comments: true` and the site has not switched comments off. A page is closed
by default, as WordPress closes them, and the CMS leaves `conversation` off the
context of a closed page however much has been approved against it, so a page
that turns comments off shows nothing. A post is different: it keeps its thread
after it closes. Webmentions to a page are received and moderated either way,
exactly as webmentions to a post are, and appear once the page opens.

`partials/conversation.njk` is the whole
section — a `div.reactions-section` of the likes, the boosts and the mentions
as facepiles grouped by kind, and then the thread as
`div#comments.comments-area` — and a site replaces it with a
`partials/conversation.njk` of its own in the theme it wears, exactly as it
replaces any other template. It defines two macros, `face(item, icon, href)`
and `group(items, label, kind, icon, source)`, and a layout that wants to place
the pieces itself can import them:

```njk
{% import "partials/conversation.njk" as reactions with context %}
{{ reactions.group(conversation.likes, "Likes", "p-like", "❤️") }}
```

One reply and everything under it is `comment(reply, classes)` in
`partials/comment.njk`, which the thread and a comment's own page both import.
`classes` is the reply's microformat: `h-entry`, the default, under a post, and
`p-comment h-cite` on a comment's page, where the comment is the one entry.

A reply post prints its replies inside its own `h-entry`, as `p-comment
h-cite`s, so the page it answers finds them there when it is sent a salmention
(TASK-320). `layouts/post.njk` includes `partials/conversation.njk` twice for
one, setting `conversationPart`: `"replies"` inside the entry for the thread,
and `"reactions"` below it for the facepiles, whose links are not the entry's.
Left unset, the partial prints the whole section.

## The shape

The conversation is deliberately **not** spelled in ActivityPub's vocabulary.
Native comments and webmentions land in the same thread, so every
entry says where it came from and what it is, and nothing else about it changes
with the source. A theme that never looks at `source` renders all of them
correctly; one that does can style them apart. The one thing a theme does have
to look at is `kind`: a `mention` is in `conversation.mentions` rather than in
the thread, because it is not an answer.

| Key                                                | What it holds                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `replies`                                          | The replies to the post, oldest first, each carrying its own `replies`. See below.                                      |
| `likes`                                            | The likes, oldest first, in the same shape.                                                                             |
| `boosts`                                           | The boosts, oldest first, in the same shape. A webmention `repost` is one of them.                                      |
| `mentions`                                         | The pages and fediverse quotes about this post, oldest first, in the same shape.                                        |
| `rsvps`                                            | An event's answers, each group `{ value, label, people }`, going, maybe, interested, not going, only with people in it. |
| `counts.replies`                                   | How many replies, counted through the whole thread rather than the top of it.                                           |
| `counts.likes`, `counts.boosts`, `counts.mentions` | How many of each.                                                                                                       |
| `counts.rsvps`                                     | How many people answered an event, in every group.                                                                      |
| `counts.total`                                     | All of them added up. Zero never reaches a template: there would be no `conversation` at all.                           |

Each entry — a reply, a like or a boost — is:

| Key               | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | What it is called: a fediverse reply's note id, a reaction's activity id, a stored comment's key. It is what an answer to it names.                                                                                                                                                                                                                                                                                                                                                   |
| `key`             | Its key (decision-51): 16 lowercase hex digits, the comment's id for one stored on the site and the key of its guid for anything else. Its anchor is `#comment-{key}` and its replies feed `/replies/{key}/`.                                                                                                                                                                                                                                                                         |
| `guid`            | What the comments feeds call it: a native comment's `/comment/{key}/` page, a stored comment's origin (else its `url`), a fediverse note's id, a reply post's object id.                                                                                                                                                                                                                                                                                                              |
| `migrated`        | `true` for a comment imported from the site this one replaced (decision-51). It shows like any other, but no feed carries it and no count a feed advertises includes it.                                                                                                                                                                                                                                                                                                              |
| `source`          | `"activitypub"` for a fediverse reply, `"comment"` for one left on the page, `"webmention"` for another page linking here, `"post"` for a reply post a user of the site wrote (its `url` is the post's permalink).                                                                                                                                                                                                                                                                    |
| `kind`            | `"reply"`, `"like"`, `"boost"`, `"repost"` or `"mention"`. A `repost` comes from a webmention; a `mention` is a webmention or an approved fediverse quote.                                                                                                                                                                                                                                                                                                                            |
| `author.name`     | The best name available: their display name, else their handle, else their server, else their id. For a webmention, the source's `h-card` name, else its host.                                                                                                                                                                                                                                                                                                                        |
| `author.handle`   | `@user@host`, or `null`. Taken from the follower or actor profile the site holds, else guessed from the actor URL unless it ends in a number. `null` for a native comment.                                                                                                                                                                                                                                                                                                            |
| `author.url`      | Their profile page, the website a commenter typed, or a webmention author's `u-url`. May be `null`, so guard the link.                                                                                                                                                                                                                                                                                                                                                                |
| `author.avatar`   | Their avatar, or `null`. The site knows one for a fediverse actor whose profile it holds or whose imported comment brought their icon, and for a webmention whose `h-card` carried a `u-photo`. Always a same-origin `/_geekity/avatars/…` path, never the remote URL: see [Avatars](#avatars).                                                                                                                                                                                       |
| `author.actorId`  | Their id, which is what identifies them however they are named. `null` for a native comment, and for an imported one whose actor the export did not name.                                                                                                                                                                                                                                                                                                                             |
| `author.username` | The site user they are, or `null`: whoever wrote a reply post, or the user a comment imported from the site this one replaced names (a WordPress comment written signed in). Such a comment's `author` is that user's, as a reply post's is: their display name, avatar and author archive.                                                                                                                                                                                           |
| `url`             | Where it can be read: the remote note's `url` for a fediverse reply or quote, the source page for a webmention, and `/comment/{key}/`, its own page, for a native comment (see [A comment's own page](#a-comments-own-page)).                                                                                                                                                                                                                                                         |
| `content`         | What it says, **already sanitised**, so print it with `\| safe`. Empty for a like or a boost.                                                                                                                                                                                                                                                                                                                                                                                         |
| `published`       | A `Date`: when it was published, or when it arrived if it did not say. Use the `date` filter.                                                                                                                                                                                                                                                                                                                                                                                         |
| `inReplyTo`       | What it answers — the post's ActivityPub id, or another reply's — and `null` for a reaction.                                                                                                                                                                                                                                                                                                                                                                                          |
| `status`          | `"published"`. On the record for the sources that moderate.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `replies`         | The replies to this one, oldest first, nested as deep as the site has seen. One may be a placeholder: see below.                                                                                                                                                                                                                                                                                                                                                                      |
| `rsvp`            | An RSVP: `{ value, label }`, its `p-rsvp` (`yes`, `no`, `maybe` or `interested`) and the words for it. Absent otherwise. A webmention reply that is an RSVP carries one, and the default theme prints it as a `data.p-rsvp` at the top of the comment's content. On an event, an RSVP is in `rsvps` rather than the thread, and so is a fediverse `Accept` (`yes`), `TentativeAccept` (`maybe`) or `Reject` (`no`) of the event. Each person is there once, with their latest answer. |

Four rules decide what is in the thread, and they are the CMS's rather than a
theme's: a reply whose author deleted it is gone, and its own answers move up to
whatever it was answering; a comment a reader may not see (waiting for a
moderator, spam or deleted) that has a visible reply under it is a placeholder,
and one with none is not there at all; a like is counted once per actor,
so an imported like and the same actor's like
delivered here are one, and it disappears when that actor undoes it; and a note answering something this post
has nothing to do with is left out.

A fediverse reply or reaction imported from the site this one replaced is
shown once, however often its server sends it again or the reply backfill
reads it: the imported comment is the one in the thread, with the moderator's
decision on it, and the answers to its note thread under it.

A placeholder in `replies` is `{ id, withheld: true, replies }`: the hidden
comment's id and the replies under it, and nothing that names its author or
says what it said. Test `reply.withheld` before printing an author. A pending
or spam comment's placeholder sits where the comment would; a deleted one's
under the post, since nothing is known of what it answered. `counts.replies`
and the comments feeds count and carry the visible replies only.

`content` is safe to print whatever produced it, and safe for different reasons.
A fediverse reply is HTML somebody else's server composed, rebuilt from an
allowlist — `a`, `p`, `br`, lists, `blockquote`, `pre`, `code` and the inline
emphasis tags, with every link carrying `rel="nofollow noopener noreferrer"`. A
webmention's `e-content` goes through the same allowlist. A native comment is
Markdown the commenter typed, rendered with raw HTML off, no images embedded,
and every link carrying `rel="nofollow ugc"`. Nothing else survives any of the
three routes, so a theme may print all of them directly.

The packaged partial draws each entry as the source design does: an
`li.comment.h-entry` carrying `id="comment-{{ reply.key }}"` and a
`comment-{{ reply.source }}` class, holding an `article.comment-body` whose
`footer.comment-meta` is the author as a `.comment-author.vcard.p-author.h-card`
(their avatar, or the first letter of their name in a `span.comment-avatar-empty`
when there is none, and their link marked `rel="nofollow ugc"` unless `author.username` says the
author is a user of the site, as a reply post's author is) and the permalink as a `.comment-metadata` link around a
`time.dt-published`, with a `span.comment-source` saying "via webmention" or
"via the fediverse" when it came that way, then the words in
`div.comment-content.e-content`. Answers nest in an
`ol.children` inside what they answer. A Reply link in a `div.reply` goes on the
ones written here — `source == "comment"` — when the post is still open; it
carries the comment's key to the form as `?reply_to=`, so threading needs no
JavaScript. A fediverse reply is answered on the server that holds it and a
webmention on the page that sent it, so neither gets one. A placeholder is an
`li.comment.comment-placeholder` with the hidden comment's anchor, a
`p.comment-withheld` printing `withheld()` ("This comment is no longer
shown."), and its replies in an `ol.children`; it is no microformat of its own.

Above the thread, `group()` draws one `div.reaction-group` per kind that has
anything — `p-like`, `p-repost` and `p-mention`, the source theme's classes — as
an `h2.reaction-title` of the label and the count, in a `span.reaction-count`,
beside a `div.facepile` of
`a.u-url` faces. A face is a round `u-photo` avatar; a reaction whose author the
site knows no picture of is the emoji badge of its kind and a `.reaction-name`
instead. Likes and boosts link to the person, and a mention to the page it came
from, because the page is the thing worth reading.

There is no key saying a post has stopped taking comments, and none is needed:
**the absence of `commentForm` is what a closed post looks like**, since the CMS
puts the form on the context only while the site switch, the closing window and
the post's own front matter all agree it is open. The packaged partial prints
`p.no-comments` under a thread when there is no form, which is WordPress's
"Comments are closed." and the reason a reader cannot find one.

An Eleventy build of the same content gets the same thing from the same files:
`docs/eleventy.config.example.js` adds a `conversation` filter over
`federation.inbox`, and puts the post's ActivityPub id on the context as
`activityStreams` and its slug as `geekitySlug`, so a layout reads

```njk
{% set conversation = federation.inbox | conversation(activityStreams, geekitySlug) %}
```

and then loops over exactly the keys above. The slug is what names the post's
comment file under `content/_data/comments/`; the format is documented in
backlog doc-6. Two things differ: a native comment's `url` is its
`#comment-{key}` anchor, because a static build writes no comment pages, and
the site's own reply posts (`source: "post"`) are not in the thread.

## A comment's own page

A comment left through the form has a page of its own at `/comment/{key}/`,
which is its `url` everywhere: the thread's permalink, the comments feeds and
what another site fetches when it replies to the comment. The anchor
`#comment-{key}` on the post stays, so an old link still scrolls to it. A
webmention and a fediverse reply have no such page: their `url` is where they
came from.

`layouts/comment.njk` draws it, with the comment as the page's one `h-entry`.
It answers only while the post shows its conversation, and is `noindex` and on
no list: not the sitemap, the post feeds or search. Its context:

| Key         | What it holds                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comment`   | The comment, an entry of the shape above, its `replies` nested at every depth by the thread's own rules.                                                                                      |
| `ancestors` | What it answers, from the top-level comment down to its parent. An ancestor a reader may not see (waiting for a moderator, spam, deleted, withdrawn) is `null`, so the chain keeps its place. |
| `post`      | The post it is on, as a listing entry is: `label`, `url`, `date`, `summary`, `author` and the rest.                                                                                           |
| `threadUrl` | The comment's anchor on the post, for a link back to the whole conversation.                                                                                                                  |

The packaged layout prints the chain above the comment as nested
`u-in-reply-to h-cite`s: the comment cites its parent, which cites its own,
down to the post, which is printed first, so a parser and a reader meet the
thread in the same order. A `null` ancestor is a cite with no author and no
words, printing the same `withheld()` the thread's placeholder does. The replies follow inside the
entry as `comment(reply, "p-comment h-cite")`, with no Reply links, and a
link to `threadUrl` ends the page.

## Avatars

A reader's browser never fetches a face from the server it lives on. The
`author.avatar` a theme is handed is a path on this site, under
`/_geekity/avatars/`, and the CMS fetches the picture, crops it to an
80-pixel square WebP (twice the 40 pixels this theme shows a commenter at)
and keeps it under `data/avatars/`. Print it as it is; it needs no filter.

The route serves only the pictures the site shows: a follower who has
liked, boosted, quoted or answered a post, and the author of an approved
comment or webmention. Any other URL is a 404, and nothing is fetched for it.
Pictures are fetched in the background when the site starts and every six
hours after, refreshed once they are a week old, and forgotten once nothing
shows them. A picture that cannot be fetched, is over 2 MB, or is not a JPEG,
PNG, GIF, WebP or AVIF is served as a grey placeholder, and tried again an
hour later. `data/avatars/` is a cache: delete it and every picture is fetched
again.
