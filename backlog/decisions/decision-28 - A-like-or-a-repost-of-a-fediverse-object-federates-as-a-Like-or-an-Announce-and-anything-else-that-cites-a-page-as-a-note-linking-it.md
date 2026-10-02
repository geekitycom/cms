---
id: decision-28
title: >-
  A like or a repost of a fediverse object federates as a Like or an Announce,
  and anything else that cites a page as a note linking it
date: '2026-10-02 16:53'
status: accepted
---
## Context

TASK-169 adds like, repost and bookmark posts: `like-of`, `repost-of` and `bookmark-of` in the front matter, each one URL. Every post federates today as a `Create` of a `Note` or `Article` to its author's followers, an `Update` on an edit and a `Delete` of a `Tombstone` when it stops being published. A like or a repost of a fediverse status means something a peer already understands: Mastodon shows a `Like` as a favourite on the status and an `Announce` as a boost. A note saying "Liked this" does neither, and a `Like` of a page with no ActivityPub form means nothing to anyone.

Whether a target is a fediverse object is not visible in its URL. It has to be fetched with ActivityPub's media type, and a status's page (`/@carol/1`) and its id (`/users/carol/statuses/1`) are usually two URLs.

## Decision

- A **like** whose `like-of` resolves to a fediverse object federates as a `Like` of that object, named by the id its server gives it. A **repost** whose `repost-of` resolves federates as an `Announce`. The lookup is `context.lookupObject`, signed as the post's author, as an authorized-fetch server needs. An actor, a page with no ActivityPub form and a host that does not answer all count as no object.
- The activity goes to the author's followers and relays, as every activity does, and to the inbox of the object's author. A `Like` is addressed to that author and copied to the followers. An `Announce` is public and copied to the followers and the author.
- The activity id is the post's object id with the fragment `#like/{object id}` or `#announce/{object id}`, so the same like sent again is the same activity, and a like moved to another target is a new one.
- When the post stops being published, an `Undo` of the activity takes it back. An edit that leaves the cited object the same sends nothing, because a `Like` has no content to update. An edit that changes the target, or that turns a like into a note or a note into a like, withdraws the old form (`Undo` or `Delete`) before the new one goes out (`Like`, `Announce` or `Create`). A resend sends the same activity again.
- **Anything else that cites a page** federates as the `Note` or `Article` it already is. That covers a bookmark, even of a fediverse status, and a like or repost whose target is no fediverse object. Its content opens with one line per citation, such as `Liked <a href="…">…</a>`, so a follower sees what it cites. Post Type Discovery maps like, repost and bookmark to `Note`. The object served at a like's permalink is that `Note` too.
- Nothing is recorded in the file about which form went out. Which form a post takes is worked out from the post as it reads, each time it is delivered (decision-9).

## Consequences

- A like or repost delivery fetches the target, and on a withdrawal or an edit it fetches the previous version's target too. Posts of every other type never touch the network to decide their form.
- When a target stops answering between the like and its withdrawal, the post is taken for a note and a `Delete` of a `Tombstone` goes out instead of the `Undo`, so the remote favourite stays. The fix would be to record the resolved object id in the file, which this decision leaves out until it is needed.
- The outbox still lists every post as a `Create` of its object. A peer reading the outbox sees a like as the note that links its target, not as the `Like`.
- A bookmark never federates as an activity of its own. ActivityStreams has no bookmark activity that Mastodon or other servers act on.
