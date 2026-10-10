---
id: decision-47
title: >-
  A signed-in user's reply in a thread is a reply post shown inline; comments
  are what others say
date: '2026-10-10 14:31'
status: accepted
---
## Context

A signed-in owner's reply in a thread was stored as a native comment. It never
left the site: no ActivityPub activity and no webmention. The form could only
answer native comments, so a webmention or fediverse reply could not be
answered from the thread at all.

## Decision

A comment is what somebody else says on the site: a visitor through the form,
a webmention, a fediverse reply. A post is what a signed-in user says.

- A signed-in user's reply from the thread is a reply post, one record, saved
  through the write path the editor and Micropub share.
- Its `in-reply-to` is what it answers: a native comment's page, a
  webmention's sender URL, a fediverse note's id, a reply post's permalink, or
  the post.
- The thread shows it inline where a comment would have been. The
  conversation reader finds served reply posts whose `in-reply-to` names the
  post or any entry under it. What is said under a reply post threads under it
  in the original thread.
- The form's "Include in posts and feeds" checkbox is unchecked by default.
  Ticked makes the reply post public. Unticked makes it unlisted. Either way it
  reaches whoever it answers.
- Existing owner comments stay comments.
- A visitor's reply stays a native comment and sends nothing over
  ActivityPub, because a visitor has no actor.

## Consequences

- A reply post is a post. It has its own page, federates as a `Create`
  (addressed to the note's author for a fediverse reply), and sends a
  webmention to a webmention's sender. When public, it is in the listings and
  post feeds.
- Public or unlisted, it appears once in its thread's comments feeds, because
  those feeds list the thread, not the site's listings.
- A reply post citing a reply this site holds takes its reply context from the
  index, not an HTTP fetch.
- Reading a thread also queries the content index for reply posts, so
  `in_reply_to` is indexed (content migration 9).
- Replies written on the moderation screen are still comments. TASK-326
  brings them into this model.
