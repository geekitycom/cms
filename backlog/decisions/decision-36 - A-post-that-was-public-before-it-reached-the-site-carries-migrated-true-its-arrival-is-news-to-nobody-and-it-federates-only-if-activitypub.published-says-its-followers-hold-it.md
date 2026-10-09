---
id: decision-36
title: >-
  A post that was public before it reached the site carries migrated: true; its
  arrival is news to nobody and it federates only if activitypub.published says
  its followers hold it
date: '2026-10-09 16:08'
status: accepted
---
## Context

TASK-296. Federation decided `Create` against `Update` from the SQLite index alone: a federated post with no previous row was a `Create`, and only the boot scan was skipped. A migrated archive could therefore be announced to followers as new by a file written while the watcher ran, by a scheduler whose watermark was older than the imported posts, by `geekity resend`, and an edit or a reply context arriving sent an `Update` for posts the followers never had. Webmentions, feed pings and IndexNow followed the same index events, so the same paths sent them too.

A migrated site knows which of its posts its readers have already seen. On andrewshell.org WordPress federated 21 of 160 posts; the other 139, essays from 2004 to 2025, were never sent, and 63 of them come back as drafts to be published later. That knowledge has to live in the post's file, so it survives a rebuilt database and a fresh `data/` (decision-9).

## Decision

**Two facts, two keys.** `migrated: true` says the post was public somewhere else before it reached this site. `activitypub.published` keeps its meaning: the followers hold the post, and since when. An importer writes `migrated: true` on every post it brings over and `activitypub.published` (with the `activitypub.id` the followers know it by) only on the ones that federated. Nothing in the CMS writes `migrated`, and the rule names no CMS a post came from: `src/content/migrated.ts` owns it.

**Arrival is news to nobody.** A change that only brings a migrated post into public view (its file appearing, a draft published, a scheduled date passing; any change whose previous version was not served) sends no activity, webmention, feed ping or IndexNow submission, and stamps nothing. A change to a version that was already public is a real edit and goes out as any edit does: webmentions, pings and IndexNow as today, and an `Update` when the post was announced.

**Federation follows the stamp.** A migrated post with `activitypub.published` is an announced post: an edit sends one `Update`, taking it down sends a `Delete`, a resend sends an `Update`, and a newly stored reply context revises it. A migrated post without one is never federated by any path: no `Create`, `Update` or `Delete`, a resend answers that there is nothing to send, and `citedPageStored` never reaches it, because it reads only the announced posts. Its object is still served to a peer that fetches its id, and it stays in the outbox, which is read rather than sent.

**Original-post discovery is quiet too.** When a migrated reply's context finds that the silo copy it answers has an original, that original is not sent a webmention: the reply was not sent anything when it was first public here either.

**The scheduler has a floor.** The instant the scheduler first ran on a site is kept beside its watermark (`schedule.firstRun` in `cms_state`), and a run never releases a post dated before it, whatever the watermark says. A site upgrading into this rule records its first run on the first boot, so a watermark left from an older database cannot open the window onto an imported archive.

**Posts first published here are untouched.** Without `migrated`, every path behaves exactly as before, including a `Create` when a withdrawn post is restored.

## Consequences

- `@geekity/plugin-wordpress` and any later importer only write front matter; the quiet behaviour is core's.
- A site upgrading to this version loses the one-time catch-up of a scheduled post that came due while it was down across the upgrade, since the scheduler's first run is recorded then.
- A migrated draft published with an edit in the same save is still an arrival and stays quiet; the next edit is the first one that goes out.
- Removing `migrated` from a file makes the post an ordinary one: an unannounced post would then be sent to its followers, and stamped, on its next edit.
