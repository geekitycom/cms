---
id: TASK-150
title: BreadcrumbList JSON-LD and visible breadcrumbs in the default theme
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-10-01 13:01'
labels:
  - seo
  - theme
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/seo/breadcrumbs/'
  - 'https://specification.website/spec/seo/structured-data/'
priority: low
type: enhancement
ordinal: 174800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The theme emits WebSite, Person, ProfilePage and BlogPosting JSON-LD (partials/jsonld.njk), but no BreadcrumbList. Posts in a category and archive pages have a natural hierarchy that search results can show.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Posts with a category, category and tag archives, and author archives emit BreadcrumbList JSON-LD
- [x] #2 The default theme shows a matching visible breadcrumb in a labelled nav
- [x] #3 The JSON-LD validates with the schema.org validator
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: one trail, a list of { name, url } (root-relative), built once at the top of layouts/base.njk from the context the page already has, so the visible nav and the JSON-LD read the same list and cannot drift. Home first, then: the first category and the post on a post with categories; the category, tag or author on their archives; a 'Page N' crumb past page one. Empty everywhere else.
2. Move the author-archive test (isProfilePage) from partials/jsonld.njk to base.njk beside isEntry, since the trail needs it too.
3. partials/jsonld.njk pushes a BreadcrumbList node (ListItem position, name, absolute item) when the trail is non-empty.
4. partials/breadcrumbs.njk prints nav.breadcrumbs aria-label=Breadcrumb with an ol; the last crumb is aria-current=page text, separators aria-hidden. base.njk includes it at the top of main in a new overridable breadcrumbs block.
5. Style it in themes/default/src/style.css like the kicker (target + quiet-link), so it passes the every-nav-reads-as-links rules.
6. Tests first in src/web/page-shell.test.ts: JSON-LD on each page kind, absence elsewhere, categoryBase honoured, page two, the visible nav matching the JSON-LD, link style at rest.
7. README: the breadcrumbs block, the trail, the BreadcrumbList node.
8. Verify: build/test/typecheck/lint/format, curl a running demo, and submit the rendered page to validator.schema.org.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: one trail, `breadcrumbs`, a list of { name, url } set at the top of layouts/base.njk. partials/breadcrumbs.njk (visible, in a new `breadcrumbs` block at the top of <main>) and partials/jsonld.njk (BreadcrumbList) both print it, so they cannot drift. Home is labelled 'Home'. A post uses its first category; a post with no category, pages, the front page and search have no trail. Past page one an archive gets a 'Page N' crumb so the archive crumb stays a link. The author-archive test moved from jsonld.njk to base.njk as isAuthorArchive, because the trail needs it too.

Tests (TDD): new 'breadcrumbs (TASK-150)' suite in packages/cms/src/web/page-shell.test.ts. Before the templates changed, four of five failed with 'actual: undefined' for the BreadcrumbList and 'has no visible breadcrumb' / 'the breadcrumb has no links'. All pass now.

Validation: pnpm build, pnpm test (2735 cms + 30 demo pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all clean. Ran the demo (tsx server.ts) and curled /2026/08/one-url-many-representations/, /category/engineering/, /category/engineering/page/2/, /tag/web/: each has the nav and the BreadcrumbList; / has neither. Posted each page's HTML to https://validator.schema.org/validate: totalNumErrors 0, totalNumWarnings 0 for all four, and for an author archive (/author/ada/) rendered from a scratch site with a user, since the demo has no author account. Checked the validator flags errors by posting a ListItem with a bad property (INVALID_PREDICATE, totalNumErrors 1). Server stopped. The anonymous-pages golden uses a bare theme and did not change.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added breadcrumbs to the default theme. layouts/base.njk builds one trail (`breadcrumbs`, a list of { name, url }) for posts with a category and for category, tag and author archives, with a Page N crumb past page one. The new partials/breadcrumbs.njk prints it as nav.breadcrumbs aria-label="Breadcrumb" with the current page as aria-current text, in a new overridable `breadcrumbs` block. partials/jsonld.njk prints the same list as a BreadcrumbList. Styled like the kicker links (underlined at rest, 24px targets); README documents the block, the trail and the node. Verified with a new page-shell test suite (failed before, passes after), the full build/test/typecheck/lint/format run, curl against the running demo, and the schema.org validator reporting 0 errors and 0 warnings on post, category, category page 2, tag and author archive pages.
<!-- SECTION:FINAL_SUMMARY:END -->
