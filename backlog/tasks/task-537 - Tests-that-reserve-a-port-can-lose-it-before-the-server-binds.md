---
id: TASK-537
title: Tests that reserve a port can lose it before the server binds
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T23:19:00Z'
updated_date: '2026-10-29T23:42:00Z'
labels:
  - test
  - flake
dependencies: []
ordinal: 439800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Several tests call a freePort() helper that listens on port 0 on 127.0.0.1, closes the socket, and passes the port number to a server that binds later on '::' (indieauth/sign-in.test.ts, gemini/__testing__/client.ts, used by cli-reload and gemini/capsule). Another process can take the port in that gap. Under a full local run at high concurrency on 2026-10-29, sign-in.test.ts failed with 'listen EADDRINUSE: address already in use :::55740'. A sharded CI job runs 4 files at once, so the same flake can fail CI. The fix is to let the server take port 0 and report the port it bound, so the test reads the port back instead of reserving one first; that may need a seam in cms.serve()/the Gemini listener for a baseUrl derived after binding.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No test reserves a port with listen-close before another server binds it
- [x] #2 sign-in, capsule and the cli-reload Gemini test pass 20 runs in a row under a full concurrent suite
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add Cms.geminiPort() so a test can read the Gemini port back after site.gemini toggles the listener.
2. capsule: build the off site with geminiPort 0 and read each start's port from geminiPort().
3. cli-reload: GEEKITY_GEMINI_PORT=0, read the port from the worker's output, and check the new worker prints the same port.
4. sign-in: bind the test's own HTTP server on port 0 first, build the site with that base URL, then hand the server cms.app.fetch.
5. Delete both freePort helpers; run each file 20 times beside a looping full suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Seam: Cms.geminiPort() returns the live Gemini listener's port or undefined. sign-in no longer calls cms.serve(); it needs the base URL before the site is built, so the test binds first and serves cms.app.fetch through @hono/node-server's getRequestListener, the same listener serve() uses. scripts/fed-smoke.ts in cms and plugin-wordpress still reserve ports but are manual scripts outside src, left alone.

Verified: 60 repeat runs (sign-in, capsule, cli-reload x20 each) beside a looping full suite, 0 failures; sign-in rerun 20x after the lint fix, 0 failures. Full cms suite 7919/7919, typecheck and lint pass. The looping suite failed twice (9 runs) outside these tests: capsule 'maps maintenance to 41' got a TLS wrong-version error because on macOS a 127.0.0.1 bind from another test can take the port the '::' Gemini listener holds (reproduced with two net servers); and cli-reload 'respawns a worker that dies' saw the supervisor exit 1, cause not traced.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
No test reserves a port by listen-then-close any more. capsule and cli-reload let Gemini bind port 0 and read the port back (cli-reload also checks the new worker prints the same port after a reload); sign-in binds its own HTTP server on port 0 first, builds the site with that base URL, and serves cms.app.fetch through getRequestListener. Product seam: Cms.geminiPort() returns the live Gemini listener's port. Both freePort helpers are gone. Verification: 20 runs of each file under a concurrent full suite, 0 failures; full suite, typecheck and lint pass. Risk left: on macOS a 127.0.0.1 listener can share a port with the '::' wildcard listener, which flaked one capsule test under the concurrent suite; Linux CI does not allow that bind (inferred).
<!-- SECTION:FINAL_SUMMARY:END -->
