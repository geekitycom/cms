---
id: TASK-17
title: Map posts to ActivityStreams Articles and serve the outbox
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 21:14'
labels:
  - federation
milestone: m-2
dependencies:
  - TASK-16
  - TASK-6
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Object dispatcher for /ap/posts/{slug} returning an Article per doc-4 (id, url, name, content, source markdown, published, updated, attributedTo, to Public, cc followers, Hashtag tags). Outbox collection pages over published posts as Create activities. The post HTML page links to its ActivityStreams id with rel=alternate, and a post permalink requested with an ActivityStreams Accept header is answered by Fedify.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /ap/posts/{slug} with an ActivityStreams Accept returns an Article whose content equals the rendered HTML and whose source is the Markdown
- [x] #2 Drafts and pages are not dispatched as objects
- [x] #3 The outbox lists Create(Article) activities newest first with paging
- [x] #4 The HTML post page contains a link rel=alternate type=application/activity+json to the object id
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move the federation path constants and federationOrigin into a leaf module src/federation/paths.ts, and add POST_OBJECT_PATH (/ap/posts/{slug}), postObjectPath(slug), postObjectId(slug, baseUrl) and createActivityId(articleId) there. A leaf is what lets the web layer name an object id without importing the Fedify wiring, so there is no cycle between web/ and federation/.
2. src/federation/article.ts: postArticle(context, document) builds the Article doc-4 describes (id from getObjectUri, url = absolute permalink, name, content = document.html, source = the Markdown, published/updated, attribution = the actor, to = Public, cc = the followers collection, one Hashtag per tag pointing at the tag archive), postCreateActivity(context, document) wraps it in a Create at {articleId}#create, and isFederatedDocument(document) is the one rule for what federates: a post that is neither a draft nor trashed. Dates go through the @js-temporal/polyfill Instant the vocabulary wants.
3. federation.ts: setObjectDispatcher(Article, POST_OBJECT_PATH, ...) over store.getBySlug filtered by isFederatedDocument, and a real outbox: a cursor-based dispatcher over store.listPosts with setCounter, setFirstCursor and setLastCursor, paging OUTBOX_PAGE_SIZE at a time. The cursor is the offset, so a page URL keeps meaning what it meant.
4. web/negotiate.ts: prefersActivityStreams(accept) decides whether an Accept header asks for ActivityStreams rather than for one of the document representations, using the same q-value and specificity rules as selectRepresentation. Nothing about the existing representations changes.
5. mount.ts: after the Fedify middleware, a handler that answers a post permalink asked for as ActivityStreams with the same Article, built through federation.createContext(request, data). Fedify's own routes are untouched; a browser, a .md request and a .json request all fall through as before.
6. The HTML link: web/documents.ts gains activityStreamsId(document, baseUrl), the renderer puts it on the document context as activityStreams for a federated post, and the packaged base.njk alternates block emits <link rel=alternate type=application/activity+json>. The demo theme only overrides post.njk, so it inherits the tag.
7. Re-export the new names through src/federation/index.ts, src/web/index.ts and src/index.ts.
8. Tests, red first, at two seams: the HTTP surface through createCms().app.request (the object, drafts and pages 404ing, the outbox pages, the permalink under an ActivityStreams Accept, the HTML link tag) and the pure helpers (prefersActivityStreams, postObjectId).
9. Prove the lookup with pnpm dlx @fedify/cli lookup -p against a booted dev server.
10. Root pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added src/federation/paths.ts, src/federation/article.ts and src/federation/article.test.ts; changed federation.ts, mount.ts, federation/index.ts, web/negotiate.ts (+ its test), web/documents.ts, web/render.ts, web/index.ts, src/index.ts, themes/default/layouts/base.njk and themes/default/README.md. @js-temporal/polyfill 0.5.1 is a new direct dependency.

paths.ts is a leaf: the path templates, federationOrigin (moved out of federation.ts), POST_OBJECT_PATH, postObjectPath, postObjectId and createActivityId, importing nothing from the CMS. That is what lets the renderer name a post's object id without importing the Fedify wiring, which would have made web/ and federation/ import each other in a circle: article.ts already reaches the other way for absoluteUrl, tagHref and isPublicDocument.

article.ts holds the mapping. postArticle(context, document) builds the Article doc-4 specifies; postCreateActivity wraps it in a Create at {articleId}#create, addressed the same way, because an activity a follower cannot see announces nothing; isFederatedDocument is the single rule for what federates (a post that is neither draft nor trashed), so the object dispatcher, the outbox and the permalink cannot disagree about what exists.

Three findings.

1. Fedify's vocabulary takes Temporal.Instant for published and updated, and Node 24 has no Temporal. @js-temporal/polyfill was already in the tree under @fedify/vocab; it is now a direct dependency, and toInstant() in article.ts is the one place that casts, because the polyfill's declarations and TypeScript's esnext.temporal lib describe the same object with mutually unassignable types. Fedify recognises an instant by Symbol.toStringTag, so any spec-conformant polyfill works at runtime; the day Node ships Temporal this dependency and the cast both go.

2. Fedify only routes the URLs it minted, so a post permalink asked for as ActivityStreams is not its business. mount.ts answers it: a second middleware behind the Fedify one asks prefersActivityStreams() about the Accept header, resolves the permalink with the public site's own publicDocumentAt, and serves postArticle() through federation.createContext(request, data). The article's id is the object URL either way, so a peer that followed a shared permalink and one that followed the rel=alternate link store one object rather than two. prefersActivityStreams lives in web/negotiate.ts and runs the same q-value and specificity comparison as selectRepresentation, with the ActivityStreams types on one side and the document representations on the other; a tie goes to the document, so Accept: application/* still gets JSON and a browser still gets a page. Nothing about the existing representations, their Link alternates, their extensions or documentJson changed.

3. Outbox paging is cursor-based and the cursor is the offset as a decimal string, with OUTBOX_PAGE_SIZE fixed at 20 rather than read from postsPerPage: an outbox cursor is a URL a peer may come back to, and reading the setting would move every page boundary under whoever is walking the collection when somebody edits it.

The <link rel=alternate> comes from activityStreamsId(document, baseUrl) in web/documents.ts, which the renderer puts on a rendered published post's context as activityStreams and the packaged base.njk emits inside its existing alternates block. The demo theme overrides only post.njk and extends the packaged base, so it inherits the tag with no change. A page, a listing and a draft carry no id and so advertise nothing.

One thing left as it was: a page or a listing asked for with an ActivityStreams-only Accept still earns the 406 doc-3 specifies, because neither federates anything. doc-3's line that ActivityStreams types 'never reach the negotiator' is now true only for post permalinks; the doc is not otherwise wrong and was left alone.

Slug collisions are worth knowing about: doc-4 keys the object on the slug, ContentStore.getBySlug answers with the newest match, and two posts in different years may share a slug. The object dispatcher inherits that rule rather than inventing a second one.

Verification.

Automated, pnpm test from the repo root: 519 + 10 tests, 0 failures.
- src/federation/article.test.ts, 18 tests. AC 1: GET /ap/posts/hello under Accept: application/activity+json is an Article whose content equals renderMarkdown() of the file's body and whose source is { content: the Markdown, mediaType: 'text/markdown' }, with the permalink as url, both dates, attributedTo the actor, to as:Public, cc the followers collection and a Hashtag per tag pointing at the tag archive. AC 2: a draft, a trashed post, a page and an unknown slug all 404 while the published post next to them answers 200, and the outbox leaves the same three out. AC 3: the collection reports totalItems and no inline items, its first page holds OUTBOX_PAGE_SIZE Create(Article) activities newest first, its next page holds the remaining five and has no next, and each Create carries id {articleId}#create, the actor and the Article. AC 4: the rendered post page contains <link rel="alternate" type="application/activity+json" href="{baseUrl}/ap/posts/hello">, and a page, the home listing and a tag archive contain no such link. Plus the permalink under both ActivityStreams spellings, the HTML/Markdown/JSON representations and the .json extension left untouched, and a site in a subdirectory whose object id is host-rooted while its article url keeps the base path.
- src/web/negotiate.test.ts, 5 new tests over prefersActivityStreams: Mastodon's header, a browser's, a feed reader's, a missing one, q-values on both sides, a tie going to the document, and q=0 refusing.

Live, against a dev server (createCms on http://localhost:4321, one published post):
- fedify lookup from @fedify/cli 2.3.6 fetched http://localhost:4321/ap/posts/hello and printed the whole Article — id, attribution, content, name, published, the Hashtag, url, to, cc and source. 'Successfully fetched the object.'
- The same command against the permalink http://localhost:4321/2026/09/hello/ fetched the identical Article, so the content negotiation answers a peer that only has the shared link.
- The same command against http://localhost:4321/ap/actor/outbox?cursor=0 fetched an OrderedCollectionPage holding the Create with its embedded Article and partOf pointing back at the outbox.
- curl confirmed the HTML page carries the rel=alternate link and that the outbox reports totalItems 1 with first and last at ?cursor=0.

Gates, from the repo root: pnpm build, pnpm test, pnpm typecheck, pnpm lint and pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every published post is now an ActivityStreams Article at {baseUrl}/ap/posts/{slug}, and the actor's outbox is the archive of Create activities that announced them.

postArticle() in the new src/federation/article.ts is the single mapping doc-4 describes — id from the slug so a moved post keeps its object, url the permalink, name, the rendered HTML as content, the Markdown as source, published and updated, attributedTo the actor, to Public, cc the followers, a Hashtag per tag — and postCreateActivity() wraps it in a Create at {articleId}#create. isFederatedDocument() is the one rule for what federates, so the object dispatcher, the outbox and the permalink cannot disagree: a draft, a trashed post and a page are none of them. The outbox pages 20 at a time on a cursor that is the offset, which keeps a page URL meaning what it meant when a peer bookmarked it.

A permalink asked for as ActivityStreams is answered with the same Article, because Fedify only routes the URLs it minted and a shared link is somebody's permalink. mount.ts asks the new prefersActivityStreams() about the Accept header and serves the article through federation.createContext(); the existing HTML, Markdown and JSON representations, their Link alternates, their extensions and documentJson are untouched, and a tie in the Accept header still goes to the document. The other direction is the theme: the packaged base layout now emits <link rel=alternate type=application/activity+json> on a published post, from an activityStreams value the renderer puts on the context, so a fediverse client finds the object from the page.

The path constants moved into a new leaf module src/federation/paths.ts, which is what lets the renderer name an object id without the web layer and the federation layer importing each other in a circle.

Verified with 23 new tests (18 in src/federation/article.test.ts across all four criteria, 5 over prefersActivityStreams in src/web/negotiate.test.ts) and live against a dev server, where fedify lookup from @fedify/cli 2.3.6 fetched the Article by its object URL, fetched the identical Article from the post's permalink, and fetched the outbox page with the Create and its embedded Article. pnpm build, test, typecheck, lint and format:check all pass from the repo root.

Two things to carry forward: @js-temporal/polyfill is now a direct dependency because Fedify's vocabulary takes Temporal.Instant and Node 24 has none, with one documented cast in toInstant(); and the object id is keyed on the slug, which ContentStore.getBySlug resolves to the newest match when two posts in different years share one.
<!-- SECTION:FINAL_SUMMARY:END -->
