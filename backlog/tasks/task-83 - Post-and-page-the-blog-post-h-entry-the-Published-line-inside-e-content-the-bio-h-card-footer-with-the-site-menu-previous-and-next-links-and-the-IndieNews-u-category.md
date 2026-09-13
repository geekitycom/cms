---
id: TASK-83
title: >-
  Post and page: the blog-post h-entry, the Published line inside e-content, the
  bio h-card footer with the site menu, previous and next links, and the
  IndieNews u-category
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 13:37'
updated_date: '2026-09-13 18:38'
labels:
  - web
milestone: m-14
dependencies:
  - TASK-82
references:
  - packages/cms/themes/default/layouts/post.njk
  - packages/cms/themes/default/layouts/page.njk
  - packages/cms/themes/default/partials/byline.njk
  - >-
    /Users/andrewshell/code/wordpress/asdo-theme/template-parts/content-essay.php
  - /Users/andrewshell/code/wordpress/asdo-theme/template-parts/bio.php
  - >-
    backlog/decisions/decision-16 -
    The-default-theme-follows-the-andrewshell.org-design-identity-comes-from-user-profiles-structured-data-is-JSON-LD-the-theme-emits.md
type: feature
ordinal: 108800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite layouts/post.njk and layouts/page.njk to the source entry (decision-16): article.blog-post.h-entry with header > h1.p-name, section.e-content holding the rendered body and then a paragraph with an a.u-url to the permalink wrapping time.small.dt-published Published (long date), and a time.small.dt-updated Updated line when the updated date differs by day; on a post the paragraph starts with an a.u-category.small link to https://news.indieweb.org/en reading #indienews when the post is tagged indienews. Then an hr and a footer holding the bio. partials/bio.njk is new: div.bio.p-author.h-card with a .bio-avatar img.u-photo of the author avatar at 50px, Written by a.p-name.u-url[rel="author me"] to the author url (the profile link when one is marked as the website, else the author archive), a job title as p-job-title and a location as p-locality when present (TASK-79), and an ul.hlist of the site menu items, so the navigation setting is what the bio lists. The author is the post author on a post and siteAuthor on a page; with neither the bio is omitted. After the article on a post: nav.blog-post-nav with rel prev and next links to previous and next when present, then the conversation and the comment form as now. Categories and tags are printed under the entry as p.post-categories of p-category links, categories then tags. The byline partial is retired in favour of the bio and the README says how a site that used it moves.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post renders article.blog-post.h-entry with h1.p-name, section.e-content containing the body and a trailing paragraph with a.u-url > time.dt-published Published and, only when the day differs, time.dt-updated Updated, then hr and footer .bio
- [x] #2 partials/bio.njk renders .bio.p-author.h-card with .bio-avatar img.u-photo, Written by a.p-name.u-url[rel="author me"], p-job-title and p-locality only when set, and an .hlist of the site menu; a post with no resolvable author and a page with no siteAuthor omit the bio
- [x] #3 A post tagged indienews prints a.u-category[href="https://news.indieweb.org/en"] at the start of the Published paragraph and no other post does
- [x] #4 nav.blog-post-nav prints rel="prev" and rel="next" links to the neighbouring posts with their titles and arrow text, and is absent when a post has neither
- [x] #5 Categories and tags print as p.post-categories a.p-category under the entry; the demo theme override that extends the base layout still renders its byline and reading time; the stylesheet gains the blog-post, bio, bio-avatar and blog-post-nav rules
- [x] #6 The theme README documents the bio partial, the retirement of partials/byline.njk and the e-content shape; site.test.ts and the demo site test are updated and pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Red first: a new packages/cms/src/web/entry.test.ts booting the packaged theme over HTTP — the blog-post h-entry and its e-content Published paragraph, the Updated line only when the day differs, the indienews u-category, the bio, the blog-post-nav, and where the site menu lands.
2. partials/bio.njk (new): .bio.p-author.h-card with .bio-avatar img.u-photo at 50px, 'Written by' a.u-url.p-name[rel="author me"] to the person's archive, .p-job-title and .p-locality when set, and nav.site-nav > ul.hlist of the site menu. An optional bioProfile switch adds the person's p-note and their rel="me" links, which is what an author archive wants and an entry footer does not (the page footer already prints the site's).
3. layouts/post.njk: article.blog-post.h-entry > header > h1.p-name, section.e-content holding the body then p.entry-meta with the optional a.u-category #indienews, a.u-url > time.small.dt-published Published, and time.small.dt-updated when date('html') differs; categories then tags as p.post-categories under the entry; hr; footer with the bio; then nav.blog-post-nav with rel=prev/next, the conversation and the comment form.
4. layouts/page.njk: the same entry with p.page-meta, no indienews, no taxonomy, no neighbours; the contact form after.
5. layouts/author.njk: the archive header becomes an h1 plus the bio partial with bioProfile, so one partial owns the h-card and the .author-* rules go.
6. partials/tags.njk: list(tags) emits p.post-categories of a.p-category like categories(); retire partials/byline.njk.
7. layouts/base.njk: the footer menu prints only when the page has no bio (the layout sets bioAuthor, which a child's top-level set makes visible to the parent), so the menu shows exactly once — in the bio on an entry and an author archive, in the footer on a listing and the 404.
8. static/style.css: .blog-post header rules, the entry meta, .bio-note/.bio-links/.bio .p-name; delete .post-title, .post-meta, .tag-list, .tag and the .author-* block; .post-body/.page-body selectors become .e-content.
9. apps/demo: the demo post layout writes its own byline span now byline.njk is gone, and its stylesheet styles .post-categories where it styled .tag-list.
10. Update the tests that read the retired markup (admin/editor.test.ts, page-shell.test.ts's menu rule, site.test.ts's menu, the demo site test) and document the entry, the bio and the menu rule in the theme README.
11. pnpm build && test && typecheck && lint && format:check, plus curl against a booted site for the HTTP criteria.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the entry, the bio and the menu rule.

**The entry.** `layouts/post.njk` and `layouts/page.njk` are now the source theme's `content-essay.php` and `content-page.php`: `article.blog-post.h-entry` > `header > h1.p-name`, `section.e-content` holding the rendered body and then `p.entry-meta` (a post) or `p.page-meta` (a page) with the permalink as a `u-url` around a `time.small.dt-published` Published line, and a `time.small.dt-updated` Updated line only when `date("html")` — the calendar day in the site's timezone, which is what the source compares — differs. A post tagged `indienews` opens that paragraph with `a.u-category.small` to https://news.indieweb.org/en. Categories then tags print inside the article as two `p.post-categories`, so each link is a `p-category` of the entry. Then `hr`, `footer` with the bio, and after the article `nav.blog-post-nav` with the rel=prev/next arrows, the conversation and the comment form.

**Two judgement calls the task left open.**
- The bio credits `author or siteAuthor` on a post, not `author` alone. `siteAuthor` on an entry is already the document's author when it names one, so this only changes the post that names nobody: it gets the site's author, which is what the source's `bio.php` does (it reads `asdo_site_author_id()` on posts and pages alike). A post naming nobody on a site whose author setting names nobody has no bio, and then no rule and no empty footer either.
- A page's meta line is usually empty — a colophon was not published on a Tuesday — so it renders as a literally empty `<p class="page-meta"></p>` and the stylesheet hides it with `:empty`. The paragraph stays so a site has one hook wherever it is, and it is what tells the page layout from the post layout in the tests that assert which layout drew a page.

**The bio.** `partials/bio.njk` is new and `partials/byline.njk` is gone. It renders `div.bio.p-author.h-card` from `bioAuthor`: `.bio-avatar > img.u-photo` at 50px, the lead (`bioLead`, "Written by" by default), the name as `a.u-url.p-name[rel="author me"]` to their archive or an unlinked `strong.p-name` for a name this site has no account for, then `p-job-title` and `p-locality` when the profile says, then the site menu. `bioProfile` adds their `p-note` and their `rel="me"` links.

`layouts/author.njk` now uses it with `bioProfile` and `bioLead = "Posts by"`, so one partial owns the theme's only h-card and the `.author-avatar`, `.author-bio` and `.author-links` rules could go. The source design has no author archive at all, so nothing was ported away there; `listings.test.ts` still proves the archive's `h-card`, `u-photo`, `p-name`, `p-note` and `rel="me" u-url` from the outside, with one assertion rewritten because the class list is no longer the last attribute on the name.

**Where the menu is.** In the bio, as `nav.site-nav > ul.hlist` — the same markup the footer had, so every selector that reads it still works, and a screen reader still gets a landmark. `layouts/base.njk` prints it in the footer only when `bioAuthor` is unset, which a child layout's top-level `{% set %}` makes visible to the parent. So: in the bio on a post, a page and an author archive; in the footer on a listing, the 404 and any layout of a site's own (the demo's post override keeps the footer menu by saying nothing). On the page, once. Documented in both READMEs.

**Everything else.** `taxonomy.list(tags)` is the same `p.post-categories` of `p-category` links `categories()` is, with `rel="tag"` where categories take `rel="category"`. The stylesheet gained `.blog-post header h1/p`, the meta line and its `:empty` rule, `.bio .p-name`, `.bio-note`, `.bio .site-nav`, `.bio-links` and `.blog-post-nav`, and lost `.post-title`, `.post-meta`, `.post-footer`, `.tag-list`, `.tag` and the `.author-*` block; `.post-body, .page-body` became `.e-content`, which covers both. No colour token changed. The demo writes its own byline h-card now that `byline.njk` is gone and wraps its tags in `.post-tags` so its stylesheet can keep hashing them.

**Verification.** `packages/cms/src/web/entry.test.ts` is new, written red first: 17 tests over HTTP against the packaged theme covering the article and its e-content, the Published line, the Updated line on a differing day and its absence on the same day and with no update at all, the empty page meta line, the bio's photo, name, job title and locality, the fields a thin profile leaves out, an unlinked name, the site with nobody to credit, the menu in the bio and in the footer, the IndieNews link and the two posts that must not have one, the neighbours at both ends of the archive, and the two paragraphs of categories and tags.

Updated with the markup: `page-shell.test.ts` (the footer helper now reads the footer after `</main>`, since an entry prints a `<footer>` of its own, plus a new test for where the menu lands on each page kind), `listings.test.ts`, `site.test.ts`, `front-page.test.ts`, `admin/editor.test.ts`, `admin/appearance.test.ts`, `web/theme-choice.test.ts` and `apps/demo/test/site.test.ts`.

`pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` all pass: 1827 tests in the package, 27 in the demo, 0 failures, and `pnpm test:11ty` is green too. Also booted a site wearing the packaged theme over a real port and curled it: a post, a page, an author archive, the home listing and a 404 — the entry, the bio, the neighbours, the empty `<p class="page-meta"></p>` and the menu in exactly one place per page are all as asserted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rewrote the post and page layouts as the andrewshell.org entry (decision-16): article.blog-post.h-entry with an h1.p-name header, the body and a Published line together in section.e-content — the permalink as a u-url around a dt-published time, a dt-updated line only when the calendar day differs, and an IndieNews u-category opening the line on a post tagged indienews — then the categories and tags as p-category links, a rule and a footer holding the new partials/bio.njk. The bio is the theme's only h-card now: photo, 'Written by' linked rel="author me", job title and locality, and the site menu as an hlist; partials/byline.njk is retired and layouts/author.njk heads the archive with the same partial. The menu is on every page once — in the bio where there is one, in the base layout's footer where there is not. Verified with a new src/web/entry.test.ts written red first (17 HTTP tests), the updated shell, listings, front-page, editor, appearance, theme-choice and demo tests, a full pnpm build/test/typecheck/lint/format:check (1854 tests, 0 failures) and curl against a booted site wearing the packaged theme.
<!-- SECTION:FINAL_SUMMARY:END -->
