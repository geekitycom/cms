---
id: TASK-314
title: >-
  A migrated post with a percent-encoded slug changes the case of its URL's
  escapes
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 01:13'
updated_date: '2026-10-10 10:41'
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
- [x] #1 A decision is recorded: keep the source's escape case for migrated posts, or accept uppercase as canonical
- [ ] #2 If kept: an imported post whose WordPress link has lowercase escapes prints that same URL in RSS, Atom, JSON Feed, comment feeds, rel=canonical, the sitemap and its ActivityStreams url
- [ ] #3 If kept: a request to either escape case reaches the post, with one of them canonical, and no redirect loop
- [x] #4 If accepted: the plugin-wordpress README names the difference, so a migrating site expects it in a feed diff
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Trace how a slug becomes a URL: importer -> front matter permalink -> Document.permalink -> absoluteUrl/new URL -> feeds, canonical, sitemap, AS url; and request path -> routing.
2. Decide: keep the source's escape case only if one point in the data flow can carry it; otherwise accept uppercase.
3. Record the decision with backlog decision create and in the task notes.
4. If accepted: write a test that pins the documented difference (lowercase-escaped WordPress link, uppercase in RSS/Atom/JSON Feed/comment feed/canonical/sitemap/AS url, both escape cases answer 200), then name the difference in the plugin-wordpress README Posts and pages section.
5. Verify with pnpm build/test/typecheck/lint/format:check and curl a running site with an imported i-%e2%99%a5-rss post.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision (decision-43, accepted): accept uppercase escapes as canonical; document the WordPress lowercase spelling as a known feed-diff difference in the plugin-wordpress README.

Why not keep the source's case. Traced the flow: the importer decodes the WordPress slug (decodedSegment in posts-import.ts) and writes permalink: /2024/03/i-♥-rss/; core keeps Document.permalink decoded as the lookup key and every surface builds its URL with new URL / absoluteUrl (negotiate.ts) from it, which serialises non-ASCII with uppercase escapes. WHATWG URL keeps an existing escape's case, so storing the permalink encoded would print lowercase, but the decoded permalink is a key in about 107 .permalink uses across 36 core files: the store index, getByFormerPermalink, permalink-keyed _data files, the comment data file name (_data/comments/i-%E2%99%A5-rss.json), redirects, and routes.ts comparisons such as pathname !== permalink followed by a 301 to encodePath(permalink). An encoded permalink there makes the decoded request path never equal the stored key, which redirects a request to itself. Carrying a second as-spelled field instead means threading it through the same 36 files. Neither is one point in the data flow, so per the brief the uppercase option applies.

Measured: both escape spellings answer 200 with the post and no redirect; RSS, Atom, JSON Feed, the site comments feed, the post's comment feed, rel=canonical, og:url, the sitemap and the ActivityStreams url all print %E2%99%A5; the feed guid stays https://blog.example/?p=753.

AC#2 and AC#3 do not apply: they are the criteria for keeping the source's case, the option not taken.

Validation: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check all exit 0 (cms 5187, plugin-wordpress 91, others pass). New test in packages/plugin-wordpress/test/comments-import.test.ts pins the README claim; mutating dist absoluteUrl to lowercase escapes makes it fail. Curl against a scratch site built by the importer (geekity serve on :4314, stopped after) matched the test. Decision-43 was created with backlog decision create; the CLI has no option to write its Context/Decision/Consequences body, so the rationale lives in these notes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Chose to accept uppercase percent-escapes as canonical (decision-43). Keeping WordPress's lowercase spelling would need the as-spelled permalink threaded through about 36 core files, or an encoded permalink key that makes routes.ts redirect a request to itself. Added a paragraph to the plugin-wordpress README Posts and pages section naming the difference a feed diff shows, and a test that imports a lowercase-escaped WordPress post and checks RSS, Atom, JSON Feed, the comments feed, the sitemap, rel=canonical, og:url and the ActivityStreams url print uppercase escapes while both spellings answer 200. Verified with the full pnpm gate and curl against a served import. AC#2 and AC#3 belong to the option not taken and stay unchecked.
<!-- SECTION:FINAL_SUMMARY:END -->
