---
id: TASK-530
title: 'Wiki content type: wiki/<slug>.md served at /<wiki_base>/<slug>/'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T18:11:00Z'
updated_date: '2026-10-29T19:37:00Z'
labels: []
milestone: m-51
dependencies:
  - TASK-529
references:
  - decision-66
ordinal: 432800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-66: wiki pages are a third document type rather than pages with a flag, so they can be listed, linked and edited as their own set. Posts and pages are described by DocumentKind (src/content/document-kind.ts) and typed by directory (typeForPath in src/content/parser.ts, content-tree.ts). Unlike a page, a wiki page has no stored permalink: it is /<wiki_base>/<slug>/ from its file name, so a base change moves all of them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Files under `wiki/` index as documents of type `wiki` with a WIKI_KIND: undated, untagged, uncategorised, not federated, not excludable, no contact form, replies or location
- [x] #2 A wiki page permalink is `/<wiki_base>/<file slug>/`, derived at read time; a `permalink` in its front matter is ignored with a sync warning
- [x] #3 A published wiki page is served at its permalink (and .md, .gmi, .json) with a new `wiki` layout in the default theme showing the title, body, last-updated time and the pages that link to it; drafts and trashed ones are 404 and 410 as for pages
- [x] #4 Wiki pages are in site search, the sitemap and export, and `/llms.txt` lists them in a section of their own
- [x] #5 Wiki pages are not in feeds, the home page, archives or federation
- [x] #6 Saving a post or page whose permalink is under `/<wiki_base>/` is refused with a message naming the wiki base
- [x] #7 Changing `wiki_base` moves every wiki page, and the old path answers with a 301 to the new one, as a renamed taxonomy term does
- [x] #8 DocumentType and the plugin-facing document type include `wiki`
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Types: DocumentType and the plugin-facing PluginEditorDraft.type gain 'wiki'; WIKI_KIND in document-kind.ts; fix every exhaustive Record typecheck finds (comment policy closed for wiki, admin-bar KINDS gets a WIKI_SCREENS declaration).
2. Parser/content tree: wiki/ is a document directory; typeForPath -> wiki; permalink /<wikiBase>/<slugify(file name)>/ from options.wikiBase ?? default; permalink, date, tags, categories and in-reply-to are not read for a wiki page; hash is of the file text without the derived permalink (serializeDocument(content, 'wiki') omits it).
3. Reconciler: a row whose permalink moved counts as changed even when the hash matches; warn naming the ignored keys a wiki file carries.
4. Write path: defaultPermalink/contentFilePath/freeSlug know wiki; saveDocument takes wikiBase and writes wiki files without a permalink; trash keeps the indexed base; DocumentSite gains optional wikiBase (documentSiteFrom fills it); writeDocument refuses a post/page permalink under /<wikiBase>/ naming the base.
5. Public site: TEMPLATES.wiki = layouts/wiki.njk and DOCUMENT_TEMPLATES by type for HTML and text representations; default theme wiki layout (title, body, Last updated, backlinks); base.njk treats wiki as an entry; search kicker says Wiki.
6. llms.txt gains a Wiki section; sitemap lists wiki pages; search and export already include them (tests prove it). Feeds/home/archives/federation are post-only (tests prove it).
7. Base change: site.former_wiki_bases (file key formerWikiBases, omitted when empty) recorded by wiki_base's onChange; services re-sync content when wiki_base changes; resolveRequest answers /<former base>/<slug>/ and its representations with 301 to the live wiki page.
8. docs/settings.md: what saving a wiki base does.
9. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check; curl a running server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built test-first. New tests: src/content/wiki-document.test.ts (kind, typing, permalink, ignored keys, hash, serialization, file path), sync.test.ts 'wiki pages' (base change re-indexes; permalink warning), write.test.ts 'the wiki base' (post/page refused under the base; a wiki page written under wiki/ without a permalink), src/web/wiki-pages.test.ts (HTML layout with Last updated and backlinks; .md/.gmi/.json; draft 404, trash 410; search, sitemap, llms.txt Wiki section; not in feeds, home, archives or federation; base change 301s incl. representations and moving back), site-export.test.ts (wiki file exported).

Decisions:
- A wiki page ignores permalink, date, tags, categories and in-reply-to in its front matter (not read, so not in archives, not scheduled, not a reply); the sync warns naming them and the next save drops them. Keeping them as unmodelled extra was not possible because documentFrontMatter skips known keys in extra.
- The hash stays a hash of the file text, which for a wiki page has no permalink, so it does not change with the base; the reconciler compares the permalink as well, so a re-sync after a base change re-indexes every wiki page.
- Former bases are a new site setting former_wiki_bases (formerWikiBases in site.json, omitted when empty), written by wiki_base's declaration-level onChange so admin, CLI and MCP saves all record it. A base moved back to leaves the list. The server re-syncs on a wiki_base change through settings.watch; a CLI change while the server runs reaches the index at next start (documented).
- Comments are closed by default on wiki pages (openByDefault.wiki = false).
- WIKI_SCREENS (/admin/wiki) is declared in admin/documents.ts only because admin-bar's Record<DocumentType> needs it; nothing mounts it yet, so the admin bar's Edit link on a wiki page 404s until TASK-531.
- Golden settings-fields-golden.json regenerated with GOLDEN_UPDATE=1 (adds former_wiki_bases: [] and, in the every-key case, formerWikiBases ['notes'] because that case changes the base from notes to wiki); namespace.test STABLE_SITE_JSON_KEYS gains formerWikiBases.

Verification: pnpm build 0, pnpm test 0 (cms 7853 pass; one earlier run had a timing flake in item-search.test 'Nominatim at most once a second', passes alone and on rerun), pnpm test:11ty 0, pnpm typecheck 0, pnpm lint 0, pnpm format:check 0. Curl against a scratch server on :3917: /wiki/garden-tools/ 200 with the wiki layout, Last updated and Linked from; index.md, index.gmi, index.json 200; sitemap lists it; llms.txt has a Wiki section; /feed/ does not include it. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wiki pages are a third document type. Files under wiki/ index as type wiki (WIKI_KIND: undated, untagged, uncategorised, unfederated, not excludable, no contact form, replies or location) at /<wiki_base>/<slugified file name>/, derived at read time; a permalink, date, tags, categories or in-reply-to in a wiki file is ignored with a sync warning and is not written back. The default theme gains layouts/wiki.njk (title, body, Last updated, backlinks); wiki pages are served as HTML, .md, .gmi and .json, 404 as drafts and 410 in the trash. They are in search, the sitemap, export and a Wiki section of /llms.txt, and stay out of feeds, the home page, archives and federation. Saving a post or page under /<wiki_base>/ is refused naming the base. Changing wiki_base records the old base in the new site setting former_wiki_bases (formerWikiBases), re-syncs so every wiki page moves, and the old URLs (and representations) answer 301 to the new ones. DocumentType and PluginEditorDraft.type include wiki. docs/settings.md describes the base change.

Verified with new unit and HTTP tests, the full pnpm build/test/test:11ty/typecheck/lint/format:check run (all exit 0), and curl against a running server.

Follow-ups for later m-51 tasks: WIKI_SCREENS is declared but not mounted (TASK-531), so the admin bar's Edit link on a wiki page 404s until then; admin autosave/preview/editor-actions still only know post/page; a wiki_base change made by the CLI while the server runs reaches the index at the next start.
<!-- SECTION:FINAL_SUMMARY:END -->
