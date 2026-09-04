---
id: TASK-41
title: Load test the site under a relay-driven burst
status: To Do
assignee: []
created_date: '2026-09-04 01:05'
labels:
  - performance
  - federation
dependencies:
  - TASK-40
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
  - backlog/decisions/decision-5 - Fedify-with-in-process-queue-for-phase-one.md
type: chore
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a relay such as tags.pub boosts a post, many instances fetch the actor document, the post object and the HTML page within seconds, and every hashtag account that boosted sends an `Announce` to the inbox, each carrying an HTTP signature to verify. The CMS is one Node process with one SQLite database, an in-process queue (decision-5) and Nunjucks rendering on every request, so a burst like that is the moment it is most likely to fall over, and nothing has measured it.

Build a repeatable load test (a script under `packages/cms/scripts/` using autocannon, k6 or similar, run as `pnpm load:test`, not in CI by default) that boots the CMS on a free port over a fixture site with a few hundred posts and a few hundred followers, then replays a relay burst: concurrent GETs of the actor document, one post object with an ActivityStreams Accept, the same post's HTML page and the RSS feed, mixed with signed inbox POSTs of `Announce` and `Like` from a pool of stub actors served in-process, and a publish during the burst so delivery fan-out and the inbox compete. Report p50, p95 and p99 latency, error rate and peak memory per endpoint at increasing concurrency, and identify the first thing that breaks.

Then fix what the numbers say to fix, within reason, and record the rest as follow-up tasks. Likely candidates, to be confirmed by measurement rather than assumed: caching the rendered actor document and post objects until the index changes (the ETag and Last-Modified support already exists for conditional requests), caching rendered HTML pages the same way, bounding concurrent signature verification, moving inbox processing off the request onto the queue by default, and SQLite WAL and busy-timeout settings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm load:test runs the burst scenario against a fixture site on a free port and prints per-endpoint p50, p95 and p99 latency, error rate and peak memory at each concurrency step
- [ ] #2 The report names the concurrency at which the first errors or a p99 above one second appear, and which endpoint hits it
- [ ] #3 Signed inbox POSTs in the burst are all either accepted or rejected for a bad signature; none time out or 500
- [ ] #4 A publish during the burst delivers to every follower and records its outcomes
- [ ] #5 Fixes made on the back of the numbers are covered by the regular tests, and remaining findings are written up as follow-up tasks with the measured evidence
- [ ] #6 The README explains how to run the load test and how to read its report
<!-- AC:END -->
