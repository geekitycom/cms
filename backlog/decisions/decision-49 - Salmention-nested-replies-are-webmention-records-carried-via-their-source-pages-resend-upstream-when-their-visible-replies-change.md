---
id: decision-49
title: >-
  Salmention: nested replies are webmention records carried via their source;
  pages resend upstream when their visible replies change
date: '2026-10-10 17:12'
status: accepted
---
## Context

A plain webmention never brings a reply to a reply back to the post at the top
of the thread. Salmention (https://indieweb.org/Salmention) closes that when
each site resends upstream on a change and each receiver reads the replies
nested in the source's h-entry. The site needed rules for how nested replies
are stored, what "upstream" means for each kind of page, how to avoid
duplicates, and how to stop two salmention sites looping.

## Decision

- **What is read.** Nested replies come from the source's chosen h-entry: its
  `p-comment` items, and child h-entry or h-cite items whose `in-reply-to`
  names the entry's `u-url`. They are read up to 8 deep and 200 in all. One
  with no http(s) `u-url` is skipped.
- **How it is stored.** Each is its own comment record through
  `intakeComment` with origin webmention: source `webmention`, kind `reply`,
  `url` its own page, `inReplyTo` the carrier or its nested parent, and `via`
  the carrier's source URL. `via` is kept in the comment file and the index.
- **Removal.** A source read again deletes the `via` records it no longer
  carries. A source that is gone, unlinked or discarded takes all of them.
- **Duplicates.** A nested reply on this site's origin is never copied, nor is
  one `replyNamed` already finds, unless this same source brought it. What is
  nested under either still threads under it. A direct webmention from a
  nested reply's page takes over that record and clears `via`.
- **Upstream.** For a reply post, its off-site `in-reply-to` plus the silo
  original (TASK-197). For a native comment's page, the off-site webmention
  reply it answers. Any other page has nothing upstream.
- **Loop bound.** A page sends only when the fingerprint of its visible
  replies differs from the one stored under the admin-state key
  `salmention:{page} {target}`. A missing key counts as no replies, so the
  first publish stays the ordinary webmention. A migrated post starts from the
  replies it arrived with. At most 5 sends per page and target per hour.
- **Trigger.** `AdminStore.onConversationWrite` (comment put or delete,
  activity logged, never a rebuild) plus every content change that is not a
  scan.
- **Markup.** A reply post page prints its replies inside its h-entry as
  `p-comment h-cite`.

## Consequences

- Nested replies get the same moderation, feeds, `/replies/` keys and
  placeholders as any webmention.
- Two salmention sites converge, because what each copies back from the other
  is that site's own and is not stored.
- The ledger is derived state (decision-9). A deleted database costs at most
  one extra send per page.
- Limits:
  - A change past the hourly cap waits for the next change.
  - A failed send is not retried until the replies change again.
  - A comment page does not send when the comment itself first appears or is
    removed.
  - Only the in-reply-to and the silo original are told, not every page the
    post linked to, as the spec suggests.
  - Nested replies are read from the chosen entry only.
  - A comment page's send is recorded under its post's slug in
    `webmentions_sent`, which is keyed by slug and target.
