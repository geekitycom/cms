---
id: TASK-519
title: Reload drains for 60-80 s, refusing writes the whole time
status: To Do
assignee: []
created_date: '2026-10-26T02:09:00Z'
labels:
  - supervisor
  - plugins
dependencies: []
priority: high
type: bug
ordinal: 421800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On andrewshell.org (0.44.0, plugin-umami 0.6.0, plugin-wordpress 0.11.0) on 2026-10-26, Update all and Reload each took 67 s and 79 s. The supervisor logged 'Reloading: the running server is draining.' and the new worker logged 'is serving' 66 s and 79 s later. A cold boot of the same site takes about 4 s (container start 02:04:31, serving 02:04:35). No 'Draining: waiting for N writes in flight' line was logged, so the write gate's refuse() returned at once, and the time goes to endServices(lifecycle, 'drain') in packages/cms/src/cms/create.ts. For the whole drain, every POST got 503: ActivityPub inbox deliveries to /inbox/ and /wp-json/activitypub/1.0/inbox, and the user's second Update all click. The admin request that asked for the reload hung until it finished, so the owner saw a page spinning for over a minute and thought the reload had failed. Find which service's stop/settled holds the drain, fix the root cause so a drain finishes in seconds, and cap how long any one service may hold it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A test reproduces a drain held by the slow service and fails before the fix
- [ ] #2 A reload of a site with in-flight background work finishes draining within a few seconds
- [ ] #3 If a service still has not settled after a bounded wait, the drain logs which service and carries on
- [ ] #4 The reload is checked end to end with geekity serve and the time from draining to serving is reported
<!-- AC:END -->
