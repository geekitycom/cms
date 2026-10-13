---
id: TASK-288
title: geekity serve supervises its server and reloads it without dropping requests
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 12:30'
updated_date: '2026-10-08 16:54'
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
- [x] #1 Reload from the Plugins screen loads a newly copied plugin folder and drops a removed one, with no container or process-manager restart
- [x] #2 During a reload under steady load, no request is refused; the test drives requests through the handoff and asserts every one is answered, with idle keep-alive connections on the old worker closed rather than reset
- [x] #3 While draining, the old worker answers GET and HEAD, answers other methods 503 with Retry-After, and has stopped its scheduler, digests, retention, avatar and watcher timers before the new worker starts them
- [x] #4 The old worker drains its delivery, webmention and mail queues (as close() does) before it exits; a delivery queued just before reload is sent once, not twice and not never
- [x] #5 The new worker runs boot migrations alone: nothing in the old worker writes data/ or the SQLite cache after draining begins
- [x] #6 A worker that crashes is respawned with backoff, and a worker that fails to boot leaves the old one serving and shows the boot error on the Plugins screen
- [x] #7 The Plugins screen shows Reload with what changed (added, removed, updated folders) only when the plugins folder differs from what the running worker loaded; Reload is a POST behind CSRF for an administrator
- [x] #8 SIGTERM and SIGINT to the supervisor drain the worker and exit as geekity serve does today, under the image init
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Plugin folder (packages/cms/src/plugins/folder.ts): GEEKITY_PLUGINS_DIR / config pluginsDir (default <cwd>/plugins, like themes). Scan one folder per plugin (name or @scope/name), fingerprint each by a hash of its files, import index.js default export. Snapshot diff = added, removed, updated. Folder failure handling and manifests stay with TASK-287.
2. Drain inside one CMS (packages/cms/src/serve/drain.ts + createCms): cms.drain() refuses new non-GET/HEAD with 503 + Retry-After, waits for in-flight writes (the reload POST excepted), stops the watcher, scheduler, digests, avatars, actor profiles, retention and plugin start/stop, settles the delivery, relay, webmention, reply-context, notifier, IndexNow, mail, image and activity-log queues, then makes the worker read-only: PRAGMA query_only on both SQLite connections and a refusal of every atomic write under dataDir and contentDir. Responses while draining carry Connection: close. cms.resume() reverses it. A GET that tries to write while drained is answered 503.
3. Supervisor (packages/cms/src/supervisor/): an IPC protocol, a primary state machine with injected fork and timers (unit tested with fake workers), and a node:cluster binding. Reload order: drain old -> fork new (migrations run alone) -> new listening -> retire old (stop accepting, let keep-alive connections end by Connection: close or keep-alive timeout, then close and exit). New worker boot failure -> old resumes and keeps the error for the Plugins screen. Crash -> respawn with exponential backoff. SIGTERM/SIGINT -> each worker closes, supervisor exits 0. First boot failure exits 1 as today.
4. Worker side: geekity serve in a cluster worker loads config, the plugin folder, createCms with a Supervision (loaded snapshot, reload(), last failure), serves, answers IPC.
5. Plugins screen: Reload card with added/removed/updated folders only when the folder differs and the CMS is supervised; POST /admin/plugins/reload behind the admin CSRF gate; shows the last reload failure.
6. Tests first for each AC: unit (drain, folder, supervisor state machine, screen) then a real geekity serve integration test (reload under load, keep-alive close, boot failure, SIGTERM). Real load run recorded in notes. Update docs (doc-1 plugins section / README serve) where they describe serve.

7. As built: the gate is src/drain.ts (not src/serve/drain.ts); Fedify's default in-process queue is wrapped in src/federation/queue.ts so drain and close() wait for queued deliveries.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- geekity serve is a node:cluster supervisor (src/supervisor/primary.ts, a state machine over injected fork/clock, bound by superviseCluster). Each worker runs the same command (serveWorker in cli.ts): it reads the config and the plugins folder afresh, so a reload sees what changed, and talks to the supervisor through src/supervisor/protocol.ts + worker.ts.
- Reload order: the serving worker asks; it drains (cms.drain()); only after it answers drained is the new worker forked, so the new worker's boot migrations run alone; when the new worker listens the old one is told to retire and closes gently (net.Server#close, so idle keep-alive connections end on Connection: close or the keep-alive timeout rather than being closed under a client). Boot failure or a 5-minute boot timeout -> the old worker resumes (cms.resume()) and keeps the error for the Plugins screen. A crash respawns with backoff (0.5 s doubling to 30 s, reset after 60 s up). The first boot failing still exits 1 with the message, as before.
- cms.drain(): a write gate (src/drain.ts) answers non-GET/HEAD 503 + Retry-After: 5 and Connection: close, waits for the writes in flight (up to 75 s, over plugin-llm's 60 s), then stops the plugins, the timers and the watcher, settles the queues and the mail/image/activity-log writes, then sets PRAGMA query_only on both SQLite connections and refuses every atomic write under dataDir and contentDir (refuseWritesUnder in src/files/atomic.ts). A GET that tries to write while drained gets the same 503. takeFlash no longer writes when nothing is queued, so admin pages render on a drained worker.
- Fedify's default in-process queue is wrapped (src/federation/queue.ts) so drain and close() wait for its queued messages; before this, close() on SIGTERM could drop a queued delivery. A site-supplied queue is the site's to drain (a durable queue keeps its messages).
- Plugins folder: pluginsDir / GEEKITY_PLUGINS_DIR (no default), scanned and fingerprinted per folder (src/plugins/folder.ts), imported at boot beside config.plugins with source 'the plugins folder, <name>'. createCms takes a second ServeContext argument (folderPlugins, supervision).
- Plugins screen: a Reload card naming added/removed/updated folders, only when supervised and the folder differs; POST /admin/plugins/reload behind the admin session + CSRF gate; success redirects to ?reloaded=1 with Connection: close (no flash: the old worker is read-only), failure shows 'The last reload failed, so this server carried on' with the boot error.

Decision (plugin data writes during drain): a write inside a request that was in flight when the drain began counts as in flight, so it finishes and is written (the tag-suggest cache write succeeds). Once drained, every write under data/ is refused with WritesRefusedError; a request that outlives the 75 s wait loses its write, which tag-suggest tolerates (it warns and still answers). Only one worker writes at any time, so updateFileAtomically's in-process lock stays sufficient.

Left for TASK-287: an import failure or a folder without a plugin export currently refuses the boot (on Reload: old worker carries on, error shown); 287's AC#4 turns that into an unavailable row. Manifests/peer ranges, Dockerfile GEEKITY_PLUGINS_DIR and the compose volume are also 287's.

Verification (2026-10-08):
- pnpm build, pnpm test (cms 4940 pass, demo 32, plugin-llm 37, post-summary 14, tag-suggest 14, wordpress 36; 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass.
- src/cli-reload.test.ts against a real geekity serve: 8 keep-alive clients through a reload -> 8925 answers, all 200, 0 failures, reload POST 567 ms (rerun: 7381/0, 552 ms); an idle keep-alive connection on the old worker saw 'end' and no error; the new worker shows the added folder and not the removed one; duplicate-name folder -> 303 back, error shown, old worker takes writes again; SIGKILLed worker respawned; SIGTERM and SIGINT exit 0 with nothing listening.
- Load run (scratch script, real geekity serve, seeded starter site, 32 keep-alive clients over /, /_geekity/health, /feed/, /about/, three reloads in a row): 19110 answers, all 200, 0 failures; reloads 552/551/556 ms; all four plugin folders shown after; SIGTERM exit 0.
- Docker: scripts/docker-smoke.sh (linux/arm64) passed. The built image run with --init, a bind-mounted /site/plugins and GEEKITY_PLUGINS_DIR: three reloads under 32 clients -> 2732 answers, all 200, 0 failures, no container restart; a SIGKILLed worker inside the container respawned and /healthz answered 200; docker stop exited 0 in 0.15 s. Container and image removed; nothing of mine left listening.
- Test detects defects: removing the queue settle makes the AC#4 test see no delivery; removing digests.stop() makes the drain test count one live interval.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity serve is now a node:cluster supervisor that owns the port and runs the CMS in one worker. Reload on the Plugins screen (shown only when the plugins folder, pluginsDir / GEEKITY_PLUGINS_DIR, differs from what the worker loaded, naming added, removed and updated folders; a CSRF-guarded POST) drains the old worker (503 + Retry-After for writes, in-flight writes finish, timers/watcher/plugins stop, queues including Fedify's in-process queue empty, then SQLite query_only and atomic writes refused under data/ and content/), forks the new worker so its migrations run alone, and retires the old one gently once the new one listens. A boot failure leaves the old worker serving with the error on the screen; a crash respawns with backoff; SIGTERM/SIGINT close the worker and exit 0. Verified by unit tests for the gate, the queue, the folder scan, the supervisor state machine and the screen; a real geekity serve integration test (8925 requests through a reload, 0 failures, idle keep-alive closed not reset); a 32-client load run over three reloads (19110 requests, 0 failures); and the Docker image (smoke passed, three reloads under load in a running container with 0 failures, worker respawn, docker stop exit 0). Full build, test, typecheck, lint and format checks pass.
<!-- SECTION:FINAL_SUMMARY:END -->
