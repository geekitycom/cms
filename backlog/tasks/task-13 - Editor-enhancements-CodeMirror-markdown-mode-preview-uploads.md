---
id: TASK-13
title: 'Editor enhancements: CodeMirror markdown mode, preview, uploads'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 03:38'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-11
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: enhancement
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Progressive enhancement of the editor textarea with CodeMirror 6 in markdown mode, a preview tab that POSTs the body to /admin/preview and renders it through the theme post template, and an upload endpoint that stores files under content/uploads/{yyyy}/{mm}/ and returns the Markdown image or link syntax to insert.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The editor works without JavaScript and upgrades to CodeMirror when it loads
- [x] #2 Preview renders the current unsaved body using the same Markdown pipeline as the public site
- [x] #3 Uploading an image via the editor stores it under content/uploads and the returned path renders on the public site
- [x] #4 Uploads reject files over a configurable size limit and disallowed types
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test: the Hono surface through `app.request` — GET the editor (the no-JS textarea and the module script tag), POST /admin/preview, POST /admin/uploads (multipart), and the public GET of /uploads/... — plus resolveConfig for the new options. New colocated node:test files src/admin/editor.test.ts and src/config additions, on the existing __testing__/harness, which gains a multipart post().
2. Serve uploads publicly. content/uploads is already outside the index (isDocumentPath skips it) and Eleventy passthrough-copies it to /uploads/, but the CMS server has never served it. Add an /uploads/* route to mountPublicSite over findAsset(contentDir/uploads), with the same etag, 304 and cache handling theme assets get, so the path an upload returns resolves on the running site exactly as it does in an Eleventy build.
3. Config: uploadMaxBytes (default 10 MiB, GEEKITY_UPLOAD_MAX_BYTES) and uploadTypes (default png, jpg, jpeg, gif, webp, avif, pdf, txt, md; GEEKITY_UPLOAD_TYPES as a comma-separated extension list). SVG is left out of the default on purpose: it is script-bearing HTML served from the site's own origin. Documented in the README config table.
4. POST /admin/preview: takes title, body and the kind, renders the body through renderMarkdown and hands a synthetic Document to documentContext, then renders the theme's post or page template. Same pipeline, same template as the public site, so what the preview shows is what saving would publish. Behind the admin guard, so it carries the CSRF token like every other POST.
5. POST /admin/uploads: multipart, CSRF-protected, one file. The extension has to be in the allowlist, the declared MIME type has to agree with the extension, and the image and PDF types are sniffed for their magic bytes as well; a size over the limit is a 413 and a rejected type a 415, both as JSON. Content-Length is checked before the guard parses the body, so an oversized upload is refused by its headers rather than read into memory. The file lands at content/uploads/{yyyy}/{mm}/{slug}{ext}, suffixed -2, -3 rather than overwriting, and the response is { url, markdown } with an image's markdown as ![alt](url) and everything else's as [name](url).
6. The CodeMirror bundle. esbuild and codemirror are devDependencies of packages/cms; editor/main.ts is bundled to admin/static/editor.js by scripts/build-editor.js, wired into the package's build so prepare, CI and publishing all produce it. The bundle is a build product: gitignored, prettier-ignored, and shipped by the existing admin entry in files. editor/ has a tsconfig of its own (DOM lib) so the entry is type checked and eslint's project service can see it; the package's typecheck runs both projects.
7. Progressive enhancement. The template keeps the plain textarea and gains a no-JS Preview button (formaction=/admin/preview, formtarget=_blank) and one marker element carrying the URLs. The bundle builds everything else: CodeMirror over #editor-body syncing into the textarea on every change, a Write/Preview toggle that posts the current body and shows the HTML in an iframe srcdoc, and an upload control that posts to /admin/uploads and inserts the returned Markdown at the cursor. With JS off the textarea and the Preview button are the whole editor.
8. Verify: package test/typecheck/lint, root lint/typecheck/test/format:check, root build with the bundle present, demo test, and a manual pass against apps/demo covering the browser attaching CodeMirror, a preview, an image upload fetched at its returned public path, an oversized file and an .exe. Remove everything written under apps/demo/content and release port 3000.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Progress

Server side is done and green. New files: `src/content/media.ts` (the upload media-type table, its signatures and the normaliser), `src/admin/preview.ts` (POST /admin/preview), `src/admin/uploads.ts` (POST /admin/uploads and the pre-guard Content-Length check), `editor/main.ts` plus `editor/tsconfig.json` (the browser code), `scripts/build-editor.js` (esbuild). Changed: `src/config.ts` (uploadMaxBytes, uploadTypes), `src/web/assets.ts` and `src/web/routes.ts` (the public /uploads/* route), `src/admin/documents.ts` (the editor's new context), `admin/layouts/document-editor.njk`, `admin/static/admin.css`, the three barrels, README, eslint/prettier/git ignores, package.json scripts.

Package `pnpm test` 437 pass (407 before; 30 new across editor.test.ts, site.test.ts and config.test.ts), typecheck and lint clean; root lint, typecheck, test (437 + 10), test:11ty (6 + 5) and format:check clean. `pnpm build` writes admin/static/editor.js at 599 kB.

## Decisions

- **The bundle is a build product, and CodeMirror is a devDependency.** There is no bundler anywhere else in this repository and the admin must work offline, so a CDN was never an option. `packages/cms/editor/main.ts` is bundled by esbuild (`scripts/build-editor.js`) into `admin/static/editor.js`, 599 kB minified. `pnpm build` runs the bundler after `tsc`, so the root `prepare`, every CI job and a publish all produce it; `admin/` was already in the package's `files`, and `npm pack --dry-run` confirms `admin/static/editor.js` is in the tarball. It is gitignored, prettier-ignored and eslint-ignored, and the source is linted and type checked instead: `editor/tsconfig.json` gives it the DOM lib and no node types, `pnpm typecheck` runs both projects, and one eslint block gives `packages/cms/editor/**` browser globals so a stray `process` cannot reach a page.
- **The textarea is the value; CodeMirror is only the view.** The server still renders the plain textarea and it stays in the form. CodeMirror writes into it on every doc change and again on submit, and it is hidden with `hidden` rather than `disabled`, because a disabled control is left out of the form. Nothing above the script depends on it: with JavaScript off, the textarea and a `formaction=/admin/preview formtarget=_blank` submit button are the whole editor.
- **The preview is not a second renderer.** `POST /admin/preview` builds the same `Document` shape the parser produces, runs `renderMarkdown`, hands it to the same `documentContext` and renders the theme's own post or page layout. Proven rather than asserted: in the browser the preview came back through the *demo's override* of `post.njk` (its byline and reading time), not the packaged one.
- **The preview is framed and sandboxed.** It is the site's own HTML, so it goes in an `<iframe srcdoc sandbox>`: the theme's stylesheet cannot reach the admin's, and a script somebody pasted into a post cannot reach the session.
- **Uploads are checked three ways before anything is written.** The extension has to be on the site's allowlist, the media type the browser declared has to be one that extension may have, and the file's first bytes have to be that format's (`src/content/media.ts` holds the table and the signatures). Too big is a 413, wrong type a 415, both JSON.
- **Content-Length is checked in front of the guard.** The guard finds the CSRF token by parsing the form, and parsing a multipart form pulls the whole file into the process, so by the time a request is authenticated a gigabyte has already been read. `refuseOversizedUpload` is registered before the guard and turns an oversized body away by its headers; the exact check on `file.size` is still in the handler. The only thing this tells an anonymous caller is that `/admin/uploads` exists, which is in the package's own source.
- **A name is never overwritten.** The write uses the `wx` flag and walks `photo.png`, `photo-2.png`, `photo-3.png` until one takes, so two uploads racing each other cannot lose one. A submitted filename is reduced to its last path segment first, so it cannot choose a directory.
- **SVG is not in the default allowlist and cannot be added.** An SVG is markup that may carry script and an upload is served from the site's own origin; accepting one would be stored XSS in the site's own pages. `resolveConfig` refuses an allowlist naming anything the media-type table has no entry for, so a typo is heard about at boot rather than silently ignored.
- **The CMS now serves `/uploads/*`.** It never did: `content/uploads` is skipped by the sync and only the documented Eleventy config copied it through. A route over `content/uploads` with the same validators and traversal check the theme's assets get is what makes AC #3's "renders on the public site" true for a served site as well as a built one. Cache lifetime is a day rather than an hour, because an upload's URL names one set of bytes.

## Validation

- `pnpm test` in `packages/cms`: 437 tests, 92 suites, 0 failures (407 before; 30 new — 21 in `src/admin/editor.test.ts`, 4 in `src/web/site.test.ts`, 5 in `src/config.test.ts`). `pnpm typecheck` (both projects) and `pnpm lint` clean. Root `pnpm lint`, `pnpm typecheck`, `pnpm test` (437 + 10), `pnpm test:11ty` (6 + 5) and `pnpm format:check` all clean. `scripts/pack-install-smoke.sh` passed with the bundle in the tarball.
- The new tests were mutation-checked, not trusted. Removing the `/uploads/*` route, skipping the signature check, skipping the size check, writing with `w` instead of `wx`, and rendering the preview through the home layout each failed exactly the tests that name that behaviour and nothing else.

## Manual pass against apps/demo, in Chrome

On port 3000 (`pnpm dev`), signed in as `ada`.

- **AC #1.** On `/admin/posts/new` the page had one `.cm-editor` with a `contenteditable` `.cm-content`, the textarea `hidden` and still the form's `body` field, the Write and Preview tabs with `aria-selected` on Write, an "Add file…" button whose file input has no `name` (so it never rides along on a submit), the no-JS Preview button hidden, and the preview iframe present. Typing `## Hello from CodeMirror` through `insertText` — CodeMirror's own input path — put the same text in `textarea.value`. No console errors on load or through the pass. The screenshot shows Markdown highlighting and line numbers. The no-JS half was checked with curl and no JavaScript at all: the server sends `<textarea id="editor-body">`, `formaction="/admin/preview"`, `formtarget="_blank"` and the `data-*` URLs, and the six preview tests post that same form encoding and get the theme's HTML back.
- **AC #2.** Clicking Preview hid the editing surface, showed the frame, and filled it with markup carrying `post-byline` — the demo's *override* of `post.njk`, not the packaged layout — with `<h1 class="post-title p-name">A browser preview</h1>` and `<h2 id="hello-from-codemirror">`, so the heading anchors of the site's own markdown-it ran. Nothing was written.
- **AC #3.** A real 1×1 PNG through the file input: the status line reported the upload, `![A Manual Pass](/uploads/2026/09/a-manual-pass.png)` appeared at the cursor in CodeMirror and in the textarea, the file landed at `content/uploads/2026/09/a-manual-pass.png`, and `GET /uploads/2026/09/a-manual-pass.png` came back 200 `image/png` with an ETag and `max-age=86400`, byte-for-byte the file on disk (`cmp`) and `PNG image data, 1 x 1` per `file`. Publishing the post wrote the Markdown into the file and the public page rendered `<img src="/uploads/2026/09/a-manual-pass.png">` — which the browser then actually decoded: `img.complete && naturalWidth === 1`.
- **AC #4.** An 11 MiB PNG: 413, "This site accepts uploads up to 10485760 bytes", refused by its headers before the body was read. `payload.exe`: 415, naming `.exe` and listing what the site does accept. `payload.png` carrying `MZ`: 415, "does not look like a .png inside". Through the file input rather than `fetch`, the `.exe` refusal showed in the editor's status line and the body was left alone.

Everything the pass wrote was removed afterwards: `content/posts/2026-09-03-a-browser-preview.md` and `content/uploads/` are gone, `git status` reports `apps/demo` clean, and port 3000 was released. One thing the pass found and fixed: the "Add file…" button is a `type="button"`, so it was getting none of the stylesheet's `button[type='submit']` shape and rendered as bare text; `admin.css` now gives it the same shape, confirmed in a zoomed screenshot.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave the editor the three things doc-5 asks of it, without taking anything away from the form underneath.

The server still renders a plain `<textarea>` and a Preview button that submits the form to `/admin/preview` in a new tab, and that is still the whole editor with JavaScript off. `packages/cms/editor/main.ts`, bundled by esbuild into `admin/static/editor.js`, upgrades it: CodeMirror 6 in Markdown mode becomes the textarea's *view* while the textarea stays in the form as the submitted value, the Preview button becomes a Write/Preview tab, and an "Add file…" button — or a file dropped on the editor — posts to `/admin/uploads` and pastes the Markdown it gets back at the cursor. CodeMirror is a devDependency and nothing is fetched from a CDN, so the admin works offline. The bundle is a build product: gitignored, written by `pnpm build` after `tsc` so the root `prepare`, CI and a publish all produce it, and already covered by `admin/` in `files`. Its source has a `tsconfig.json` of its own with the DOM lib and no node types, and `pnpm typecheck` and eslint both cover it.

`POST /admin/preview` is not a second renderer. It builds the same `Document` shape the parser produces, runs the same `renderMarkdown` and renders the theme's own post or page layout, so a preview is what publishing would put on the site — proven by the demo's *override* of `post.njk` coming back, not the packaged one. It goes in a sandboxed `<iframe srcdoc>` so the theme's CSS cannot reach the admin's and a script pasted into a post cannot reach the session, and it writes nothing.

`POST /admin/uploads` stores one file at `content/uploads/{yyyy}/{mm}/{slug}{ext}` and answers `{ url, markdown }`. Three things have to agree first — the extension is on the site's allowlist, the media type the browser declared is one that extension may have, and the file's first bytes are that format's — and a name is never overwritten: the write uses `wx` and walks to `photo-2.png`. Two new config options, `uploadMaxBytes` (10 MiB, `GEEKITY_UPLOAD_MAX_BYTES`) and `uploadTypes` (`GEEKITY_UPLOAD_TYPES`), decide what is too big and what is allowed; SVG is out of the list and cannot be put in, because it is script-bearing markup served from the site's own origin. Content-Length is checked in front of the admin guard, since the guard parses the form to find the CSRF token and that reads the whole file into memory. And the CMS now serves `/uploads/*` from `content/uploads`, which it never did — only the documented Eleventy config copied it through — so the URL an upload returns resolves whether the site is served or built.

Verified with 30 new node:test tests through `app.request`, every one mutation-checked: dropping the uploads route, skipping the signature check, skipping the size check, writing with `w` instead of `wx` and previewing through the wrong layout each failed exactly the tests that name that behaviour. Then a pass through Chrome against the running demo covering all four criteria: CodeMirror attached and syncing into the textarea with no console errors, a preview rendered through the demo's own layout with the site's heading anchors, a real PNG uploaded through the file input and then *decoded by the browser* on the published public page, and an 11 MiB file, a `.exe` and an `MZ` disguised as a `.png` refused 413/415/415. `pnpm test` (437 pass), typecheck and lint in the package, root `lint`, `typecheck`, `test`, `test:11ty` and `format:check`, and `scripts/pack-install-smoke.sh` with the bundle in the tarball, all pass; everything the manual pass wrote into `apps/demo` was removed.
<!-- SECTION:FINAL_SUMMARY:END -->
