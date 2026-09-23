---
id: decision-18
title: >-
  A reply federates as a Note with inReplyTo, and a title of its own goes at the
  top of its content
date: '2026-09-23 13:07'
status: accepted
---
## Context

TASK-121 makes a post with a valid `in-reply-to` a reply, ahead of the note/article tail of Post Type Discovery. Section 6 of that note maps a reply to "`Note` with `inReplyTo`". A reply can still have a title of its own, one its text does not open with, and a long answer with a real title reads like an article.

decision-17 records how Mastodon reads the two types. It never reads `name` on a `Note`, and it drops an `Article`'s `content` for its `name`, `summary` and link. So sending a titled reply as a bare `Note` would lose the title, and sending it as an `Article` would show a reply as a title and a link, where a reader in a thread expects the words.

## Decision

A reply is a `Note`, titled or not, as section 6 says. The type is decided by what the post is, a reply, and not by whether it has a name.

The title is not lost. decision-17 already puts a title the text does not open with at the top of a `Note`'s `content`, as its own paragraph, and a titled reply goes out the same way.

`inReplyTo` is on the object whichever type it is. An author who wants a titled reply to go out as an `Article` sets `activitypub.type: Article`, and the thread still holds, because the override changes the type and nothing else.

## Consequences

- A reply threads in Mastodon under the post it answers, with its full text in the status, and the title as its first line when it has one.
- The rule is one row in the object-type table, `reply: 'Note'`, with no branch on the title.
- A theme heads a post with its title by whether the post has a name of its own (`named` on the context), not by its type, because a reply can be either.
- If a titled reply ever needs to be an `Article` by default, this is the decision to revisit, and the change is that one row plus a test.

