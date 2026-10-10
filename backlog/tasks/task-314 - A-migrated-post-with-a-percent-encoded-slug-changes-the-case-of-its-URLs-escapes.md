---
id: TASK-314
title: >-
  A migrated post with a percent-encoded slug changes the case of its URL's
  escapes
status: To Do
assignee: []
created_date: '2026-10-10 01:13'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - >-
    /Users/andrewshell/code/geekity/asdo_geekity/_local/snapshot/baseline/feed-guids.tsv
priority: low
ordinal: 273800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen during TASK-291.1 and deferred to the andrewshell.org migration's phase 7 feed diff. WordPress post 753 has the slug i-♥-rss. WordPress stores and prints its permalink with lowercase escapes, https://andrewshell.org/2026/07/i-%e2%99%a5-rss/, in /feed/, /feed/atom/, /comments/feed/ and the category feeds (asdo_geekity _local/snapshot/baseline/feed-guids.tsv). The importer writes the permalink percent-decoded, and core re-encodes it with uppercase escapes, %E2%99%A5. RFC 3986 calls the two equivalent, and the post's guid is ?p=753, so no reader re-shows it. But the migration plan wants feed link sets byte-identical to WordPress, and some readers and crawlers compare link strings. The same re-encoding probably reaches the HTML canonical, og:url, the sitemap and the ActivityStreams url, which the phase 7 AP diff compares. Decide between: keep the source's escape case for a migrated post, for example by storing the permalink as given; or accept uppercase and document it as a known difference. Either is fine. Pick one and record it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision is recorded: keep the source's escape case for migrated posts, or accept uppercase as canonical
- [ ] #2 If kept: an imported post whose WordPress link has lowercase escapes prints that same URL in RSS, Atom, JSON Feed, comment feeds, rel=canonical, the sitemap and its ActivityStreams url
- [ ] #3 If kept: a request to either escape case reaches the post, with one of them canonical, and no redirect loop
- [ ] #4 If accepted: the plugin-wordpress README names the difference, so a migrating site expects it in a feed diff
<!-- AC:END -->
