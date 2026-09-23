---
id: TASK-48
title: 'Taxonomy management: rename, merge, and delete tags and categories'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:34'
updated_date: '2026-09-04 06:42'
labels:
  - admin
  - content
milestone: m-5
dependencies:
  - TASK-35
  - TASK-36
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 27975
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Once categories exist, the admin needs the WordPress taxonomy screens: `/admin/tags` and `/admin/categories` listing every term with its post count, and actions to rename a term, merge one into another, and delete one. The files are the truth (decision-1), so each action rewrites the front matter of every post carrying the term through the document writer, announces each change to the sync so the index, the feeds and federation (an `Update(Article)` per affected published post, since the Hashtags change) follow, and reports how many files it touched. A rename that would collide with an existing term is offered as a merge instead. Old archive URLs for a renamed term redirect to the new one for as long as the site records the rename (a small list in `site.json`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The tags and categories screens list every term with its post count and link to the archive
- [x] #2 Rename rewrites every affected file, the archive moves, the old archive URL redirects, and each affected published post is delivered as Update(Article)
- [x] #3 Merge moves every post from one term to another without duplicating the target on a post that had both
- [x] #4 Delete removes the term from every file and the archive answers 404
- [x] #5 Each action reports the number of files rewritten and is proved by tests over fixture posts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Store: a new `listTermUsage(taxonomy)` over each join table returning { term, published, total } — the public count the archives show and the count of every file carrying the term, drafts, scheduled and trash included, because a rewrite touches all of them. Ordered by term, which is what a management screen wants (listTags/listCategories stay count-ordered for the theme). The rewrite itself needs no new query: listAll({ tag|category, trashed: false }) plus the same with trashed: true is every file.
2. Pure core in a new src/admin/taxonomy.ts: `applyTermChange(terms, from, to)` — replace `from` in place with `to`; if `to` is already in the list, drop `from` and let the target keep its place; `to` undefined deletes. That one function is rename, merge and delete.
3. The rewrite: for every affected document, re-read and re-parse the file from disk (decision-1, files are truth — the index may be stale and a bulk write must not resurrect what somebody edited behind it), apply the change through documentContent() so extra/activitypub carry through, saveDocument(), then await c.var.announce({ type: 'updated', ... origin: 'admin' }) per file so the index, feeds, notify server and an Update(Article) per published post all follow. A file that is missing or will not parse is skipped and counted separately. Returns the counts the flash reports.
4. Renames recorded in site.json: `taxonomyRedirects: [{ taxonomy, from, to }]` as a list setting in SiteSettings, DEFAULT_SITE_SETTINGS, the reader/writer (one `taxonomy|from|to` line per entry in SQLite, the navigation precedent), settingsSiteData, siteJsonFor and seedSiteSettings, excluded from SettingsField like `avatar` so it is not a form field. Recording a → b collapses chains (an existing x → a becomes x → b), drops a self-redirect, replaces an entry with the same from, and drops any redirect pointing at a term that has just been deleted or recreated.
5. Serving the redirect: SiteData.taxonomyRedirects read back through a `termRedirects(site)` in web/context.ts and a `termRedirects()` accessor on Renderer beside taxonomyBases(). In taxonomyArchive, when countListing() === 0, one hop through the recorded renames and a 301 to termHref(newTerm, pageNumber, bases); the same one hop in feed() so /tag/old/feed/ follows. One hop only, so a hand-edited site.json cannot make a loop.
6. The screens: mountTaxonomyScreens(app, { taxonomy, render }) called once per taxonomy from mountAdmin, giving /admin/tags and /admin/categories, plus /admin/{tags,categories}/rename and /delete as POST-redirect-GET. Two ADMIN_SECTIONS entries and two entries in `built`; ADMIN_TEMPLATES.taxonomy over a new admin/layouts/taxonomy.njk modelled on users.njk — a row per term with its archive link, its public count, its file count, an inline rename field and a delete button, every form carrying csrf_token. A rename onto a term that already exists is not silently merged: the screen comes back with a confirmation form naming both counts and a hidden merge flag. Bad input (empty name, unknown term) is a 400 re-render with `problems`.
7. Docs: the admin route table and a taxonomy section in packages/cms/README.md, the root README, and doc-5's screen table.
8. Red-green throughout with node:test through the admin harness and app.request: applyTermChange as a unit, listTermUsage on the store, then the screens over fixture posts — the listing and its counts, a rename rewriting N files and moving the archive, the old archive URL and its feed redirecting, an announce per rewritten file, a merge that does not duplicate the target, a delete that 404s the archive, and each refusal.
9. Verify: pnpm build/test/typecheck/lint/format:check from the root, then a live pass on the demo with notifyServer emptied first (its rpc.rsscloud.io would be pinged with localhost URLs by a bulk rename) and restored afterwards.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

Two screens — `/admin/tags` and `/admin/categories` — and the one rewrite behind all three of their actions.

- **`packages/cms/src/admin/taxonomy.ts`** is new. `applyTermChange(terms, from, to)` is the whole of what happens to one file's term list, and rename, merge and delete are that one function: `to` replaces `from` where it stands; a `to` the list already carries is a merge, so `from` is simply dropped and the target keeps its place; `to` of `undefined` is a delete. `rewriteTerm` walks every file carrying the term and `mountTaxonomyScreens(app, { kind, render })` is the screen — one call per taxonomy from `mountAdmin`, the way `mountDocumentScreens` gives `/admin/posts` and `/admin/pages`.
- **`admin/layouts/taxonomy.njk`** is the screen: a row per term with its archive link, its Posts count, its Files count, an inline rename field and a Delete button, every form carrying `csrf_token`. Two `ADMIN_SECTIONS` entries, two more in `built`, `ADMIN_TEMPLATES.taxonomy`, and `.admin-inline` / `.admin-visually-hidden` in `admin.css`.
- **`ContentStore.listTermUsage(taxonomy)`** (`content/store.ts`): every term in one alphabetical pass with both counts, over the same join tables `listTags`/`listCategories` read.
- **Redirects.** `web/taxonomy.ts` gained `TaxonomyRedirect`, `recordTermRename`, `forgetTerm`, `redirectedTerm` and `taxonomyRedirectsOf`; `taxonomyRedirects` joined `SiteSettings` (excluded from `SettingsField` like `avatar`), the reader/writer as `taxonomy|from|to` lines, `settingsSiteData`, `siteJsonFor` and `seedSiteSettings`; `SiteData.taxonomyRedirects`, `termRedirects(site)` in `web/context.ts` and `Renderer.termRedirects()`. `taxonomyArchive` and `feed` in `web/routes.ts` consult them when the listing is empty and answer 301.
- **`storeSiteSettings`** was pulled out of `mountSettings`'s private `store` and exported, because the settings screen is no longer the only thing that writes a setting.

## Decisions

- **Two counts, not one.** The screen shows Posts (what the public site lists) and Files (every file carrying the term, drafts, scheduled posts and the trash included). The second is what an action rewrites, and a screen that showed only the first would understate what a rename is about to touch. `listTermUsage` is alphabetical rather than count-ordered because it is a list to find a term in; `listTags`/`listCategories` stay count-ordered for the theme.
- **The trash is rewritten too.** A trashed file may be restored tomorrow, and it would come back carrying a term nothing else uses.
- **Every file is re-read and re-parsed from disk before it is rewritten**, rather than taken out of the index (decision-1). The index can be a moment behind a hand edit the watcher has not seen, and a bulk rewrite that trusted it would put that edit back. A file that has gone or will not parse is skipped, counted, and named in the flash rather than overwritten with what the index remembers. There is no hash-conflict check because there is no submitted hash to compare against; re-reading is what takes its place.
- **A merge is offered, not done.** A rename onto an existing term comes back as a 200 with a confirmation form naming both counts and a hidden `confirm`, because a merge cannot be undone by renaming back. The target keeps the place it already had rather than jumping to the source's, so a merge reorders nothing.
- **Chains are collapsed on the way in, and followed one hop on the way out.** `recordTermRename` repoints anything that pointed at `from`, replaces an older record of `from` moving, and drops a record of `to` having moved away — so `a → b` then `b → c` is stored as `a → c`. The archive consults the list only when nothing carries the term, so a term that comes back into use is served rather than redirected. One hop means a hand-edited `site.json` cannot send a reader round a loop.
- **A delete drops every record touching the term** (`forgetTerm`): a redirect to a 404 costs a round trip and tells the reader nothing.
- **`taxonomyRedirects` is not on the settings form.** It is a record of what happened rather than a preference. It is carried through `settingsFromForm` as a third argument beside `avatar`, so a save of the form cannot silently drop it — pinned by a test.
- **A rewrite normalises what it touches**, the same way any editor save does: the file goes through parse → serialize, so an unquoted YAML date becomes a quoted ISO string and the front-matter key order becomes the writer's. That is pre-existing writer behaviour, not something this task chose, but it is visible in a bulk rewrite in a way it is not in a single save.

## Public API

New in the barrels: `applyTermChange`, `mountTaxonomyScreens`, `rewriteTerm`, `renameProblem`, `renamePath`, `deletePath`, `TAG_KIND`, `CATEGORY_KIND`, `TAXONOMY_KINDS`, `TAXONOMY_FIELDS`, `storeSiteSettings`, `recordTermRename`, `forgetTerm`, `redirectedTerm`, `taxonomyRedirectsOf`, `termRedirects`, and the types `TaxonomyKind`, `TermRewriteReport`, `TermRow`, `MountTaxonomyScreensOptions`, `TaxonomyRedirect`, `TermUsage`, `TaxonomyName`. `settingsFromForm` gained an optional third argument and `Renderer` a `termRedirects()` method — both additive.

## Validation

Root gates, all clean on the final tree: `pnpm build`, `pnpm typecheck` (both projects), `pnpm lint`, `pnpm format:check`, `pnpm test` (833 in the package + 11 in the demo, up from 807 + 11 — 26 new: 5 `applyTermChange`, 11 screen and redirect tests in `src/admin/taxonomy.test.ts`, 8 in `src/web/taxonomy.test.ts`, 1 in `src/content/store.test.ts`, 2 in `src/admin/settings.test.ts`), `pnpm test:11ty` (10 + 5). `npm pack --dry-run` shows `admin/layouts/taxonomy.njk` (3.8 kB) in the tarball.

The new tests were mutation-checked rather than trusted. Each of these failed exactly the tests that name the behaviour: making `applyTermChange` always substitute (the merge case), skipping the `announce` (the announce count), dropping the trashed half of `carriers` (the file counts and the rewrite), dropping `recordTermRename` (both redirect tests), dropping the archive redirect and the feed redirect separately, and breaking each half of the `listTermUsage` query.

## Live pass

`apps/demo` on port 3000, signed in as `ada`, by curl. **`notifyServer` was emptied first** — in `apps/demo/data/geekity.db` and in `content/_data/site.json` — because it points at the real `https://rpc.rsscloud.io` and a bulk rename announces an Update per affected published post, which would have pinged it with localhost feed URLs. Nothing was logged against it and it was restored to `https://rpc.rsscloud.io` in both places afterwards.

- **AC #1.** `/admin/tags` listed content 3/3, sqlite 2/2, theme 1/2, web 2/2, each linking `/tag/{term}/`; `/admin/categories` listed engineering 4/4 and general 2/3. `theme`'s 1/2 is the draft that carries it, which is the point of the second column. Tags and Categories are in the left-hand navigation between Pages and Settings.
- **AC #2.** Renaming `content` to `writing`: 303, flash "Renamed “content” to “writing” in 3 files.", and `git diff` showed the three files rewritten. `/tag/writing/` 200 and `/tag/content/` 301 to it; `/tag/content/feed/` 301 to `/tag/writing/feed/`. `site.json` gained `taxonomyRedirects: [{taxonomy: tag, from: content, to: writing}]`. `ap_outbound` gained exactly three rows, one `Update` per affected published post — one-url-many-representations, markdown-on-disk, six-tables-and-a-migration.
- **AC #3.** Renaming category `general` onto `engineering` came back 200 with "Merge “general” into “engineering”?", "There is already a category called “engineering”, on 4 files" and "3 files carrying it", and wrote nothing. Resubmitted with `confirm=1`: 303, "Merged “general” into “engineering” in 3 files.", engineering then 5 posts across 6 files. `markdown-on-disk`, which carried both, ended with `categories: [engineering]` — once, in the place it already had. `/category/general/` 301 to `/category/engineering/`. Two `Update`s, for the two published posts of the three files.
- **AC #4.** Deleting tag `theme`: "Deleted “theme” from 2 files." and `/tag/theme/` 404. Deleting `writing`: "Deleted “writing” from 3 files.", `/tag/writing/` 404 — and `/tag/content/` 404 too rather than redirecting to it, because the delete dropped the record pointing at it. The `general → engineering` record was left alone.
- **AC #5.** Every action's flash named the file count, and each matched what `git diff --stat` showed.

The demo was then restored: `git checkout apps/demo/content/posts/` (which also removed the `activitypub` blocks the federation listener stamps into a post it has announced), `notifyServer` put back in the db and the file, and the `taxonomyRedirects` row deleted from the settings table. `apps/demo/content/_data/site.json` is byte-for-byte the pre-existing uncommitted edit again — `git diff` shows only the `timezone`/`avatar`/`language`/bases/`notifyServer`/`relays` lines that were there before this task. The archives and both screens were re-checked as restored, the server was killed, `pgrep -fl "tsx watch"` is empty and port 3000 is free. The pre-existing file in `apps/demo/content/uploads/` is untouched.

## Docs

`packages/cms/README.md`: the four new routes in the admin table and a "Managing tags and categories" section. Root `README.md`: a "Tags and categories" section before Users. doc-5's screen table gained the two screens (through `backlog doc update`). doc-2 was not touched — it documents the front-matter keys, not what manages them.

Postscript on the demo restore: the first `git checkout -- apps/demo/content/posts/` was done while the dev server was still running, and the watcher read it as three edits and re-announced them, so the federation listener stamped `activitypub` back into the three posts. That is the ordinary publish path, not anything this task added. The checkout was repeated once the server was stopped and stuck: `git status` under `apps/demo/` now shows only the pre-existing uncommitted `content/_data/site.json` edit and the pre-existing untracked `content/uploads/`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the WordPress taxonomy screens: `/admin/tags` and `/admin/categories`, each listing every term in use with two counts — what the public site lists under it, and every file carrying it, drafts, scheduled posts and the trash included — a link to its archive, an inline rename field and a delete button.

Rename, merge and delete are one operation. `applyTermChange(terms, from, to)` is the whole of what happens to one file's term list: the new name replaces the old where it stands, a name the list already carries is a merge so the old one is simply dropped and the target keeps its place, and no new name at all is a delete. Around it, `rewriteTerm` re-reads and re-parses every affected file from disk rather than taking it out of the index — the files are the truth (decision-1), the index can be a moment behind a hand edit, and a bulk rewrite that trusted it would put that edit back — writes it through the document writer so `extra` and `activitypub` carry through, and announces each write, so the index, the feeds and one `Update(Article)` per affected published post all follow. Each action's flash says how many files it wrote, and names any it could not read. Renaming onto a term that already exists is offered as a merge with both counts on the screen rather than done quietly, because a merge cannot be undone by renaming back.

A rename moves an archive, so it is recorded as a `taxonomyRedirects` entry — `{ taxonomy, from, to }` — in the settings and mirrored into `content/_data/site.json`, and the old archive URL and its feed then answer 301. Chains are collapsed as they are written so every old URL is one hop; the list is consulted only once nothing carries the term, so a term that comes back into use is served rather than redirected; and deleting a term drops every record pointing at it, because a redirect to a 404 is worse than the 404.

Verified with 26 new tests — the pure term change, the store's new `listTermUsage`, the screens and the public redirects through `app.request`, and the bytes of `site.json` on disk — every one of them mutation-checked, plus a live curl pass against the demo covering all five criteria: both listings and their counts, a rename that rewrote three files, moved the archive, 301'd the old archive and its feed and put exactly three `Update`s in the delivery log; a merge that was offered first and then folded three files into an existing category without duplicating it on the post that had both; and two deletes, one 404ing its archive and one also dropping the redirect that pointed at it. Root `build`, `typecheck`, `lint`, `format:check`, `test` (833 + 11) and `test:11ty` (10 + 5) all pass. The demo's `notifyServer` was emptied for the live pass so the real rpc.rsscloud.io was never pinged with localhost URLs, and restored afterwards along with the sample content.
<!-- SECTION:FINAL_SUMMARY:END -->
