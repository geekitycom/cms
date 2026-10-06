---
id: TASK-279
title: The test suite never reaches a real third-party server
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 03:54'
updated_date: '2026-10-06 04:12'
labels:
  - test
milestone: m-28
dependencies: []
references:
  - packages/cms/package.json
  - packages/cms/src/admin/editor-layout.test.ts
priority: medium
type: chore
ordinal: 238800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
pnpm test sends real requests to third-party servers: the log shows rpc.rsscloud.io answering 404 to feed pings, and news.indieweb.org and brid.gy answering 400 to webmentions sent from tests that declare syndication targets without stubbing fetch (for example admin/editor-layout.test.ts). That leaks test traffic to real services, makes the suite depend on the network and on those services' behaviour, and hides real failures as warnings. Make it structural: a preload for the test runner that refuses any fetch to a host that is not loopback, so a test that forgets to stub fails loudly, then stub or fix every test it catches.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A test that fetches a non-loopback host without stubbing fetch fails with a message naming the host
- [x] #2 pnpm test passes with no request leaving the machine, and its log has no answer from rsscloud.io, indieweb.org or brid.gy
- [x] #3 Tests that stub globalThis.fetch or run local servers on 127.0.0.1 keep working unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Preload src/__testing__/offline.ts in the cms test scripts: wrap globalThis.fetch and dns lookups so a non-loopback host fails the test loudly (also via an uncaught throw, since code under test swallows request errors), with an opt-in remoteHostsDoNotExist() for files whose outside web is meant not to exist.
2. Prove it bites with src/__testing__/offline.test.ts (child processes under the preload).
3. Answer the default rsscloud ping in the sandbox harness (src/__testing__/notify-pings.ts), since every published post pings it and no test outside notify.test.ts cares.
4. Fix each remaining file the guard catches by stubbing the host the test asserts on, or remoteHostsDoNotExist()/allowPrivateAddress when the host is incidental.
5. Check apps/demo tests; verify build, test, typecheck, lint, format and grep the test log for third-party answers.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Guard: packages/cms/src/__testing__/offline.ts, preloaded with tsx --import by the cms test and test:coverage scripts and by apps/demo's test script. It wraps globalThis.fetch, dns.lookup and dns.promises.lookup (syncBuiltinESMExports so named imports see them; http.request resolves through dns.lookup). A non-loopback host is refused with 'A test reached <host> without stubbing it', also rethrown on nextTick so code that swallows request errors still fails the test. remoteHostsDoNotExist() makes remote hosts answer ENOTFOUND / fetch failed instead, which is what the real network gave the .example fixtures before.

Proof: src/__testing__/offline.test.ts runs child test files under the preload: an unstubbed fetch fails naming the host (also when swallowed), a remote DNS lookup fails, remoteHostsDoNotExist answers missing, and a stubbed fetch plus a 127.0.0.1/localhost server pass. Red with the guard emptied, green after.

Fixes: src/__testing__/notify-pings.ts answers the default rsscloud ping (imported by admin/__testing__/harness.ts); 18 test files call remoteHostsDoNotExist() or set federation.allowPrivateAddress so their stubs answer Fedify's validatePublicUrl DNS lookup. cited-image-alt uses remoteHostsDoNotExist after one unexplained flake under allowPrivateAddress.

The remaining 'rpc.rsscloud.io/ping answered 404' lines in the test log come from test files whose own fetch stub answers 404 to URLs it does not route; no request reaches rsscloud.io. Open gaps: http.request to a remote IP literal skips DNS (nothing does this); test:11ty does not preload the guard.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The test suite can no longer reach a third-party server: a preloaded guard refuses fetches and DNS lookups of non-loopback hosts and fails the test naming the host. 18 test files that used to send real webmentions and pings to rsscloud.io, news.indieweb.org, brid.gy, indieweb.social and others now stub them or declare remote hosts missing. pnpm test passes, 4786 + 30.
<!-- SECTION:FINAL_SUMMARY:END -->
