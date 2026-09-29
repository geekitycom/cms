---
id: TASK-129
title: Themed 500 page for unhandled errors
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 00:35'
labels:
  - resilience
milestone: m-18
dependencies: []
references:
  - 'https://specification.website/spec/resilience/error-pages/'
priority: high
type: feature
ordinal: 153800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An unhandled error in a public route returns the framework's plain-text 500. Readers get no way forward, and the response does not use the site's theme. A site should get a themed error page that returns 500, explains the failure plainly, links home, and never shows a stack trace. The error itself should still be logged for the operator.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An exception thrown while rendering a public page returns status 500 with the theme's 500 template
- [x] #2 Themes can override the 500 template the way they override 404; the default theme ships one
- [x] #3 If rendering the themed page fails too, a minimal static HTML 500 is returned instead of a crash
- [x] #4 No stack trace or internal path appears in the response body; the error is logged with the request path
- [x] #5 Admin routes return a 500 in the admin's own layout
- [x] #6 JSON and Markdown representations return a 500 in their own format, not HTML
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first in packages/cms/src/web/server-error.test.ts, all through HTTP: a probe theme whose post layout throws (AC1), a theme 500 override vs the default theme's (AC2), a theme whose 500 layout throws too (AC3), body free of stack/paths and console.error called with the path (AC4), a throwing admin route answering in the admin layout (AC5), .json/.md/Accept requests answering JSON and Markdown 500s (AC6). Also: 500 carries Cache-Control no-store, nosniff, no X-Redirect-By.
2. Renderer: TEMPLATES.serverError = layouts/500.njk and renderServerError(url), same lookup order as 404. Default theme ships layouts/500.njk; theme README lists it.
3. Admin: pages/error.njk extending the bare layouts/base.njk (no session, menu or site data, since any of those may be what broke), ADMIN_TEMPLATES.serverError, and a render function in src/admin/errors.ts.
4. src/web/errors.ts: one app.onError handler, registered in createCms. Logs method, path and error; picks admin page for /admin paths, else representation from .md/.json suffix then Accept; falls back to static HTML if a themed or admin render throws; sets Cache-Control no-store.
5. Verify: pnpm build, test, typecheck, lint, format:check; curl the demo with a broken theme template for the HTTP criteria.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
One app.onError handler (src/web/errors.ts, registered first thing in createCms). Hono's compose catches a throw at the innermost middleware and runs onError there, so every middleware that wraps the handler still runs on the way out: verified that the 500 carries X-Content-Type-Options, the admin's CSP/Referrer-Policy/X-Frame-Options, and no X-Redirect-By. Errors thrown from resolveRequest (the app.notFound handler, where most public pages render) reach onError the same way.
Decisions: an HTTPException is passed through with getResponse(), as Hono's default handler does, so a deliberate 4xx is not turned into a 500. Representation is the .md/.json suffix first, then Accept over the document representations, then HTML. Every 500 is Cache-Control: no-store. The admin page extends the bare admin layouts/base.njk, not shell.njk, because the shell reads the session, menu and site, which may be what failed; it gets its own lazily built admin environment because mountAdmin's is closed over. A second failure rendering the 500 page is logged too and answered with a static HTML page.
Validation: pnpm build && pnpm test (2312 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass. Curled a served throwaway site (geekity init + a theme whose page/post layouts call an undefined function): /about/ 500 themed page with no-store and nosniff; with 500.njk also broken, the static page; test-only throwing routes /broken/index.json, /broken/index.md, Accept: text/markdown, and a signed-in /admin/broken each answered 500 in their own format; server log showed 'GET <path> failed:' lines with the stack. Server stopped afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Unhandled errors now answer with a proper 500 instead of Hono's plain text. Public HTML gets the theme's layouts/500.njk (default theme ships one, themes override it through the usual lookup order), a static HTML page if that template fails too, JSON or Markdown bodies for .json/.md URLs or matching Accept, and admin paths get pages/error.njk in the admin's bare layout. Bodies carry nothing from the error; the operator log gets method, path and the error. All 500s are Cache-Control: no-store and keep the baseline and admin headers. Verified by src/web/server-error.test.ts (8 HTTP tests), the full build/test/typecheck/lint/format chain, and curl against a served site with a broken theme.
<!-- SECTION:FINAL_SUMMARY:END -->
