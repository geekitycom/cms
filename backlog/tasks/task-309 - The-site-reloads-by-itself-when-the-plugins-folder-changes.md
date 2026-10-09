---
id: TASK-309
title: The site reloads by itself when the plugins folder changes
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 14:12'
updated_date: '2026-10-09 15:00'
labels: []
dependencies: []
references:
  - packages/cms/src/supervisor/primary.ts
  - packages/cms/src/plugins/folder.ts
  - packages/cms/src/plugins/manage.ts
  - packages/cms/src/cli.ts
priority: medium
type: feature
ordinal: 269800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today a change to the plugins folder, from Admin > Plugins, `geekity plugin add|upgrade|remove` or a hand copy, needs a press of Reload on the Plugins screen. On 2026-10-09 Andrew asked for the site to pick up changes by itself: the supervisor watches the folder and reloads once it has been stable for about 5 seconds, and the admin and CLI, which know when they are done, trigger the reload at once. File-change events are unreliable on Docker bind mounts, so the watch compares the folder fingerprint (the one the Reload card already uses) on a short interval.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Under `geekity serve`, when the plugins folder fingerprint changes and then stays the same for 5 seconds, the supervisor reloads the site the same way the Reload button does (new worker, old one drains, no refused request); a folder that keeps changing (a slow hand copy) reloads only once it settles
- [x] #2 Add, Update, Update all and Remove on Admin > Plugins reload as soon as the change is made, without waiting for the debounce, and the screen shows the outcome after the reload
- [x] #3 `geekity plugin add`, `upgrade` and `remove` ask the running supervisor to reload as soon as they finish a change, and say so; when no supervised server can be reached they say the site will pick the change up within a few seconds, or to press Reload
- [x] #4 A reload that fails (the new worker does not start) leaves the old worker serving, is shown on the Plugins screen with the reason as today, and is not retried in a loop: the watch waits for the folder to change again
- [x] #5 The watch can be turned off with an environment variable (name it and document it), leaving the explicit triggers and the Reload button; the interval and the 5 second settle time are constants with tests driving them through the injected clock the supervisor already uses
- [x] #6 Tests cover the debounce (a change mid-settle restarts the wait), an explicit trigger skipping it, a failed reload not looping, and the off switch; a real geekity serve run shows a hand-copied plugin loading by itself; the README and doc-1 describe it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Folder (src/plugins/folder.ts): pluginsFingerprint(folders) joins the per-folder content hashes into one string; pluginFolderSignature(dir) is a cheap stat listing (path, size, mtime, ctime) the watch polls, so the 7 MB wordpress bundle is not hashed every second on the supervisor, which accepts the connections.
2. Protocol: ready carries the fingerprint the worker loaded.
3. Supervisor state machine (src/supervisor/primary.ts): PLUGIN_POLL_MS (1 s) and PLUGIN_SETTLE_MS (5 s); an optional watch polls the signature through the injected clock; once it has stood 5 s and is new, the content fingerprint is compared with what the serving worker loaded and with the last failed one; a differing one starts a reload. supervisor.reload() is an explicit trigger: starts now when serving, else queued until serving. One reload at a time; a failed reload records its fingerprint so the watch waits for a different one.
4. CLI trigger: the supervisor listens on a Unix socket in the OS temp dir named by a hash of the data dir (src/supervisor/control.ts); geekity plugin add|upgrade|remove connect, ask for a reload and print the outcome; no answer -> say the site picks it up within a few seconds (watch on) or to press Reload.
5. Admin: Add, Update, Update all and Remove reload right after a change when supervised. The write gate drops its path exemption: the request-scoped supervision leaves the gate before awaiting the reload, so the drain does not wait on the request that asked for it. Flashes are written before the drain; success redirects to ?reloaded=1 with Connection: close (the new worker renders flash + banner), failure redirects back to the old worker which shows the failure.
6. Config: pluginWatch / GEEKITY_PLUGIN_WATCH (default on) turns off the watch only.
7. Tests first: primary.test.ts (debounce restart, explicit skip, failed not looping, off switch), drain/admin tests, cli-reload.test.ts real serve (hand copy loads by itself, CLI add reloads at once). README + doc-1.
8. Verify: build/test/typecheck/lint/format, real geekity serve on a scratch site, docker smoke if Docker paths change.

9. As built: the explicit admin and Reload paths keep the worker's own reload request (supervision.reload); retire now closes the listener before answering, and a drained worker that has handed over answers GET/HEAD 307 to the same URL with Connection: close (stale keep-alive connections and the redirect after a reload reach the new worker). A closed worker says 'closed' and exits only on the supervisor's 'exit', fixing a pre-existing cluster round-robin race that could leave one request hanging.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design:
- Watch (src/supervisor/primary.ts): PLUGIN_POLL_MS 1 s, PLUGIN_SETTLE_MS 5 s. Each poll reads pluginFolderSignature (paths, sizes, mtimes, ctimes; 0.08 ms on the 7.2 MB wordpress bundle vs 2.9 ms for a content hash, measured on this laptop). Once a signature has stood 5 s and is new, pluginsFingerprint(scanPluginFolders) is compared with the fingerprint the serving worker sent in ready and with the last failed one. A failed read counts as a change. One reload at a time; supervisor.reload() starts now when serving, else queues until serving.
- CLI: Unix socket in os.tmpdir() named geekity-<sha256(dataDir)[0:16]>.sock, mode 0600 (src/supervisor/control.ts). The command writes 'reload' and gets the ReloadOutcome as JSON. No answer -> 'No running geekity serve answered' plus 'loads the change by itself within a few seconds' (watch on) or 'Press Reload' (watch off). A failed reload exits 1. A stale socket from a killed supervisor is replaced on the next start; a clean exit removes it. No --no-reload (the watch would reload anyway).
- Admin: manage() flashes the outcome, then (supervised, folder changed) awaits the same reload as the Reload button; manage.ts returns { changed, outcomes } and no longer carries a 'next' notice. The request leaves the write gate's in-flight count inside the request-scoped Supervision.reload (leavingWriteGate), replacing the reload path exemption. Unsupervised: 'Restart the site to load the change.'
- GEEKITY_PLUGIN_WATCH / pluginWatch (default on) turns off the watch only.
Found and fixed on the way (pre-existing in TASK-288):
- The redirect after a reload, and any request on an idle keep-alive connection, could reach the retiring worker and render its old plugin list. Fix: a drained worker's close() stops listening first and hands over (307 to the same URL, Connection: close); retire closes before settling. Without the hand-over both real-serve redirect tests fail 5/5.
- Under node:cluster round-robin the primary can hand a connection to a worker just as it stops listening; the worker returns it only while it runs, so exiting right after close could strand one request until the client timed out. Six parallel loaded servers with a reload: 5/12 runs had one hung request on the TASK-288 close order, 4/12 on mine; with the closed/exit handshake 0/24.
- An EPIPE on a message to an exiting worker crashed the supervisor (exit 1 on SIGTERM right after a reload); the Worker 'error' event is now ignored, its exit event follows.
Verification (2026-10-09):
- pnpm build, typecheck, lint, format:check pass; pnpm test: cms 5055/5055, demo 32, plugin-llm 48, post-summary 17, tag-suggest 31, wordpress 36, 0 fail.
- Mutations: removing the settle check, the since reset, the queued reload, failed = reloading, or the request's gate leave each fails a named test.
- Real geekity serve (dist build, scratch site, real plugin-llm bundle copied by hand in two steps 2.5 s apart): reloaded 5.9 s after the copy finished, once; plugin listed, no Reload card. geekity plugin add against a fake registry: 'The running site reloaded with the change.', 618 ms, listed. Admin Add: 303 to ?reloaded=1 with Connection: close in 365 ms; the next page shows the notice, the Added flash and the plugin. 8 s idle: no further reload. SIGTERM exit 0, socket removed, nothing listening.
- Docker (linux/arm64 image): scripts/docker-smoke.sh passes, now asserting plugin add, upgrade and remove reload the running container over the socket with no restart. A container with a bind-mounted /site/plugins: a folder copied on the host loaded 6 s later; Plugins screen lists it, no Reload card; docker stop exit 0. Container and image removed.

Correction to the hang counts above: on this branch's close order before the handshake it was 3 of 12 runs (2 of 6 hand-copy test runs, 1 of 6 probe runs), not 4 of 12.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity serve now reloads its plugins by itself. The supervisor polls a cheap stat signature of the plugins folder every second and, once it has stood still for 5 s and its content fingerprint differs from what the serving worker loaded, reloads as the Reload button does; a failed reload is remembered and not retried until the folder changes. Admin Add/Update/Update all/Remove reload as soon as the change is made and land on ?reloaded=1 with the outcome; geekity plugin add/upgrade/remove ask the supervisor over a Unix socket (tmpdir, named by the data folder) and print the outcome, or say the site will pick it up within seconds / to press Reload. GEEKITY_PLUGIN_WATCH=off turns the watch off. Along the way, three TASK-288 reload races were fixed: a stale page from the retiring worker (now 307 to the new one), a request stranded by cluster round-robin as the old worker exited (closed/exit handshake, 5/12 -> 0/24 under load), and a supervisor crash on EPIPE. Verified by state-machine tests on the injected clock, admin and CLI tests, real geekity serve tests (hand copy, CLI, admin, failed folder, watch off), a scratch run on the dist build, the Docker smoke and a bind-mount hand copy in a container; full build/test/typecheck/lint/format pass.
<!-- SECTION:FINAL_SUMMARY:END -->
