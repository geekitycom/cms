---
id: decision-35
title: >-
  Dev mode holds every outbound side effect until the operator takes the site
  live; reads still go out and inbound is accepted
date: '2026-10-09 15:44'
status: accepted
---
## Context

TASK-295. Building or migrating a site means running it with production data: the real base URL, the real actor and keys, followers imported from WordPress, real links in every post. Every outbound side effect then reaches real people. Before this, staying quiet meant remembering a set of separate switches (`webmentionsSend`, an empty `notifyServer`, `indexNow`, no relays, mail unconfigured, `GEEKITY_WATCH=false`, followers imported last). Maintenance mode is no guard: it gates HTTP only.

## Decision

**Name and state.** The mode is called dev mode. It is a file, `data/dev-mode.json`, as maintenance mode is (TASK-130): operational state, not content, so it never travels with `content/`. The file being there is the mode being on. A file that cannot be parsed still counts as on.

**Turning it on.** `devMode: true` in the config, or `GEEKITY_DEV_MODE=true`, makes boot write the file, so a Docker site starts in the mode. `geekity dev-mode on` writes it too. The file latches the mode: a lost environment variable does not take a site live.

**Going live.** Only `geekity dev-mode off` removes the file. It refuses while the config or the environment still asks for dev mode, because the next boot would turn it back on. The running site reads the file on every outbound check, so going live needs no restart.

**What is held.** Every sender asks `holdOutbound` in `packages/cms/src/dev-mode.ts` before it touches the network:

- ActivityPub: every delivery to followers and relays (`Create`, `Update`, `Delete`, `Announce`, `Like`, `Undo`, `Add`, `Remove`, an actor `Update`), whether the change came from the watcher, the admin, the scheduler, a resend or a reply context arriving; the relay `Follow` and `Undo`; and the `Accept` or `Reject` an inbox handler answers with.
- Webmentions, before endpoint discovery, so a target is not even fetched.
- The rssCloud and WebSub ping. One notify server takes both, so it is one ping.
- IndexNow submissions.
- Email, before the provider is called.

**The record.** Each held effect is appended to `data/dev-mode.jsonl` as `{"type":"held","at","kind","what","to"}`: the kind, what would have been sent (an activity's type and object, the source URL, the feed URLs, the subject) and to whom (inboxes, targets, the endpoint, addresses). Entering and leaving the mode are lines in the same file, so going live is logged. Tools > Dev mode lists the record, newest first, and the admin shows a banner on every screen while the mode is on.

**Nothing is replayed.** A held effect is dropped, not queued. No delivery row and no sent-webmention row is written for it, so neither the Federation screen nor `geekity resend` sees it as failed. A post that is announced still gets its `activitypub.published` stamp, so the first edit after going live is an `Update`, not a fresh `Create` of an old post. A relay followed during the mode is left pending with a reason, and Retry on the Federation screen sends its `Follow` once the site is live.

**Reads still go out.** GET requests the site needs to render, or to understand what it receives, are allowed: reply contexts and cited pages, actor profiles and the document loader's fetches, oEmbed, avatars, the check of an incoming webmention's source, and a plugin's `host.fetch`. A read changes nothing at the other end and tells nobody about the site. Without them a site under construction could not show its replies, profiles or embeds. Calls that answer only the site, such as the Akismet check and an LLM plugin's request, are allowed for the same reason.

**Inbound is accepted.** Follows, replies, likes and webmentions are stored as on a live site. A site in dev mode is rarely at its public address, so what does arrive is real and worth keeping. The `Accept` a `Follow` would get is held and recorded like any other outbound activity, so the record shows who is waiting.

**Plugins.** The plugin host API has no outbound write of its own. A plugin's federation hands what it receives to the site's inbox handlers through `receive`, so any reply goes through the same check, and `@geekity/plugin-wordpress` needs no switch of its own. `host.fetch` is GET-only and counts as a read.

## Consequences

- A migration can prove it was silent: run the import in dev mode and read `data/dev-mode.jsonl` or Tools > Dev mode. TASK-291's AC#8 is checked against that record.
- A peer that followed during the mode never received an `Accept`, and its server shows the follow as pending. It has to follow again after the site is live.
- Password recovery mail is held too. A site in dev mode resets passwords from the shell.
- A new outbound sender has to call `holdOutbound` before it sends. `src/dev-mode-site.test.ts` boots a site in the mode with a follower, a relay, a webmention target, IndexNow and mail, and fails on any request that leaves the process.
- The record grows with every held effect and is never trimmed. Deleting it loses only the history.
