---
id: decision-46
title: >-
  A visible reply under a hidden comment is shown everywhere, under a
  placeholder
date: '2026-10-10 14:04'
status: accepted
---
## Context

A native comment can be pending, spam or deleted while a reply to it is
approved: a moderator approves the reply first, then files the parent as spam
or deletes it. Since TASK-319, a received webmention threads under the comment
it answers whatever that comment's status.

Before TASK-325 the post's thread and its comments feed dropped such a reply,
because `threadOf` walked from visible parents only. `/comments/feed/` listed
it anyway, and since TASK-318 the reply had its own `/comment/{id}/` page whose
link to the thread pointed at an anchor the post never printed. Four surfaces
disagreed about one reply.

## Decision

Show the approved reply everywhere, under a placeholder for its hidden parent,
matching what the comment page already did for a hidden ancestor.

- The thread on the post prints the placeholder with no author and no words,
  in the comment page's wording, "This comment is no longer shown." It keeps
  the hidden comment's `#comment-{id}` anchor and nests the visible replies
  under it.
- A pending or spam comment's placeholder goes where that comment's
  `inReplyTo` says. A deleted comment is known by nothing, so its placeholder
  goes under the post.
- A hidden comment with no visible descendant prints nothing.
- Both comments feeds list the visible reply. The placeholder is never a feed
  item.
- Comment counts count visible replies only.

## Consequences

- The thread, both comments feeds, the comment pages and the counts are one
  reading in `ConversationReader`.
- A theme's `replies` can hold a `{ id, withheld: true, replies }` entry. A
  custom `partials/conversation.njk` or `comment.njk` that prints
  `reply.author` unguarded prints an empty author for a placeholder. The theme
  README documents the shape.
- Hiding a comment no longer silences an approved answer to it. Removing that
  answer takes moderating the answer itself.
- A reply under a fediverse note its author withdrew keeps the older move-up
  rule, because a withdrawal is the author's retraction, not a moderator's.
