---
id: TASK-155
title: >-
  Syndication targets: webmention-driven POSSE (IndieNews, Bridgy Publish)
  chosen per post or by tag
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:32'
updated_date: '2026-10-02 18:16'
labels:
  - webmention
  - indieweb
milestone: m-25
dependencies: []
references:
  - 'https://news.indieweb.org/how-to-submit-a-post'
  - 'https://brid.gy/about#publish'
  - 'https://indieweb.org/POSSE'
  - 'https://www.w3.org/TR/micropub/#syndication-targets'
documentation:
  - backlog/docs/doc-7 - Webmentions.md
priority: medium
type: feature
ordinal: 179800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Services such as IndieNews (https://news.indieweb.org/how-to-submit-a-post) and Bridgy Publish take a post when it links to them and sends them a webmention, and they answer with a Location header naming the copy they made. The CMS already sends a webmention to every external link in a post body (doc-7), but nothing lets an author add such a link without typing it into the body, nothing records the Location that comes back, and there is no tag shortcut like the WordPress IndieNews plugin, which syndicated any post tagged indienews. Build this generically, with no service hard-coded: a site-level list of syndication targets (id, name, URL to link to, optional tag), kept as a content file per decision-9. A post picks targets explicitly (Micropub name: syndicate-to) or implicitly by carrying a target tag. The theme renders a visible link to each chosen target inside the h-entry, the sender adds the target URLs to the links it notifies (as it already does for in-reply-to), and the URL each target returns is recorded and rendered as u-syndication. Authors can also list syndication URLs by hand (for copies posted manually). Where returned URLs are stored is a decision for planning: in the post front matter (syndication) or, following decision-19 for reply contexts, a _data file keyed by post so a background job never rewrites a file open in the editor. Per-language targets (IndieNews has /en, /de and so on) are TASK-156 (M24), not this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A site declares syndication targets in a content file with an id, a display name, a URL and an optional tag; invalid entries are reported at boot and ignored; no target is built in
- [x] #2 A post selects targets with a syndicate-to front matter list, and the post editor offers each declared target as a checkbox
- [x] #3 A post carrying a target's tag selects that target without being listed in syndicate-to
- [x] #4 The default theme renders a visible link to each selected target inside the post's h-entry, marked up the way IndieNews and Bridgy Publish require
- [x] #5 Publishing or updating a post sends a webmention to each selected target through the existing sender, with no request made while a page is served
- [x] #6 The URL a target returns in Location (201 or 202) is stored durably and rendered on the post as a u-syndication link; the storage location is recorded as a decision
- [x] #7 Authors can add syndication URLs by hand in front matter, rendered the same way
- [x] #8 Deselecting a target (removing the tag or the entry) removes its link and the sender notifies the target, as it does for any unlinked page
- [x] #9 The federation screen shows each target's outcome per post, and Resend re-sends to targets
- [x] #10 README documents targets with IndieNews and Bridgy Publish as worked examples
- [x] #11 Verified by submitting a real post to IndieNews from a public site, or the notes say why it could not be
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape first.
- content/_data/syndicationTargets.json: an array of { id, name, url, tag? }. id is the Micropub uid TASK-168 will list; an object per target leaves room for TASK-156's languages and {lang} URL. Parsed by one reader (src/webmention/syndication.ts) that drops an invalid entry (missing or bad id/name/url, duplicate id, non-http url) with a problem string; boot logs every problem. No target is built in.
- Post front matter: syndicate-to (list of target ids) and syndication (list of copy URLs written by hand), both left in Document.extra like enclosure.
- selectedTargets(document, targets): declared targets listed in syndicate-to or whose tag the post carries (case-insensitive), in file order.
- Returned copies: content/_data/syndication.json, one object keyed by the post's permalink, each mapping a target URL to the URL its Location named (decision-26, following decision-19: the sender never rewrites a post file an editor may hold open; public, so content/ and readable by Eleventy as syndication[page.url]).

Steps (test first for each):
1. Reader for targets + boot report (AC1).
2. Selection by syndicate-to and by tag (AC2, AC3).
3. Sender: targetsOf adds selected target URLs for both versions, so deselecting notifies (AC5, AC8). tell() keeps a 201/202 Location; after a send the copy store sets a selected target's copy and drops a deselected one's; a moved permalink drops its old key (AC6).
4. Render: post page context gets syndicateTo (selected targets) and syndication (hand URLs then stored copies, deduped); default theme partial partials/syndication.njk inside the h-entry: 'Also posted on <a class="u-syndication" href=target>name</a>' as IndieNews documents, and each copy as u-syndication (AC4, AC6, AC7).
5. Editor: a Syndicate to fieldset with a checkbox per declared target; save writes syndicate-to, keeping undeclared ids the file carried (AC2).
6. Federation screen: per post, one line per selected target with its sent outcome and copy link; Resend already re-reads the file through the sender, which now includes targets (AC9).
7. Decision record, README section with IndieNews and Bridgy Publish examples (AC10, AC6).
8. Verify: pnpm build/test/typecheck/lint/format:check; run demo, curl a post page with a target. AC11 needs a public site: leave unchecked.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shape: content/_data/syndicationTargets.json is a JSON array of { id, name, url, tag? } (id restricted to [A-Za-z0-9._-] so it can name a form field and a Micropub uid). Reader and selection live in packages/cms/src/webmention/syndication.ts. Returned copies live in content/_data/syndication.json keyed by permalink then target URL (decision-26, created with backlog decision create; the CLI cannot write a decision body, so its body was written by hand, as decision-25 was).

Evidence per AC:
- AC1: src/webmention/syndication.test.ts (bad entries dropped and reported); send.test.ts 'reports each invalid entry when the site starts serving' (console.warn from serve()). Seen live: demo boot logged '_data/syndicationTargets.json entry 3 ("broken") has no name, so it was ignored.' No built-in target: the default theme's hard-coded #indienews u-category link is gone; entry.test.ts now declares an IndieNews target to keep that output.
- AC2: posts.test.ts 'syndication targets in the post editor' (checkbox per target, ticked from front matter, save writes ids, keeps undeclared ids, removes key when none ticked); send.test.ts 'tells a target the post lists in syndicate-to'.
- AC3: syndication.test.ts tag selection (case-insensitive); send.test.ts publishes a post tagged news and the news target is told.
- AC4: src/web/syndication.test.ts asserts <a class="u-syndication small" href=target>Name</a> inside article.h-entry; curl of the demo post showed both IndieNews and Mastodon links in p.entry-meta inside the e-content.
- AC5: sender adds selected target URLs for both versions of a change (service.ts targetsOf); scan sends nothing as before; render only reads files.
- AC6: send.test.ts records the 201 Location in _data/syndication.json; web/syndication.test.ts renders it as u-syndication after 'Also on'; moved permalink re-keys it. Decision-26 records the location.
- AC7: front matter 'syndication' list rendered the same way, non-http dropped (web/syndication.test.ts).
- AC8: send.test.ts 'tells a deselected target again and forgets its copy'.
- AC9: send.test.ts 'syndication on the federation screen': per-target line 'News: sent, copy' and Resend posts to both targets again. The screen lists federated posts only, as before.
- AC10: packages/cms/README.md 'Syndication targets' with IndieNews and Bridgy Publish examples; theme README and doc-7 updated.
- AC11 NOT checked: needs a public site to submit a real post to IndieNews; local runs cannot be reached by news.indieweb.org. Do it after deploy: declare the IndieNews target with tag indienews on andrewshell.org, publish a tagged post, confirm the copy in content/_data/syndication.json and on the page.

Gate: pnpm build && pnpm test (3234 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0; pnpm --filter demo test:11ty passes. Demo curl run used the gitignored playground and was restored after.

Breaking for theme output: a site tagging posts indienews without a declared target loses the IndieNews link; the README and decision-26 say how to declare it.

2026-10-02: AC#11 closed on its 'notes say why' clause. The only public deploy is shll.me, a testing scratchpad, and posting to IndieNews from it is not appropriate. A real IndieNews submission waits until andrewshell.org moves to the new CMS: declare IndieNews (Posts > Syndication, url https://news.indieweb.org/{lang}, tag indienews), publish a tagged post, and confirm the copy URL in content/_data/syndication.json and as u-syndication on the page.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Syndication targets: a site declares { id, name, url, tag? } entries in content/_data/syndicationTargets.json (bad entries logged at serve and ignored, none built in). A post selects targets with syndicate-to (editor checkboxes) or by tag. The default theme links each selected target as u-syndication inside the h-entry, replacing the hard-coded IndieNews link. The webmention sender notifies selected targets for both versions of a change, so deselecting notifies too, and stores a 201/202 Location in content/_data/syndication.json keyed by permalink (decision-26), rendered as u-syndication with hand-written front matter syndication URLs. The federation screen shows per-target outcome and copy; Resend includes targets. Verified by new unit, sender, editor, render and federation-screen tests, the full pnpm gate, and a curl of the demo post. A real IndieNews submission is deferred until andrewshell.org runs the new CMS, since shll.me is a scratchpad; the notes give the steps.
<!-- SECTION:FINAL_SUMMARY:END -->
