---
id: TASK-286
title: '@geekity/plugin-tag-suggest: tag suggestions ranked by tags.pub followers'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 12:09'
updated_date: '2026-10-08 16:19'
labels:
  - plugins
  - llm
  - federation
milestone: m-30
dependencies:
  - TASK-285
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - 'https://tags.pub'
  - 'https://github.com/social-web-foundation/tags.pub'
priority: medium
type: feature
ordinal: 242800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). @geekity/plugin-tag-suggest requires @geekity/plugin-llm. On a click beside Tags, the server asks llm for candidate hashtags for the draft, passing the tags the site already uses so it prefers them, then looks up each candidate on tags.pub: the actor at https://tags.pub/user/<tag> and its followers collection totalItems. tags.pub returns an actor for any string, so zero followers means nobody follows the tag. The editor shows candidates ranked by followers, marks the ones the site already uses, and adds the chosen ones to the Tags field. Core gains a host fetch that refuses private addresses unless the site allows them (the same rule as federation) and a plugin cache file in data/plugins/<package name>/ with expiry.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Candidates are normalised (lower case, no #, the site tag slug rules) and deduplicated before lookup
- [x] #2 Each candidate shows its tags.pub follower count; candidates are ranked by it, with tags the site already uses marked
- [x] #3 Counts are cached for a day in the plugin data folder; a second suggestion for the same tags makes no request to tags.pub
- [x] #4 Lookups send a descriptive User-Agent with the site URL, run at most four at a time, and time out; a tags.pub failure still shows the candidates without counts
- [x] #5 The host fetch refuses a private or loopback address unless the site allows private addresses, tested with a planted redirect to 127.0.0.1
- [x] #6 Choosing a suggestion adds it to the Tags field without duplicating an existing tag and without saving
- [x] #7 Verified in a real browser against fake llm and tags.pub servers
- [x] #8 The package has its release-please entry, commitlint scope, CLAUDE.md scope row, CI jobs, bundle build and packed-tarball smoke test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shapes first, then one failing test per criterion (tdd).

Core (@geekity/cms, scope cms), each addition used by tag-suggest only:
1. host.fetch(url, { headers, signal }): Promise<Response>. GET, redirects followed by hand (at most 5), every hop checked with publicHost(config.hostLookup) unless federation.allowPrivateAddress is on; a refused hop throws. Built on webmention/public-address.ts. Registry options gain allowPrivateAddress and lookup, set in sitePluginRegistry. Test: a public name that 302s to a live 127.0.0.1 server is refused and the server sees nothing; with allowPrivateAddress it is followed.
2. PluginEditorChoice { value, note?, badge? } and a third suggestion shape { ok: true, choices }. The endpoint passes choices through; editor.njk gains a hidden choice list and a <template> row (so Tailwind sees the classes); editor-actions.js draws one checkbox per choice (radio for a single-value field), and Accept puts the checked values through the existing accepted(), which already adds only tags the field lacks.
3. PluginEditorContext.siteTags: every tag on a published document, most used first, from store.listTags() when the button is pressed.
4. Cache: host.data already gives the plugin data/plugins/<name>/ with atomic update; expiry is the plugin's own timestamps, so no new core API (laziness; decision-33 grows core only where needed).

Plugin @geekity/plugin-tag-suggest (scope plugin-tag-suggest), requires @geekity/plugin-llm:
5. normalise(tag): strip #, NFKD, drop marks, lower case, keep [a-z0-9] (tags.pub folds the same way and answers 500 to anything else); dedupe by that key; drop empties.
6. Suggest tags on the tags field: llm with strict schema {tags: string[]}, told the site's tags to prefer; candidates normalised, deduped; a candidate that matches a site tag keeps the site's spelling and gets the badge Used here.
7. Followers: GET <tags server>/user/<tag>/followers (one request; totalItems), User-Agent '@geekity/plugin-tag-suggest/<v> (+<site URL>)', at most 4 at a time, per-lookup timeout; failures leave the count unknown. Ranked by count desc, unknown last, model order on ties.
8. followers.json in the data folder: { tag: { followers, at } }, a day; fresh entries skip the request; only successes cached.
9. Setting: tags server URL (default https://tags.pub) so tests and a self-hosted instance can point elsewhere.
10. Package wiring: package.json geekity field, tsconfigs, README, LICENSE, version.ts, bundle + bundle test, release-please config + manifest, commitlint scope, CLAUDE.md scope row, CI, pack-install-smoke.sh.
11. Verify: pnpm build/test/typecheck/lint/format:check, smoke script, Playwright Chromium on a scratch site with fake llm and tags.pub servers; update doc-1 and doc-5.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
tags.pub as observed on 2026-10-08 with curl (outside the suite): GET https://tags.pub/user/indieweb answers a Service actor (application/activity+json) whose followers is https://tags.pub/user/indieweb/followers; that collection is an OrderedCollection with totalItems 13. An unknown tag (zzqqxyznotatag123) answers the same shape with totalItems 0. tags.pub folds names and refuses a spelling that is not folded with 500 application/problem+json 'Mismatched context: X !== y': IndieWeb, indie-web, indie_web, a.b, café (→ cafe) and 日本 (→ riben) all 500. Headers advertise RateLimit-Policy steady-get q=2400/60s and burst-get q=1000/10s. The plugin asks /user/<tag>/followers directly, one request per tag. The fake in packages/plugin-tag-suggest/test/tags-pub.ts answers the same shapes, including the 500 for an unfolded spelling.

Decisions:
- Normalisation is tags.pub's fold rather than a core slug rule, because core has no tag slug: tags are free strings, URL-encoded. hashtagKey = strip #, NFKD, drop marks, lower case, the same transliterations as core's slugify, keep [a-z0-9]. A tag that folds to nothing (a CJK tag tags.pub transliterates) is left out rather than guessed.
- A candidate whose key matches a site tag takes the site's spelling and the badge Used here, so accepting it files the post with the others.
- Cache: core already gives host.data (data/plugins/<name>/, atomic update), so the day expiry is the plugin's own timestamps in followers.json; no new core cache API (decision-33: grow core only where a consumer needs it). Only successful counts are kept; expired entries are pruned on write; a failed write is warned and the suggestion still answers.
- Core host.fetch is GET-only and answers the Response as it came; the plugin owns User-Agent, timeout (5 s per lookup) and concurrency (4).
- Core choices are for the tags field only; a choices answer beside title or description is a 500 with a reason. Rows come from a <template> in editor.njk so Tailwind sees their classes; the boxes have no name, so a save never posts them.
- A Tag server setting (default https://tags.pub) lets the tests and a self-hosted tags.pub point elsewhere.
- failureWords is a copy of plugin-post-summary's, because lint refuses value imports between plugins. A third consumer would be the time to move plain-words failures into the llm service.

Validation: pnpm build, pnpm test (cms 4900, plugin-tag-suggest 14, post-summary 14, llm 37, wordpress 36, demo 32, all pass), pnpm typecheck, pnpm lint, pnpm format:check all clean; scripts/pack-install-smoke.sh passed, including the tag-suggest bundle load and a Suggest tags press with no key. Mutation checks: following the planted redirect unchecked fails 2 fetch tests; AT_ONCE 16 fails the concurrency test; skipping the cache fails 2 tests. Browser: Playwright Chromium (Chrome for Testing 1234) against a scratch site with the fake provider and fake tags.pub: Suggest tags lists Blogging (Used here, 240), IndieWeb (Used here, 13), pkm (1 follower), owning (No followers); nothing ticked; ticking IndieWeb, Blogging, pkm and Accept turned 'indieweb, Writing' into 'indieweb, Writing, Blogging, pkm' with nothing saved; a second press made no tags.pub request; with tags.pub answering 503 the candidate shows 'Followers unknown: tags.pub answered 503' and can still be added; no console errors or CSP violations besides /favicon.ico.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built @geekity/plugin-tag-suggest and the three core pieces it needs. Core: host.fetch (GET, redirects followed by hand, every hop refused when private unless federation.allowPrivateAddress), a choices answer for tags editor actions drawn as tickable rows with badge and note, and PluginEditorContext.siteTags. Plugin: asks the llm service for hashtags preferring the site's tags, folds them as tags.pub does, dedupes, looks up followers four at a time with a descriptive User-Agent and a 5 s timeout, caches counts a day in data/plugins/@geekity/plugin-tag-suggest/followers.json, ranks by followers and marks site tags Used here. Wired into release-please, commitlint, CLAUDE.md, the pack-install smoke test and doc-1/doc-5. Verified with the full build/test/typecheck/lint/format gate, the smoke script and a Playwright Chromium run against fake llm and tags.pub servers.
<!-- SECTION:FINAL_SUMMARY:END -->
