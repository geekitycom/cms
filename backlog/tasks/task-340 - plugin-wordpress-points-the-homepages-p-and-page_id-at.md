---
id: TASK-340
title: plugin-wordpress points the homepage's ?p= and ?page_id= at /
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 23:01'
updated_date: '2026-10-11 01:04'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/plugin-wordpress/README.md
priority: low
ordinal: 299800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found building the andrewshell.org redirect generator. The importer writes /?p=238 and /?page_id=238 → /home-page/ into _data/redirects/wordpress.json for the WordPress page that is the site's homepage. Core then answers /home-page/ with a 301 to / (a static homepage's own permalink redirects to /), so the old ids take two hops. Phase 4's check requires a single 301 to a 200, and the docs say the generator must write final targets. A site can't override the key from its own redirect file without repeating a from that wordpress.json declares. Proposal: when the importer sets homepage in site.json, it points that page's ?p= and ?page_id= redirects at / directly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On an import whose WordPress homepage is page N, wordpress.json maps /?p=N and /?page_id=N to /
- [x] #2 On the andrewshell.org import, /?p=238 and /?page_id=238 answer one 301 to /
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing test in packages/plugin-wordpress/test/redirects-import.test.ts: a front page (link = site root) gets /?p=N and /?page_id=N -> / in wordpress.json, each answers one 301 to /, and / answers 200; a rerun over a site whose wordpress.json and import.json hold the old /home-page/ target rewrites both keys to /.
2. posts-import.ts: the redirect target for WordPress's front page is / (where core serves the homepage), not its permalink. Every other target is already final (permalinks serve 200, former permalinks lead to the current one, attachments lead to the copied file).
3. README note if it describes the target.
4. Verify: pnpm build/test/typecheck/lint/format:check; scratch import of the andrewshell.org WXR, curl /?p=238 and /?page_id=238.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
posts-import.ts points the static front page's ?p= and ?page_id= at / (core serves the homepage there and 301s the page's permalink there). Mirrors WordPress, which answered the front page's ids at / too, so the target is / even when the site's own site.json chose another homepage (a clash).
Other targets checked for a second hop: pages get no activitypub.id (only posts), the WXR carries no page_for_posts so the import sets no posts page, former permalinks are redirect_from on the document (core already sends a homepage's former permalink to / in one hop), and attachment redirects lead to the copied file. On the andrewshell.org scratch import every one of the 192 keys in wordpress.json answers one 301 to a 200.
Rerun: the entries writer rewrites a key that still holds what the import last set; test 'moves the redirects an earlier import pointed at its permalink' seeds wordpress.json and import.json with /home-page/ and reruns. Also rerun over a copy of the TASK-338 scratch site (imported with the old target): 2 written (the two 238 keys, now /), 437 unchanged.
AC#2: fresh scratch import of the 2026-10-08 WXR (scratchpad/site340), served: /?p=238 and /?page_id=238 each 301 -> /, curl -L: 1 hop, final 200.
Checks: pnpm build, test (cms 5429, plugin-wordpress 101, all pass), typecheck, lint, format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The WordPress import now points the static front page's /?p=N and /?page_id=N at / instead of the page's permalink, which core 301s to /, so the old ids take one hop. README Redirects section says so. Verified by two new tests in packages/plugin-wordpress/test/redirects-import.test.ts (fresh import and a rerun over the old target), a scratch import of the andrewshell.org WXR where /?p=238 and /?page_id=238 answer one 301 to / and all 192 wordpress.json keys answer one 301 to a 200, and a rerun over a site imported with the old target that rewrote both keys.
<!-- SECTION:FINAL_SUMMARY:END -->
