---
id: decision-41
title: >-
  The WordPress comments import keeps WordPress's comment ids and sources and
  merges by id through a core comment door
date: '2026-10-09 18:27'
status: proposed
---
## Context

TASK-291.3 brings a WordPress site's comments across. With the ActivityPub
and Webmention plugins, `wp_comments` holds fediverse likes, reposts and
replies, webmentions, pingbacks and form comments, told apart by
`comment_type` and a `protocol` comment meta. A Geekity post keeps its
comments in `content/_data/comments/{slug}.json`, a list the live site appends
to, so the import cannot own the file whole (decision-38).

Five choices are not settled by the acceptance criteria: the source and kind
each row becomes, the id it keeps, how a comment WordPress held for moderation
lands, how the plugin writes a file core owns, and what happens to a slug that
cannot name a file.

## Decision

- **Source follows the protocol.** `protocol: activitypub` is `activitypub`, a
  source `COMMENT_SOURCES` gains: the conversation already names a fediverse
  reaction so, and the theme already prints "via the fediverse" for it.
  `protocol: webmention`, a pingback and a trackback are `webmention`. A plain
  comment with no protocol is `comment`. A reaction with no protocol (the
  Bluesky likes on andrewshell.org, carrying an `at://` `source_id`) is
  `webmention`, the source for "somebody elsewhere pointed at this post".
- **Kind follows `comment_type`.** `comment` is a reply, `like` a like,
  `repost` a boost from the fediverse and a repost otherwise, and `mention`,
  `bookmark`, `webmention`, `pingback` and `trackback` are mentions. Another
  type is skipped and named in the report. A like, boost or repost carries no
  words, as one the site receives itself does; WordPress's "… liked this!"
  is dropped.
- **The id is WordPress's comments-feed guid**, `<post guid>#comment-<N>`, so a
  feed reader that polled WordPress's comments feed sees every imported entry
  as one it already has. The theme's Reply link URL-encodes the id, which now
  carries `?` and `#`.
- **`1` is approved, `0` is pending, spam and trash are skipped.** TASK-291.3
  #4 and #7 meet here: a comment WordPress approved is written `approved`, so
  it is never waiting and no digest lists it; one WordPress held is still
  waiting, here as there. The import never goes through the comment intake,
  so nothing is announced: no moderation notice, no reply notice, no delivery.
- **A reply keeps its parent** when the parent is an imported reply. Otherwise
  it hangs under the post and the report says so.
- **The email goes only to `data/`**, and only for a `comment`: the email the
  ActivityPub plugin stores is the remote handle, not an address anybody gave.
- **Core owns the comment file.** `PluginSite.comments(permalink)` reads a post's
  comments by permalink, emails included, and names the file;
  `PluginSite.putComments(permalink, comments)` writes each in place of the entry
  with its id, or after the last, under the file's lock. Core derives the slug
  from the permalink as it does for the post itself, renders the Markdown
  through its restricted comment profile, and splits the email into `data/`.
  The plugin never writes trusted HTML or the file format.
- **The import owns each entry, not the file.** `import.json` records a sha256
  of each comment as last written, by file and id, and each is decided like a
  file (decision-38), with one difference: an entry deleted on this site stays
  deleted, since a moderator removing a comment is no request for WordPress's
  copy. Only the entries to write are passed to `putComments`, so a rerun that
  changes nothing writes nothing, and a comment the site received itself is
  never touched or moved.
- **A comment file is named by the slug percent-encoded**, so a post at
  `/2026/07/i-♥-rss/` has comments in `i-%E2%99%A5-rss.json`. An ASCII slug
  encodes to itself, so no existing file moves.
- **Media URLs in a comment are absolute**, on the site's base URL, since the
  comment profile publishes no relative link.

## Consequences

- An imported fediverse reaction is a comment record, not an inbox log line:
  it shows in the facepiles and threads as one received live would, but a
  later `Undo` of that like from the remote server finds nothing to withdraw.
- A moderator can approve, spam or delete an imported comment like any other;
  the next import leaves that decision alone and reports it as kept or as a
  conflict.
- The site-wide comments feed lists likes and boosts it holds as records, as
  it does any native one; each carries WordPress's guid.
- A comment id is now a URL for imported comments, so a theme that prints an
  id into a URL must encode it, as the packaged theme does.
