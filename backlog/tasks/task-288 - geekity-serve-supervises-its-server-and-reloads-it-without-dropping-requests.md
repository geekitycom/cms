---
id: TASK-288
title: geekity serve supervises its server and reloads it without dropping requests
status: To Do
assignee: []
created_date: '2026-10-06 12:30'
updated_date: '2026-10-06 12:41'
labels:
  - plugins
  - deploy
milestone: m-30
dependencies:
  - TASK-281
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - packages/cms/src/cli.ts
  - packages/cms/src/index.ts
  - 'https://nodejs.org/api/cluster.html'
priority: medium
type: feature
ordinal: 244800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). Installing a plugin must not need a container restart. `geekity serve` becomes a small supervisor (node:cluster primary) that owns the listening port and runs the CMS in one worker. To reload, the old worker stops taking writes and stops its timers, a new worker boots and starts listening, and only then is the old worker disconnected and drained. The port never closes, so requests keep being answered throughout. A sketch on 2026-10-06 (Node 24.18, about 90 requests a second during the handoff) showed the order matters. Retiring the old worker before the new one listened closed the port and refused requests. Starting the new worker first and then calling worker.disconnect() on the old one dropped nothing in two runs and reset one reused keep-alive connection in a third. The Plugins screen offers Reload when the plugins folder differs from what is loaded. The same supervisor respawns a worker that crashes, without a container restart.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reload from the Plugins screen loads a newly copied plugin folder and drops a removed one, with no container or process-manager restart
- [ ] #2 During a reload under steady load, no request is refused; the test drives requests through the handoff and asserts every one is answered, with idle keep-alive connections on the old worker closed rather than reset
- [ ] #3 While draining, the old worker answers GET and HEAD, answers other methods 503 with Retry-After, and has stopped its scheduler, digests, retention, avatar and watcher timers before the new worker starts them
- [ ] #4 The old worker drains its delivery, webmention and mail queues (as close() does) before it exits; a delivery queued just before reload is sent once, not twice and not never
- [ ] #5 The new worker runs boot migrations alone: nothing in the old worker writes data/ or the SQLite cache after draining begins
- [ ] #6 A worker that crashes is respawned with backoff, and a worker that fails to boot leaves the old one serving and shows the boot error on the Plugins screen
- [ ] #7 The Plugins screen shows Reload with what changed (added, removed, updated folders) only when the plugins folder differs from what the running worker loaded; Reload is a POST behind CSRF for an administrator
- [ ] #8 SIGTERM and SIGINT to the supervisor drain the worker and exit as geekity serve does today, under the image init
<!-- AC:END -->
