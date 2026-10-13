---
id: TASK-291.1
title: 'WordPress import: posts and pages keep their URLs, dates, terms and ids'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:00'
updated_date: '2026-10-09 17:43'
labels: []
milestone: m-31
dependencies:
  - TASK-292
  - TASK-294
  - TASK-296
parent_task_id: TASK-291
priority: high
ordinal: 248800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Each published, draft and scheduled WordPress post or page becomes a Markdown file that Geekity serves at the URL WordPress did, dated the same, filed under the same categories and tags, and federated and syndicated under the same ids. WordPress block markup and classic HTML become Markdown where Markdown can say it, and stay as HTML where it cannot.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post is written to content/posts/YYYY-MM-DD-slug.md and a page to content/pages/slug.md, with an explicit permalink equal to the URL WordPress served (from the export link, not recomputed from the date)
- [x] #2 date is the UTC instant of post_date_gmt; updated is post_modified_gmt when it differs
- [x] #3 categories and tags carry the post's WordPress terms by name
- [x] #4 activitypub.id is set to the object id the WordPress ActivityPub plugin federated (https://<site>/?p=ID), so replies and boosts still resolve
- [x] #5 A draft or pending post gets draft: true; a future post keeps its date and publishes on schedule; a private or password-protected post is imported as a draft and named in the report
- [x] #6 A post with the status post format and no title imports with no title, so post type discovery reads it as a note
- [x] #7 Gutenberg block comments are removed and the body converts to Markdown; HTML Markdown cannot express (iframes, figures with captions, tables with spans) is kept as HTML
- [x] #8 The site author is matched to an existing Geekity user by login; a post by a login with no Geekity user is named in the report
- [x] #9 The WordPress page set as the static front page becomes the site.json homepage
- [x] #10 Tests run against a fixture export that covers each case above
- [x] #11 When a post's WordPress guid differs from its activitypub.id (on andrewshell.org, posts 813 and 609 and every post carried over from Eleventy), the TASK-292 feed guid key holds the WordPress guid, so no feed reader sees an old post as new
- [x] #12 YouTube and Vimeo iframes in an imported body become the TASK-294 video form, so no imported post carries provider iframe code
- [x] #13 Each post records the TASK-296 announce state from WordPress: announced (with the published time WordPress federated it) when activitypub_status is federated, otherwise public-but-never-federated, so importing into a live site announces nothing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: one importer (src/posts-import.ts) claims post and page. A status table decides each item: publish (served, migrated), future (scheduled, publishes here as news), draft/pending (draft: true, migrated), private and password-protected (draft: true, migrated, warned), trash and auto-draft skipped, anything else skipped by name. Front matter in core's key order (title, date, updated, permalink, tags, categories, draft, author, in-reply-to, activitypub, then guid, migrated), dumped with js-yaml as core does, so bytes are deterministic.
2. Paths and permalinks: posts/YYYY-MM-DD-slug.md from the local post_date and the decoded post_name, pages/slug.md; a second item on one path takes -ID. The permalink is the export link's path, percent-decoded as core stores permalinks. A draft whose link is ?p= gets the permalink the published posts' structure gives it; a page without a pretty link, and the front page, get their parents' slugs.
3. Dates: date from post_date_gmt (absent for a never-dated draft), updated from post_modified_gmt when it differs.
4. Ids and quiet (decision-39): every post WordPress served gets activitypub.id <home>?p=ID; activitypub_status = federated adds activitypub.published (post_date_gmt). The WordPress guid goes to guid when it is not the ?p= address. migrated: true on everything but a scheduled post (draft 123 on andrewshell.org was a public Eleventy essay).
5. Author by login against context.site.users(); unmatched login warned. Status post format drops the title (plan D4). The page WordPress served at the home URL sets site.json homepage through key-level ownership in the writer (decision-39).
6. Body (src/wordpress-html.ts): block comments stripped (activitypub/reply becomes in-reply-to; YouTube/Vimeo embed blocks become their iframe), classic content gets a wpautop port, then turndown with rules: YouTube/Vimeo iframes become the page URL on its own line (TASK-294 form); kept as HTML: other iframes, figures with captions, tables a pipe table cannot say, elements carrying style or microformats classes; simple tables become pipe tables; <!--more--> kept.
7. Tests first against a fixture export (test/wxr.ts extended): test/posts-import.test.ts per AC, test/import-dev-mode.test.ts for TASK-291 #8. Plugin README section.
8. Verify: pnpm build/test/typecheck/lint/format:check; real CLI over andrewshell.org's export into a scratch site (dist and folder bundle), geekity sync, rerun byte-identical, a running dev-mode site with a follower, curl, feed and AP diffs against the prod baselines; deslop and no-comments.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in @geekity/plugin-wordpress only; no core change.
- src/posts-import.ts: the postsAndPages importer (added to IMPORTERS). Disposition table by WordPress status; front matter in core's key order dumped with js-yaml (new dependency, bundled); paths, decoded permalinks, inferred permalink structure for undated drafts, author by login, status posts untitled, front page to site.json homepage.
- src/wordpress-html.ts: block markup and classic HTML to Markdown. Strips block comments, maps the ActivityPub plugin reply block to in-reply-to and YouTube/Vimeo embed blocks to their URL, ports wpautop for classic posts, then turndown (new dependency, bundled; rules mirror core's micropub converter since a plugin cannot import core at runtime). Iframes from YouTube/Vimeo become the page URL alone on a line (youtube.com/embed/ID?start=N becomes watch?v=ID&t=N, player.vimeo.com/video/ID?h=H becomes vimeo.com/ID/H). Kept as HTML: other iframes, video/audio/form/details/dl/script, figures with a caption, tables with spans or block cells, and any element with style or a microformats class (andrewshell.org's home page h-card). Bare URLs in text are not escaped, so linkify and the video recogniser still read them. src/turndown.d.ts types the parts used (domino's querySelector answers undefined on a miss).
- src/content-import.ts: ImporterOutput gains optional settings (site.json keys). import.json now records files and settings; a key is decided with the same decide() as a file, so it is written only when absent or still holding what the import last set. decision-39 records this and the migrated/id/guid rules.
- Departure from the handoff, recorded in decision-39: migrated: true goes on everything except a scheduled (future) post, which publishes here as news as it would have on WordPress. Drafts do get it: andrewshell.org's draft 123 carries the guid of a public Eleventy essay. activitypub.id goes only on posts WordPress served (publish); drafts keep a non-?p= guid for the day they are published.

Evidence:
- test/posts-import.test.ts (15 tests) and test/import-dev-mode.test.ts (1) against fixture exports built with test/wxr.ts (now taking date, guid, creator, password, parent). Before the code existed the suite failed with ERR_MODULE_NOT_FOUND for src/posts-import.ts; mutation checks: disabling the video rule fails the video test (iframes in the body), writing migrated on everything fails the scheduled-post assertion, dropping migrated makes the dev-mode test list held webmention, feed-ping, Create and IndexNow entries.
- Real CLI over _local/andrewshell039sweblog.WordPress.2026-10-08.xml (read only) into a scratch site: exit 0, 179 written (161 posts, 17 pages, site.json homepage), 0 warned. Same bytes from dist and from the folder bundle. Rerun: 0 written, 179 unchanged, tree byte-identical (shasum). geekity sync exit 0: Scanned 178, 0 failed. 21 posts carry activitypub.published, 142 posts carry guid (809/813/279/413, 134 Eleventy essays, 4 updates), every file migrated: true, no <iframe> in any body.
- Running site (GEEKITY_DEV_MODE=on, base https://andrewshell.org, one follower, webmentions, rssCloud and IndexNow on): the import while it ran held nothing in data/dev-mode.jsonl; a control post written after it held a webmention, a feed ping and a Create. curl: /2026/07/i-%e2%99%a5-rss/ 200, /home-page/ 301 to /, / carries the h-card. /?p=813 and /?p=1130 as activity+json match snapshot/baseline ap_post_*.json on id, url, published, updated and type. /feed/ guids for the 10 baseline items are identical; only 753's link differs in percent-encoding case (core prints %E2%99%A5, WordPress %e2%99%a5), a core feed concern for phase 7, not an id.
- pnpm build, test (cms 5145, plugin-wordpress 65, all pass), typecheck, lint, format:check pass. Scratch servers stopped.

Correction to the evidence above: the four permalink guids are posts 279, 413, 609 and 813.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity import wordpress now brings posts and pages across (@geekity/plugin-wordpress, no core change). Each post becomes posts/YYYY-MM-DD-slug.md and each page pages/slug.md, at the permalink WordPress served (percent-decoded, as core stores permalinks), dated at post_date_gmt with updated from post_modified_gmt, filed under its categories and tags by name, and by its author when the site has that login. Published posts keep activitypub.id <home>?p=ID; federated ones add activitypub.published; a guid that is not the ?p= address goes to guid; everything but a scheduled post carries migrated: true (decision-39). Drafts, pending, private and protected posts import as drafts, the latter two warned; status posts are untitled; the front page becomes site.json homepage under key-level ownership. Bodies lose block comments, classic posts get wpautop, YouTube and Vimeo iframes and embeds become the bare video URL, and what Markdown cannot say stays HTML. Verified by 16 new tests on fixture exports, the real andrewshell.org export (179 written, rerun byte-identical, geekity sync exit 0), a running dev-mode site that held nothing for the import, AP and feed guid parity with the prod baselines, and pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
