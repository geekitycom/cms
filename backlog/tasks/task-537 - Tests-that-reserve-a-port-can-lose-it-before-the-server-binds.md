---
id: TASK-537
title: Tests that reserve a port can lose it before the server binds
status: To Do
assignee: []
created_date: '2026-10-29T23:19:00Z'
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
- [ ] #1 No test reserves a port with listen-close before another server binds it
- [ ] #2 sign-in, capsule and the cli-reload Gemini test pass 20 runs in a row under a full concurrent suite
<!-- AC:END -->
