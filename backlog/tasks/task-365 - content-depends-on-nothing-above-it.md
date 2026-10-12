---
id: TASK-365
title: content/ depends on nothing above it
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 11:31'
updated_date: '2026-10-12 11:52'
labels: []
milestone: m-36
dependencies: []
references:
  - packages/cms/src/content/store.ts
  - packages/cms/src/layer-boundary.test.ts
  - packages/cms/src/content/write.ts
  - packages/cms/src/cms/site-records.ts
priority: high
type: chore
ordinal: 324800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
content/ is the domain core, yet it imports from the delivery and feature layers: content/store.ts imports repliesKey (web/feed-source.ts), feedGuid and postObjectId (web/guids.ts), NO_REDIRECTS and RedirectTable (web/redirects.ts), and linksInto, ownSiteLinks, siteLinkKey and spelling (webmention/links.ts). Other content/ files import web/, webmention/, site/, federation/, contact/ and comments/. GUID, permalink, redirect and link-key rules are content policy that currently lives in web/ and webmention/, so a change to rendering can force a change to the domain. Move that policy down so content/ only depends on itself and lower-level modules (util/, files/, cache.ts, config types), and make the rule checkable the way src/admin-boundary.test.ts already checks content/ against admin/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No non-test module under packages/cms/src/content/ imports from web/, webmention/, federation/, comments/, contact/, site/, admin/, micropub/ or cms/
- [x] #2 A check that runs in pnpm test or pnpm lint fails when such an import is added, and its message names the rule
- [x] #3 Public exports from the package index and @geekity/cms/plugin keep their names
- [x] #4 Existing tests pass unchanged in behaviour
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Generalise src/admin-boundary.test.ts into src/layer-boundary.test.ts: each rule names a layer, the directories it covers and the top-level directories they may not import; an import is resolved to the directory it lands in, so ../../ from content/metadata counts. Add the content rule (web, webmention, federation, comments, contact, site, admin, micropub, cms). See it fail listing the current imports with 'content/ must not import from web/: ...'.
2. Move pure policy down, with tests at the new homes (moving or adding a direct test where none exists):
   - web/guids.ts -> content/guids.ts (postObjectId, feedGuid, commentPageHref, COMMENT_PAGE_PREFIX) plus repliesKey from web/feed-source.ts.
   - web/redirects.ts -> content/redirects.ts (table, parse, lookups, file source); web/redirects.ts keeps only REDIRECT_BY and the redirectBy middleware.
   - site-link half of webmention/links.ts -> content/site-links.ts (SiteLink, ownSiteLinks, siteLinkAt, siteLinkKey, spelling, linksInto, landing, linkTarget); webmention/links.ts keeps externalLinks/externalTarget.
   - webmention/html.ts (the HTML tree parser) -> util/html-tree.ts.
   - hiddenReason/isServed/isGone/isListed from web/documents.ts -> content/served.ts.
   - findAsset/StaticAsset -> files/static-files.ts; UPLOAD_ASSET_PREFIX, UPLOAD_DIRECTORY, findUpload -> content/uploads.ts.
   - LANG_FRONT_MATTER_KEY (web/locale) and LANGUAGE_TAG_PATTERN (site/setting-values) -> content/language.ts; COMMENTS_FRONT_MATTER_KEY -> content/comments.ts; CONTACT_FRONT_MATTER_KEY -> content/contact.ts; SYNDICATE_TO_FRONT_MATTER_KEY, SyndicationTarget, syndicateToOf -> content/syndicate-to.ts (the shared strings helper -> util/guards.ts nonEmptyStrings).
   - userForAuthor/authorNames (web/authors.ts) -> content/authors.ts, generic over a structural author user.
   - shownInFull (webmention/cited-picture.ts) -> content/citation.ts.
3. Inject what does I/O or belongs to a feature into content/write.ts: DocumentSite extends SiteRecords (users, timezone, syndicationTargets, hasComments), built once by the composition root (cms/site-records.ts) and put on c.var.siteRecords; admin/documents.ts and micropub/endpoint.ts spread it. citedContext/storedContext use content's CitedPage instead of webmention's ReplyContext; learnHandles is typed (body) => Promise<void>. Characterise the four reads in write.test.ts before the change, and add a seam test with fake records.
4. Rewrite every import with a codemod, no re-export shims; keep public names in exports.ts/plugin.ts/index barrels (compare the TS export list before and after).
5. Verify: pnpm build, test, typecheck, lint, format:check at the root (plugins and demo included).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Boundary check: src/admin-boundary.test.ts became src/layer-boundary.test.ts (git mv). Each rule names a layer and the top-level directories it may not import; every relative import is resolved to the directory it lands in. The new content rule failed first with 28 offences ('content/ must not import from web/: content/store.ts:11' ...) and passes now. Proved again by adding an import of ../web/render.ts to content/slug.ts: the test failed with 'content/ must not import from web/: content/slug.ts:97', then the line was removed.

Moved down (old -> new), no re-export shims left behind:
- web/guids.ts -> content/guids.ts (git mv), plus repliesKey from web/feed-source.ts. New test content/guids.test.ts (postObjectId, feedGuid, repliesKey, commentPageHref had no direct test).
- web/redirects.ts -> content/redirects.ts (git mv): table, parse, lookups and the file source. web/redirects.ts keeps only REDIRECT_BY and the redirectBy middleware. New content/redirects.test.ts; HTTP behaviour still covered by web/redirects.test.ts.
- site-link half of webmention/links.ts -> content/site-links.ts (SiteLink, ownSiteLinks, siteLinkAt, siteLinkKey, spelling, LinksInto, linksInto, landing, linkTarget). webmention/links.ts keeps externalLinks/externalTarget. The ownSiteLinks/siteLinkKey tests moved from webmention/links.test.ts to content/site-links.test.ts, with new tests for siteLinkAt, spelling, linksInto, landing.
- webmention/html.ts -> util/html-tree.ts (git mv; generic HTML tree parser). New util/html-tree.test.ts.
- hiddenReason/HiddenReason/isServed/isGone/isListed from web/documents.ts -> content/served.ts. New content/served.test.ts.
- findAsset/StaticAsset -> files/static-files.ts; UPLOAD_ASSET_PREFIX, UPLOAD_DIRECTORY, findUpload -> content/uploads.ts. New files/static-files.test.ts and content/uploads.test.ts.
- LANG_FRONT_MATTER_KEY (web/locale.ts) and LANGUAGE_TAG_PATTERN (site/setting-values.ts) -> content/language.ts (new content/language.test.ts); COMMENTS_FRONT_MATTER_KEY -> content/comments.ts; CONTACT_FRONT_MATTER_KEY -> content/contact.ts; SYNDICATE_TO_FRONT_MATTER_KEY, SyndicationTarget, syndicateToOf -> content/syndicate-to.ts (new content/syndicate-to.test.ts). The private stringsOf in webmention/syndication.ts became util/guards.ts nonEmptyStrings (tested in util/guards.test.ts); selectedTargets now calls syndicateToOf.
- userForAuthor/authorNames from web/authors.ts -> content/authors.ts, generic over AuthorUser {id, username, profile.displayName}; userForAuthor returns the caller's own user type. Their tests moved from web/authors.test.ts to content/authors.test.ts.
- shownInFull from webmention/cited-picture.ts -> content/citation.ts, taking { kind: string } (CitedPage's picture). New content/citation.test.ts.

Contracts changed:
- DocumentSite (content/write.ts) now extends SiteRecords { users(), timezone(), syndicationTargets(), hasComments(slug) }, which replace write.ts's own reads of site/users, site/site-json, webmention/syndication and comments/records. citedContext/storedContext return content's CitedPage instead of webmention's ReplyContext (ReplyContext is assignable); learnHandles is typed (body) => Promise<void> (HandleLearner is assignable). The composition root builds SiteRecords in cms/site-records.ts, cms/services.ts holds it, cms/app.ts sets c.var.siteRecords (typed in env.ts); admin/documents.ts documentSite() and both micropub/endpoint.ts writes spread it. Covered by: four characterization tests added to content/write.test.ts before the change and passing before and after (comments keep a draft's URL, the site timezone reads an offset-less date, declared syndication targets decide what an unchecked box drops, a display name resolves to the username and pins count by both names), one seam test giving fake records, and the admin/micropub integration tests (admin/posts.test.ts pin limits, timezone, redirect recording; micropub syndicate/post-types tests).
- shownInFull's picture parameter widened from Pick<CitedPicture,'kind'> to { kind: string }; userForAuthor/authorNames take AuthorUser. Covered by the tests named above.
Every other move kept its signature; importers were rewritten by a TypeScript codemod over src/, test/ and scripts/ (imports merged and sorted after).

Public API: the TypeScript export list of src/index.ts and src/plugin.ts (1275 names, values and types) is identical before and after.
Validation from the repo root: pnpm build, pnpm typecheck, pnpm lint, pnpm format:check all exit 0; pnpm test exits 0 (cms 5698 pass, demo 32, plugin-llm 48, plugin-post-summary 22, plugin-tag-suggest 31, plugin-wordpress 106, no failures).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
content/ now imports nothing from web/, webmention/, federation/, comments/, contact/, site/, admin/, micropub/ or cms/. GUID, redirect, site-link, served/hidden, upload-location, language, front-matter-key, author-resolution and cited-picture rules moved down into content/ (and the generic HTML parser and static-file lookup into util/ and files/), with callers migrated and no shims. The write path's reads of users, site timezone, syndication targets and comment files are injected as SiteRecords from the composition root (cms/site-records.ts via c.var.siteRecords). src/layer-boundary.test.ts (generalised from admin-boundary.test.ts) enforces the rule in pnpm test with messages like 'content/ must not import from web/: content/store.ts:11'; it failed on 28 imports before and passes now. Public export names of the package index and @geekity/cms/plugin are identical (1275 names compared before/after). Verified with pnpm build, test (cms 5698 pass, all plugins and demo pass), typecheck, lint and format:check from the repo root.
<!-- SECTION:FINAL_SUMMARY:END -->
