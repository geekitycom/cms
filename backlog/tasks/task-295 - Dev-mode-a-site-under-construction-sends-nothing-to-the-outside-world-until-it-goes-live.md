---
id: TASK-295
title: >-
  Dev mode: a site under construction sends nothing to the outside world until
  it goes live
status: To Do
assignee: []
created_date: '2026-10-08 11:15'
updated_date: '2026-10-08 11:51'
labels: []
milestone: m-31
dependencies: []
priority: high
ordinal: 255800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Building or migrating a site means running it locally or on staging with production data: the real base URL, the real actor and keys, real followers imported from WordPress, real links in every post. Every outbound side effect the CMS has then reaches real people and servers. That covers ActivityPub Create, Update, Delete and Announce deliveries to followers and relays, a Follow to each configured relay, webmentions to every linked site, rssCloud and WebSub pings (on by default, to rpc.rsscloud.io), IndexNow submissions, and email. Maintenance mode is no guard: it only gates HTTP, and the watcher, deliveries, webmentions, pings and the scheduler all keep running. Today staying quiet means remembering a set of separate switches (webmentionsSend, an empty notifyServer, indexNow, no relays, mail unconfigured, GEEKITY_WATCH=false, and importing followers last), and missing any one of them spams production.

A site needs one mode that holds all outbound side effects until the operator deliberately takes it live, for example when andrewshell.org moves its DNS to the new server. The name, how it is set and how going live works are decisions for this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 While the mode is on, no ActivityPub activity, relay Follow, webmention, rssCloud or WebSub ping, IndexNow submission or email leaves the process, whatever the origin of the change (scan, watch, admin, schedule, resend, reply-context arrival)
- [ ] #2 Read-only fetches the site needs to render (reply contexts, actor profiles, oEmbed) may still go out; the decision names which are allowed and why
- [ ] #3 Each suppressed side effect is recorded with what would have been sent and to whom, so a migration can show it would have been silent; the admin shows the record
- [ ] #4 Going live does not replay anything suppressed while the mode was on
- [ ] #5 The admin shows a persistent banner while the mode is on, and geekity serve logs it at boot
- [ ] #6 The mode can be set before first boot (config or environment, so a Docker site starts in it) and turned off only by a deliberate operator action that is logged
- [ ] #7 Inbound federation (Follow, replies, likes) is still accepted, or refused, as the decision says, and the choice is documented
- [ ] #8 A test boots a site in the mode with followers, relays, webmention targets and mail configured, publishes, edits, schedules and deletes posts, and asserts that no outbound request was made
- [ ] #9 packages/cms/README.md documents the mode in the WordPress cutover steps and in Docker deployment
- [ ] #10 Outbound work a plugin does (for example @geekity/plugin-wordpress federation) is held by the same mode, through the plugin host API, with no plugin-specific switch
<!-- AC:END -->
