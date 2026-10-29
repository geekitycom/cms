---
id: TASK-529
title: Wiki base setting on Settings > Permalinks
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T18:11:00Z'
updated_date: '2026-10-29T19:09:00Z'
labels: []
milestone: m-51
dependencies: []
references:
  - decision-66
ordinal: 431800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: wiki pages live under a configurable path prefix, the way tag and category archives do. Wiki pages and [[wiki links]] both build their URLs from it, so it comes first. Today `tag_base` and `category_base` are the only permalink settings (src/site/namespace.ts, src/content/taxonomy.ts taxonomyBaseProblems, src/admin/settings-permalinks.ts).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A `wiki_base` setting with default `wiki` is stored with the other permalink settings and shown on Settings > Permalinks
- [x] #2 It is checked by the same rules as `tag_base` and `category_base` (pattern, reserved top-level paths), and all three bases have to differ; each problem is named on the field
- [x] #3 The base reaches the public site view and the content parser, the way the taxonomy bases reach routing
- [x] #4 The CLI `geekity settings` reads and writes it; the settings-fields golden snapshot is updated
- [x] #5 docs/settings.md describes it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. content/taxonomy.ts: add a PermalinkBase type (tag, category, wiki), PermalinkBases, DEFAULT_PERMALINK_BASES (wiki: 'wiki') and labels; widen taxonomyBaseProblems/taxonomyBasesOrDefault into permalinkBaseProblems/permalinkBasesOrDefault over all three bases, with every pair having to differ. TaxonomyBases stays the tag/category subset, so the archive URL builders are unchanged.
2. site/namespace.ts: declare site.wiki_base (fileKey wikiBase, default wiki) checked by the shared validator; site/settings.ts permalinkBasesFromSettings.
3. admin: wiki_base field in settings-fields.ts, on the Permalinks page (settings-permalinks.ts + permalinks.njk), test fixtures, golden snapshot regenerated.
4. theme/site-data.ts: wikiBase in SiteData and its defaults; permalinkBases(site). Renderer.permalinkBases(); SiteView.bases becomes PermalinkBases.
5. Content parser: ParseDocumentOptions.wikiBase; createContentSync/createReconciler take a wikiBase() reader, services.ts passes the site data's wiki base.
6. Tests first for each: taxonomy unit tests, namespace/CLI get+set, settings-permalinks HTTP (shown, saved, refused with per-field messages), site view, sync passing the base.
7. docs/settings.md: the wiki base in the Permalinks row, the site.json keys, validation table and the bases section.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- content/taxonomy.ts: PermalinkBase ('tag' | 'category' | 'wiki'), PERMALINK_BASES, PermalinkBases, DEFAULT_PERMALINK_BASES. taxonomyBaseProblems/taxonomyBasesOrDefault became permalinkBaseProblems/permalinkBasesOrDefault over all three; each pair that clashes is named on both fields ('The tag base and the wiki base have to be different words.'). TaxonomyBases stays the tag/category subset, so termHref and the archive code are unchanged; PermalinkBases is assignable to it.
- site.wiki_base (fileKey wikiBase, default wiki) in site/namespace.ts with the shared check; permalinkBasesFromSettings replaces taxonomyBasesFromSettings (notify, federation article).
- Admin: wiki_base field, on Settings > Permalinks with a hint; golden snapshot regenerated (only wiki_base/wikiBase additions).
- Site view: theme/site-data.ts permalinkBases(site) (replaces internal taxonomyBases), Renderer.permalinkBases() added beside taxonomyBases() (kept so the public Renderer type is not broken), SiteView.bases is now PermalinkBases, so view.bases.wiki is there for routing.
- Content parser: ParseDocumentOptions.wikiBase; createContentSync/createReconciler take wikiBase(), read at every parse; services.ts passes permalinkBases(siteData.read()).wiki. The parser does not use it yet: the wiki permalink and [[link]] rendering come next. Other parseDocument callers (save, trash, write, admin taxonomy) do not pass it yet.
- Verified: pnpm build, test (cms 7829 pass), test:11ty, typecheck, lint, format:check all green. Real server on a scratch site: Permalinks page shows the Wiki base field, a wiki_base of tag is a 400 with the message under the field, notes saves (303) to site.json wikiBase; CLI get prints wiki, set site.wiki_base category exits 1 with the clash message.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the wiki_base permalink setting (default wiki). It is checked with tag_base and category_base by one permalinkBaseProblems: same segment pattern, not a reserved top-level path, and no two bases the same word, each problem on its field. It is on Settings > Permalinks, in site.json as wikiBase, readable and writable with geekity settings, in the golden snapshot and in docs/settings.md. The base reaches the public site view (SiteView.bases.wiki via Renderer.permalinkBases()) and the content parser (ParseDocumentOptions.wikiBase, supplied by the content sync from the site data at every parse). Nothing serves wiki URLs yet; the docs line about /{wikiBase}/ describes what the rest of m-51 builds. Tests: taxonomy unit tests, CLI get/set/refuse, Permalinks HTTP (shown, saved, refused per field), site view, sync asking for the base per parse; full suite, 11ty, typecheck, lint and format pass.
<!-- SECTION:FINAL_SUMMARY:END -->
