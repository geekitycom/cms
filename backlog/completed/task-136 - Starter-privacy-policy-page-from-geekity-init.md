---
id: TASK-136
title: Starter privacy policy page from geekity init
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 03:55'
labels:
  - privacy
  - docs
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/privacy/privacy-policy/'
priority: low
type: feature
ordinal: 160800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A new site starts with no privacy policy, and the site owner has to work out what the CMS itself collects. geekity init could scaffold a plain-language starter page that lists exactly what the CMS stores: comment and contact data, the IP hash, the admin session cookie, federation data, and optional Akismet. The owner then edits it for anything they add. It must be clearly marked as a starting point, not legal advice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 geekity init writes a privacy page to templates/site with every CMS-collected item listed, and optional features (Akismet, contact form) marked as such
- [x] #2 The default theme's footer links to the privacy page when it exists
- [x] #3 The demo site includes the page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Link by setting, not by slug: the default footer prints menus.footer and nothing of its own (TASK-105), so the starter site.json types 'Privacy | /privacy/' into menus.footer, the same way About is typed into menus.primary. The link exists exactly when the site's menu names the page; a theme-owned slug check would reintroduce a link no setting controls.
2. Failing tests first in packages/cms/src/seed.test.ts: starter files include pages/privacy.md; menus.footer holds RSS then Privacy; the served starter footer links /privacy/; /privacy/ answers 200 and names every item in the README Personal data table, the cookie, avatars proxying, Referrer-Policy, optional Akismet/contact form/reply emails, webmentions, federation, the 180/30/365 periods, and says it is a starting point and not legal advice.
3. Failing tests in apps/demo/test/site.test.ts: /privacy/ served and the footer links it.
4. Write packages/cms/templates/site/content/pages/privacy.md from the README Personal data table; add the menu line; copy the page into apps/demo/content/pages and add the footer line to apps/demo site.json.
5. Mention the starter privacy page in the README Personal data section.
6. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check; boot a geekity-init site and curl / and /privacy/.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Footer link decision: a menus.footer line ('Privacy | /privacy/') in the starter and demo site.json, not a theme-owned slug check. The default footer prints menus.footer and nothing of its own (TASK-105), so the link exists exactly when the site's menu names the page, like About in menus.primary; a theme link keyed on /privacy/ would be a link no setting controls and would need a theme override to remove. The page's owner note says to delete the line if the page is deleted. Upgrading sites get neither; the README says to copy the template.
The page is written from the README Personal data table: comments (name, website, words; optional email deleted after 180 days; salted IP hash after 30), moderation and reply emails via the mail provider, opt-out list, contact form (optional; 365 days), Akismet (optional; Automattic; fields listed), webmentions sent and received, ActivityPub copies and follower profiles and inbound activities, avatars proxied through data/avatars, accounts and the __Host-geekity_session cookie, no reader cookies, in-memory rate limits, access log without addresses unless accessLogAddress, Referrer-Policy origin-only, retention sweep, erasure via Tools > Personal data. Not mentioned: IndieNews/syndication (not built).
Validation: pnpm build && pnpm test (2422 + demo 31 + others, 0 fail), pnpm test:11ty (0 fail; demo build writes /privacy/), pnpm typecheck, pnpm lint, pnpm format:check all pass. Booted a geekity init site from dist: GET / footer nav lists RSS and Privacy; GET /privacy/ 200 with no Set-Cookie; server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity init now writes content/pages/privacy.md (/privacy/), a plain-language starter privacy page generated from what the CMS stores, with the contact form, reply emails and Akismet marked optional, the new-site retention periods (180/30/365 days) quoted, and a note to the owner that it is a starting point, not legal advice, to review and keep in step with Settings > Discussion. The starter site.json adds 'Privacy | /privacy/' to menus.footer, which the default theme's footer prints; the demo site carries the same page and footer line; the README documents it. Verified with new seed tests (files, menu, served footer, page content per README table), a demo site test, the full build/test/test:11ty/typecheck/lint/format suite, and curl against a freshly initialised site.
<!-- SECTION:FINAL_SUMMARY:END -->
