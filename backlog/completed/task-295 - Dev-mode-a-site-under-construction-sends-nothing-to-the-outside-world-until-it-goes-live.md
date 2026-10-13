---
id: TASK-295
title: >-
  Dev mode: a site under construction sends nothing to the outside world until
  it goes live
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:15'
updated_date: '2026-10-09 15:53'
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
- [x] #1 While the mode is on, no ActivityPub activity, relay Follow, webmention, rssCloud or WebSub ping, IndexNow submission or email leaves the process, whatever the origin of the change (scan, watch, admin, schedule, resend, reply-context arrival)
- [x] #2 Read-only fetches the site needs to render (reply contexts, actor profiles, oEmbed) may still go out; the decision names which are allowed and why
- [x] #3 Each suppressed side effect is recorded with what would have been sent and to whom, so a migration can show it would have been silent; the admin shows the record
- [x] #4 Going live does not replay anything suppressed while the mode was on
- [x] #5 The admin shows a persistent banner while the mode is on, and geekity serve logs it at boot
- [x] #6 The mode can be set before first boot (config or environment, so a Docker site starts in it) and turned off only by a deliberate operator action that is logged
- [x] #7 Inbound federation (Follow, replies, likes) is still accepted, or refused, as the decision says, and the choice is documented
- [x] #8 A test boots a site in the mode with followers, relays, webmention targets and mail configured, publishes, edits, schedules and deletes posts, and asserts that no outbound request was made
- [x] #9 packages/cms/README.md documents the mode in the WordPress cutover steps and in Docker deployment
- [x] #10 Outbound work a plugin does (for example @geekity/plugin-wordpress federation) is held by the same mode, through the plugin host API, with no plugin-specific switch
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: data/dev-mode.json (present = on, {since}) and data/dev-mode.jsonl (append-only record: on, off, held {kind, what, to}). src/dev-mode.ts owns both: devModeOn(config), enterDevMode, leaveDevMode, holdOutbound(config, effect) -> boolean, readDevModeRecord.
2. Config devMode + GEEKITY_DEV_MODE; createCms enters the mode at boot when set (before relays.sync), so a Docker site starts in it. The file latches it: losing the env var does not take a site live.
3. One gate per outbound sender, before any network: delivery fanOut (Create/Update/Delete/Announce/Like/Undo/Add/Remove, actor Update), relay Follow/Undo, inbox Accept/Reject replies, webmention tellAll + originalFound (before endpoint discovery), feed notifier ping (rssCloud + WebSub share one server), IndexNow submit, mail deliver. Held sends are dropped, not queued, so going live replays nothing; post stamping still happens so a later edit is an Update.
4. geekity dev-mode on|off|status; off refuses while config/env forces it, appends an off entry to the record and prints it. geekity serve prints a line at boot when on.
5. Admin: warning banner on every shell screen while on; Tools > Dev mode lists the record.
6. decision-35: name, switch, allowed reads (GET fetches: reply contexts, actor profiles, oEmbed, avatars, plugin host.fetch, incoming webmention verification, Akismet/LLM calls that answer the site), inbound accepted with replies held, plugin outbound held via core.
7. Tests first per AC: unit tests for each gate, CLI test, admin banner/screen test, and an end-to-end test booting a dev-mode site with followers, relays, webmention targets and mail that publishes, edits, schedules and deletes and asserts no outbound request.
8. README: WordPress cutover steps and Docker deployment.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned (decision-35). Every outbound sender calls holdOutbound (src/dev-mode.ts) before touching the network: delivery fanOut (all post and actor activities, so every origin is covered), relay Follow/Undo, inbox Accept/Reject replies, webmention tellAll/originalFound (before endpoint discovery), the notify ping (rssCloud and WebSub share one server), IndexNow batches, and mail deliver. DeliveryReport and MailResult gained a held flag so the resend flash, geekity resend and Send test email say 'held' instead of 'nobody follows' or 'no mail configured'.

State: data/dev-mode.json present = on; existsSync, so an unreadable file still counts as on (a comment review caught that the first version read it as off; fixed with a chmod 000 test). Record: data/dev-mode.jsonl, lines {type:on|off|held}. GEEKITY_DEV_MODE/devMode latch the file at boot; geekity dev-mode off refuses while either is still set. A server process started with the variable stays held until restarted without it (README says so).

For TASK-291 AC#8: run the import with the mode on and read held entries of kind activitypub in data/dev-mode.jsonl (or Tools > Dev mode); readDevModeRecord(dataDir) gives them to a test.

Validation: pnpm build, test (cms 5124+ pass, all packages 0 fail), typecheck, lint, format:check all clean. Live check: geekity serve with GEEKITY_DEV_MODE=true printed the boot line; curl showed the banner on /admin and the record on /admin/tools/dev-mode; publishing a post with an external link held a webmention and the rpc.rsscloud.io ping; dev-mode off refused with the variable set, succeeded without it, and a restart without the variable showed no banner and a 'Went live' row. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added dev mode: devMode / GEEKITY_DEV_MODE or geekity dev-mode on latches data/dev-mode.json, and while it exists every ActivityPub delivery, relay follow, inbox reply, webmention, rssCloud/WebSub ping, IndexNow batch and email is recorded in data/dev-mode.jsonl instead of sent. Reads still go out and inbound is accepted (decision-35). geekity dev-mode off is the only way live, refused while the config still asks for the mode, and logged. Nothing held is replayed. The admin shows a banner and Tools > Dev mode lists the record, geekity serve logs the mode at boot, and the package README covers the cutover and Docker. Verified with new tests (dev-mode-site.test.ts boots a site with a follower, relay, webmention target, IndexNow and mail and asserts zero outbound requests across publish, edit, schedule, resend and trash), the full gate run, and a live geekity serve checked with curl.
<!-- SECTION:FINAL_SUMMARY:END -->
