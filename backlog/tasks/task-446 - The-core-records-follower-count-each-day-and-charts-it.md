---
id: TASK-446
title: The core records follower count each day and charts it
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-20 23:32'
labels:
  - dashboard
  - federation
milestone: m-41
dependencies:
  - TASK-444
references:
  - packages/cms/src/store/schema.ts
  - packages/cms/src/files/data-files.ts
priority: medium
ordinal: 383800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The followers table holds only the current set, so an unfollow leaves no trace and follower history cannot be charted. Record a daily snapshot (count, plus follows and unfollows that day) and chart it on the dashboard.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A follow and an unfollow each update that day record, and a day with no change still has a count
- [x] #2 The record survives restarts and is included in a site export according to its declared data class
- [x] #3 A core widget charts follower count over the last 30 days, and shows gained and lost for the period
- [x] #4 A site with no history yet starts from the current count instead of drawing a misleading drop from zero
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Storage: geekity.db is classed rebuildable (decision-55: the followers table is an index of content/_data/federation/<user>/followers.json, rebuilt every boot, and geekity rebuild deletes the database), so a table there would never be exported and would be lost to a rebuild. Instead record follower changes in a new kept data file data/follower-history.jsonl (FOLLOWER_HISTORY in files/data-files.ts, class kept), so it survives restarts and rebuilds and is in every site export. No SQLite migration.
2. Each line is one change: {at, username, change: follow|unfollow, count}, count being the site's follower count after it. Instants, not days, so the day is the site's day when the dashboard reads it and a time zone change does not move them; the WordPress import path has no time zone at write time.
3. federation/followers-history.ts: recordFollowerChange (updateFileAtomically) and readFollowerChanges, plus followerDays(changes, days, timezone, current) giving each day's count, gained and lost; a day with no change carries the last count; before the first change the count is what it was before it; with no changes every day is the current count.
4. Record at the shared chokepoints addFollower (only a new follower) and removeFollower (only when the file held it) in federation/records.ts, inside the followers file lock. FederationRecords gains dataDir; update its callers (inbox, plugin site addFollower used by the WordPress import, backfill, boot, admin tools, fed-smoke). Actor Delete goes through removeFollower.
5. Core widget admin/widget-followers.ts (Followers, half width) for the dashboard period: stats Followers (vs count at the start), Gained, Lost (better down) against the period before; time series of the count per day. Add to CORE_WIDGETS.
6. Tests first: history derivation, records recording, export includes the file, dashboard card. Docs: docs/content.md and docs/personal-data.md rows.
7. Verify with the full check suite and a screenshot of the dashboard.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Storage: decision-55 classes data/geekity.db rebuildable (the followers table is an index of content/_data/federation/<user>/followers.json, emptied and read back on every boot, and geekity rebuild deletes the database), so a table there is never exported and is lost to a rebuild. The history is therefore a new kept data file, data/follower-history.jsonl, declared as FOLLOWER_HISTORY in packages/cms/src/files/data-files.ts. No SQLite migration was added.

Format: one JSON line per change, {at, username, change: follow|unfollow, count}, count being the site-wide follower count after the change. Instants rather than day keys, so the dashboard places each change on the site's day in the time zone it has when read, and the plugin path (WordPress import) needs no time zone when it writes. followerDays() derives each day's count, gained and lost: a day with no change carries the last count, a day before the first change gets the count that change started from, and a site with no changes draws every day at the current count.

Recording happens at the two shared chokepoints in federation/records.ts, inside the followers file lock: addFollower records a follow only for a new follower (a redelivered Follow is not one), removeFollower records an unfollow only when the file held the actor. Every add/remove path goes through them: inbox Follow, Undo(Follow) and actor Delete (forget -> removeFollower), PluginSite.addFollower (the WordPress follower import), scripts/fed-smoke.ts. There is no admin removal or block of followers. FederationRecords gained a required dataDir; all callers updated. An imported follower counts as gained on the day of the import.

Widget: admin/widget-followers.ts, id followers, half width, after Fediverse in CORE_WIDGETS. It follows the dashboard period (load(vars, period)): stats Followers (count at the end vs at the end of the period before), Gained, Lost (better: down) against the period before, and a time series of the count at the end of each day. AC #3's 30 days is the 30-day view (?period=30); gained and lost are for the selected period. Half width: alone it leaves the right column empty at wide widths, which a later half card fills; screenshots at 1400px and 390px look right, no sideways scroll.

The plugin-wordpress data census now drives the writer through pluginSite().addFollower instead of admin.putFollower, so the new declaration is reached.

Validation: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all pass (cms 6436 tests, plugin-wordpress 123). Headless Chromium screenshots of /admin and /admin?period=30 on a seeded site show the card with stats and chart.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Follower history is now recorded in a kept data file, data/follower-history.jsonl (one line per follow or unfollow with the site's count after it), written by addFollower/removeFollower in federation/records.ts, which every follow path shares (inbox Follow/Undo/Delete, the plugin site's addFollower used by the WordPress import). A new half-width core widget, Followers, charts the count at the end of each day of the dashboard's 7- or 30-day period and shows the count, gained and lost against the period before; a site with no history draws a flat line at its current count. geekity.db is rebuildable (decision-55), so no table or migration was used. Verified by tests for each criterion (follower-history.test.ts, records.test.ts history and restart tests, inbox.test.ts Follow/Undo, plugins/site.test.ts import, site-export.test.ts archive listing, widget-followers.test.ts incl. no-history and 30-day), the plugin-wordpress data census, the full build/test/typecheck/lint/format chain, and headless Chromium screenshots of the dashboard.
<!-- SECTION:FINAL_SUMMARY:END -->
