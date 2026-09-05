---
id: TASK-58
title: 'Demo: a contact page that exercises the contact form'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 10:58'
updated_date: '2026-09-05 11:28'
labels:
  - demo
  - email
milestone: m-8
dependencies:
  - TASK-56
references:
  - apps/demo/content/pages/about.md
  - packages/cms/themes/default/partials/contact-form.njk
documentation:
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
type: chore
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-56 added a contact form to any page carrying `contact: true`, but `apps/demo` has no such page, so the feature is never rendered in the demo site, never covered by the Eleventy compatibility suite in `packages/cms/test`, and never seen by someone evaluating the package. Add `apps/demo/content/pages/contact.md` with `contact: true` (and `navigation: true` so it is reachable from the menu), with a short body explaining the form, so the demo shows the form, the pack-install smoke and Eleventy suites see a page with the key, and a reviewer can submit a message locally and find it under `data/contact/` and on the admin Messages screen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The demo site renders the contact form below the content of /contact/ and the page appears in the navigation
- [x] #2 The Eleventy compatibility suite still builds the demo content with the new page and ignores the `contact` key without warnings
- [x] #3 The demo tests in apps/demo/test cover that the contact page renders the form and that the destination address does not appear in the HTML
- [x] #4 The demo README or content mentions that submissions land under data/contact and on the admin Messages screen
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seam: the demo site over HTTP, as apps/demo/test/site.test.ts already boots it (createCms over the demo's own contentDir/themeDir, port 0, temporary dataDir). No new seam.
2. Red: add three failing assertions to apps/demo/test/site.test.ts — /contact/ serves the packaged contact form (action=CONTACT_POST_PATH plus the four named fields), the site navigation carries a link to /contact/, and the site's configured contactEmail (read from apps/demo/content/_data/site.json through readSiteSettings) appears nowhere in the HTML.
3. Green: add apps/demo/content/pages/contact.md with contact: true, navigation: true, an explicit permalink and a body explaining what the form does and where a message lands (data/contact/ and /admin/messages). Add a placeholder contactEmail to content/_data/site.json so the address assertion has something to look for.
4. Confirm the Eleventy compatibility suites (apps/demo/test/eleventy.test.ts and packages/cms/test/eleventy.test.ts) still build the demo content with the new page and write /contact/index.html, with no warning on the contact key.
5. Note in the root README's demo section where a submission lands, so AC #4 holds outside the page body too.
6. Verify: pnpm build, test, typecheck, lint, format:check, test:11ty from the repo root, plus scripts/pack-install-smoke.sh.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added apps/demo/content/pages/contact.md (contact: true, navigation: true, permalink /contact/). Its body explains the two front matter keys and says a message is written to data/contact/ before anything is emailed and waits on the admin Messages screen.

Added "contactEmail": "hello@example.com" to apps/demo/content/_data/site.json so the demo actually configures a destination and the 'not in the HTML' assertion has something real to look for. Without a configured address that test would pass vacuously, so it asserts the setting is non-empty first.

Three tests in apps/demo/test/site.test.ts, at the seam the file already uses (the demo booted over HTTP with its own contentDir/themeDir, port 0, temporary dataDir): the form is under /contact/ posting to CONTACT_POST_PATH with the four named fields; the home page renders a site-nav with a Contact item; the contactEmail read back through readSiteSettings appears in neither /contact/ nor /. Red first — 404, 'the demo renders no menu at all', and 'the demo configures no contact address to look for' — then green.

Also added a paragraph to the demo section of the root README covering the same ground.

Eleventy: pnpm test:11ty passes both suites, the demo build went from 8 to 9 written files, and grepping the whole run for warn/error turns up nothing — the contact key is ignored silently, the way navigation: true is.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
apps/demo now has a contact page, so TASK-56's form is rendered by the demo, built by the Eleventy suites and visible to anyone evaluating the package.

content/pages/contact.md carries contact: true and navigation: true, an explicit /contact/ permalink, and a body that explains both keys and says where a submission lands — data/contact/ as a JSON file before anything is emailed, and the admin Messages screen. content/_data/site.json gains contactEmail: hello@example.com so the demo configures a real destination. The root README's demo section says the same thing for a reader who never boots the site.

Three tests in apps/demo/test/site.test.ts, written red first, at the seam that file already uses: the form is under /contact/ posting to CONTACT_POST_PATH with the name, email, subject and message fields; the home page renders a site-nav carrying a Contact item; the configured contactEmail, read back through readSiteSettings, is in neither /contact/ nor / — asserted non-empty first so it cannot pass vacuously.

Verified from the repo root: pnpm build, pnpm test (1372 + 14 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check and pnpm test:11ty (15 + 5 pass, 0 fail, no warning on the contact key; the demo build wrote 9 files where it wrote 8) all pass, and bash scripts/pack-install-smoke.sh passed against a packed tarball.
<!-- SECTION:FINAL_SUMMARY:END -->
