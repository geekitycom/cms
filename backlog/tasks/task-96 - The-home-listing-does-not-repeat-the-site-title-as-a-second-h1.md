---
id: TASK-96
title: The home listing does not repeat the site title as a second h1
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 00:42'
updated_date: '2026-09-20 00:46'
labels:
  - theme
  - web
dependencies: []
references:
  - packages/cms/themes/default/layouts/home.njk
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/themes/default/layouts/front-page.njk
  - packages/cms/src/web/page-shell.test.ts
type: bug
ordinal: 121800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
At the root path, `layouts/base.njk` heads the site with `<h1 class="main-heading">` carrying the site title (base.njk:111, guarded by `atRoot`). Every other path gets a plain `header-link-home` link instead. `layouts/home.njk` then prints `<h1 class="page-title">{{ title }}</h1>` unconditionally (home.njk:6), and on the home listing `title` is the site title. So the root listing carries two h1 elements holding the same words: https://shll.me/ shows 'Shll.me' as the header h1 and again as the page title.

`layouts/front-page.njk` already decided this the right way and says so in its own comment: it prints no title, 'because layouts/base.njk heads the root path with the site title and a second h1 under it would be one heading too many'. A site with a front page set is therefore correct today; only a site whose root is the listing is wrong. That is the out-of-the-box default, so every new Geekity site has it.

The fix is to guard home.njk's heading the same way base.njk guards its own, on `atRoot` rather than on the title text. A posts page at a path of its own — /blog/, say — gets only the small link home in the header, so it still needs its page title, and it needs it even on a site whose posts page happens to share the site's name.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The root listing carries exactly one h1, the site title in the header, proven by a test
- [x] #2 A posts listing at a path of its own still prints its page title as an h1, since the header gives it only the link home, proven by a test
- [x] #3 A paginated root listing carries exactly one h1 on every page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a test to packages/cms/src/web/page-shell.test.ts that counts h1 elements on the root listing, on a posts page at its own path, and on page 2 of the root listing.
2. Watch it fail on the root listing.
3. Guard home.njk's page-title h1 with atRoot, the same variable base.njk guards its own heading with, and confirm a child block can read it.
4. Run the full checks.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
layouts/home.njk now guards its page-title heading with atRoot, the variable layouts/base.njk sets at base.njk:29 and guards its own header heading with. A child block can read it: the tests below pass with the guard and fail without it.

Two tests were added to packages/cms/src/web/page-shell.test.ts: one counts the h1 elements on the root listing and on page two of it, and one proves a listing at its own path still heads itself. The second needed both homepage and postsPage set, since a posts page is only a listing on a site that has given / to something else.

One existing test changed. packages/cms/src/web/listings.test.ts asserted that / prints an h1 carrying the site title inside <main> (TASK-82 AC #3). That is the behaviour this task removes, so the case for / was taken out of 'heads the home page and every archive' — now 'heads every archive' — and replaced by a test that the home listing heads itself with nothing while the header heads it. The tag and category archives are untouched and still head themselves.

Page two of the root listing keeps its page-title h1, and should: /page/2/ is not the root path, so the header steps down to the small link home and something has to head the page. Either way the page carries exactly one h1.

pnpm build, test (1940 + 30), typecheck, lint and format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The root listing carried two h1 elements holding the same words: the site title from the shell's header, which layouts/base.njk prints only at the root, and the listing's own title, which is that same title. layouts/home.njk now prints its heading only when the page is not the root, the way layouts/front-page.njk already left its title out for the same reason. A listing at a path of its own still heads itself, because there the header gives it only the small link home. Proven by two new tests in page-shell.test.ts counting the headings on the root listing, on page two of it, and on a posts page at /news/.
<!-- SECTION:FINAL_SUMMARY:END -->
