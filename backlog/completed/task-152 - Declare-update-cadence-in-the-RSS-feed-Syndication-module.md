---
id: TASK-152
title: Declare update cadence in the RSS feed (Syndication module)
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-10-01 13:18'
labels:
  - feeds
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/foundations/feed-hygiene/'
priority: low
type: enhancement
ordinal: 176800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The RSS feed has atom:link rel=self, stable guids and validators, but no sy:updatePeriod or sy:updateFrequency, so readers poll on their own schedule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 RSS feeds declare the Syndication namespace with updatePeriod and updateFrequency, configurable with a sensible default
- [x] #2 Every feed still validates with the W3C feed validator
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: UPDATE_PERIODS (hourly|daily|weekly|monthly|yearly), FeedCadence {period, frequency}, DEFAULT_FEED_CADENCE hourly/1 (what WordPress emits, so a migrated site's subscribers keep their polling), and feedCadence(site) in web/feed-source.ts reading feedUpdatePeriod/feedUpdateFrequency from site.json tolerantly.
2. feed-rss.ts: declare xmlns:sy on the post and comments RSS feeds and write sy:updatePeriod and sy:updateFrequency in the channel. Add the cadence to both feed fingerprints so the ETag moves with the setting.
3. Settings: feedUpdatePeriod and feedUpdateFrequency in SiteSettings, defaults, form fields, site.json read/write, validation, Settings > Reading (select + number field with problem lines). Update the settings test fixtures (SETTINGS_PAGE_FORMS.reading, READING, settings.test.ts).
4. Tests first: feeds.test.ts for the default and a configured cadence on post, archive and comments feeds, the ETag moving; settings-reading.test.ts for save, refusal of bad values.
5. README settings table. Regenerate the anonymous-pages golden if it moves.
6. Verify: full gates, run the demo, curl the feeds, and run each feed through the W3C feed validator.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: UPDATE_PERIODS, FeedCadence {period, frequency} and feedCadence(site) in web/feed-source.ts, reading feedUpdatePeriod/feedUpdateFrequency from site.json. Each key falls back to the default on its own, so a hand edit the module would refuse is never published.
Default hourly/1. That is what WordPress declares, so subscribers of a migrated site poll as before. The README tells a site that posts weekly to say weekly, because the spec warns readers back off from a feed that stays quiet much longer than it declares.
Both RSS documents carry it: the post feeds (site, archives) and the comments feeds (site-wide and per post). Atom and JSON Feed have no element for it and stay unchanged.
The cadence is in feedFingerprint and commentsFingerprint, so changing the setting changes the ETag. feedFingerprint is shared by all three formats, so a cadence change also moves the Atom and JSON ETags: one extra 200 per subscriber, accepted to avoid threading the format through the fingerprint.
Settings > Reading: 'Feed update period' select and 'Checks per period' text field (inputmode numeric) below Notify server, both with field.problem lines. Fixtures updated in admin/__testing__/settings.ts, settings-pages.test.ts READING and settings.test.ts.
Golden: regenerated anonymous-pages.golden.json. Only /feed/ body (xmlns:sy plus the two sy lines) and its etag changed.
Validation: pnpm build && pnpm test (2754 pass) && pnpm typecheck && pnpm lint && pnpm format:check all green. Ran the demo (playground) and sent /feed/, /feed/atom/, /category/general/feed/, its Atom, /comments/feed/ and a post comments feed to the W3C feed validator (check.cgi, soap12). All were valid with 0 errors, at hourly/1 and again at daily/2 set in the playground site.json. The remaining warnings (UnknownNamespace source, SelfDoesntMatchLocation, ContainsRelRef, ImplausibleDate on the empty comments feed) were already there and do not involve sy.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
RSS feeds (post, archive and both comments feeds) now declare xmlns:sy with sy:updatePeriod and sy:updateFrequency. The values come from new feedUpdatePeriod/feedUpdateFrequency settings, default hourly/1 to match WordPress, editable on Settings > Reading and stored in site.json. Invalid values are refused by the form and ignored when read from the file. The cadence is part of the feed ETag. Verified with new feeds.test.ts and settings-reading.test.ts cases written red first, the full gate suite, curl against the running demo, and the W3C feed validator (all feeds valid, 0 errors) at the default and at daily/2.
<!-- SECTION:FINAL_SUMMARY:END -->
