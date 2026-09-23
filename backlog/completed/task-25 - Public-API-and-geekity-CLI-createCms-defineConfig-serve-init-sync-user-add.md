---
id: TASK-25
title: >-
  Public API and geekity CLI: createCms, defineConfig, serve, init, sync, user
  add
status: Done
assignee:
  - '@andrewshell'
created_date: '2026-09-02 13:38'
updated_date: '2026-09-03 01:29'
labels:
  - infra
  - web
milestone: m-0
dependencies:
  - TASK-5
  - TASK-9
references:
  - backlog/docs/doc-1 - Architecture-Overview.md
type: feature
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Finalise the package surface described in doc-1 and decision-6. createCms(config) returns { app, serve, sync, close }; defineConfig gives typed config files; the geekity bin offers serve (boots from geekity.config.ts), init (copies packages/cms/templates/site into a new directory and writes package.json depending on the current published version), sync (one-shot index rebuild), and user add (create an admin without the setup screen). Hooks onDocumentChange and onPublish are exposed and documented. Write the package README as the site-author guide.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 geekity init my-site produces a directory that, after pnpm install and pnpm dev, serves a sample post at its permalink
- [x] #2 A site with only server.ts, geekity.config.ts, and content/ runs without a theme directory
- [x] #3 A site entry file can add its own Hono route alongside the CMS routes
- [x] #4 Package README documents config options, CLI commands, theme overrides, hooks, and the upgrade command
- [x] #5 Type declarations are published and a site written in TypeScript typechecks against them
- [x] #6 geekity sync rebuilds the index and exits 0
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Hooks: add onDocumentChange and onPublish to GeekityConfig/ResolvedConfig, wire them onto the existing content events inside createCms, and expose Cms.onDocumentChange()/onPublish() as methods that return an unsubscribe. An async hook that rejects is logged, not thrown. Document the origin caveat: the boot scan reports a cold index as created/published, so a subscriber that must not re-fire on a rebuild checks origin === 'watch'.
2. Public API tidy: keep { app, config, store, events, sync, serve, close } on the Cms interface and add the two hook methods.
3. CLI: extend parseArgs to serve | init | sync | user | help | version, with a positional argument for init's directory. Keep --config.
4. Config loading from a packed install: try a plain import() first (Node >= 22.18 and 24 strip types natively, and tsx --import already covers the source tree); on ERR_UNKNOWN_FILE_EXTENSION for a .ts config, resolve tsx/esm/api from the SITE's own dependencies and register it, then retry; if tsx is not installed, fail with a message naming both fixes (install tsx, or use geekity.config.js/.mjs). geekity.config.js and .mjs stay in the candidate list as the no-tsx fallback.
5. geekity init <dir>: refuse a directory that exists and is not empty; copy packages/cms/templates/site recursively (gitignore -> .gitignore); generate package.json in code (templates/ cannot hold a nested package.json) with name from the directory, type module, scripts dev/start/sync, @geekity/cms pinned to ^<version of the running CLI>, and tsx/typescript/@types/node as devDependencies. Template gains content/ with a sample published post, a page, _data/site.json and the posts.json/pages.json directory data files, plus tsconfig.json so the generated site typechecks (AC #6).
6. geekity sync: load config, create a CMS with watch forced off, run one scan, print the SyncResult counts, close, exit 0 — or exit 1 naming the count when any file failed to parse.
7. geekity user add: registered but blocked on TASK-9 (no users table, no password hashing). It prints that admin auth has not shipped and exits 1.
8. Tests (test-first, node:test): CLI arg parsing; init into a temp dir through tsx as cli.test.ts already spawns it; init refusing a non-empty directory; sync exit codes; a site route that collides with a document permalink beating the not-found document resolver; a site with no theme directory serving / and a document; the hooks firing with the right origin.
9. Write packages/cms/README.md as the site-author guide: install, init, config table with env vars and defaults, CLI commands, theme overrides, hooks, negotiation and feeds pointers, Eleventy pointer, pnpm up @geekity/cms. Root README stays the contributor guide.
10. Verify for real: pnpm lint, format:check, typecheck, test, test:11ty, build; then pnpm --filter @geekity/cms pack, geekity init a scratch site outside the repo from dist/cli.js, point it at the tarball, pnpm install, boot it, curl / and the sample permalink and a custom route, run geekity sync, run tsc --noEmit in the site, and check the demo still runs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

**Public API** (`src/index.ts`). `createCms(config)` returns `{ app, config, store, events, onDocumentChange, onPublish, sync, serve, close }`. The two hook methods are new; everything else was already there and the `Cms` interface is now documented member by member.

**Hooks** (`src/config.ts`, `src/index.ts`). `onDocumentChange` and `onPublish` are both config options and methods; the methods return the unsubscribe. They are layered on the existing content events (`change` and `published`). `DocumentChangeHook` returns `unknown` on purpose: `=> void` makes typescript-eslint's no-misused-promises reject the async hook the README recommends, and `=> void | Promise<void>` makes the compiler reject a one-expression hook like `(change) => queue.push(change)`. A hook that throws is caught by the emitter; a hook that rejects is caught in `subscribe` so it cannot become an unhandled rejection.

**The origin caveat** is documented in the type, on both methods, and in its own README subsection: the boot scan reports a cold index as `created`/`published` with `origin === 'scan'`, so a hook that must not re-fire on a rebuilt index checks `origin === 'watch'`. Deleting `data/geekity.db` is supported, so this is the normal path, not a corner case.

**CLI** (`src/cli.ts`, new `src/init.ts`). `parseArgs` now returns `{ command, configPath, args }` over `serve | init | sync | user | help | version`; the first bare word is the command and every bare word after it is that command's argument. `main` returns an exit code rather than calling `process.exit`, so `serve` can resolve 0 while still listening.

**Loading a TypeScript config from a packed install** — the decision this task had to make. A ladder rather than a single mechanism: import the config directly first (all it takes on Node 22.18+ and 24, which strip types unflagged, and inside this repo where the CLI runs under tsx); on `ERR_UNKNOWN_FILE_EXTENSION` or `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` for a `.ts` file, register the tsx installed in the *site*; and `geekity.config.js`/`.mjs` stay in the lookup list as the no-tsx fallback, named in the error message. `findSiteTsx` walks up from the cwd for `node_modules/tsx` rather than asking Node's resolver, because a tsx already loaded into the process patches CJS resolution and would answer with its own copy — which is exactly what happens when the suite runs under tsx.

**`geekity init <dir>`** copies `templates/site` (with `gitignore` renamed to `.gitignore`; npm rewrites a real `.gitignore` inside a package to `.npmignore`), then generates `package.json` in code, because a nested manifest under `templates/` would be picked up as a package by every tool that walks for one. The template gained `content/` (a published post, a page, `_data/site.json`, and the `posts.json`/`pages.json` directory data files for Eleventy) and a `tsconfig.json` so the site type checks. `templates/site/content/` was added to `.prettierignore` for the same reason the fixtures are there. `server.ts` now shows how to add a route. Non-empty directories are refused.

The generated manifest pins `@geekity/cms` to `^<version of the running CLI>`, has scripts dev/start/sync, and takes its tsx/typescript/@types/node ranges from this package's own devDependencies so a new site starts on the versions the CMS was tested against. It also carries a `pnpm` block settling `onlyBuiltDependencies: ['esbuild']` and the nunjucks>chokidar peer rule — without those, `pnpm install` in a new site prints a blocked-build-script warning and an unmet-peer warning. This matters for TASK-26.

**`geekity sync`** forces `watch: false`, prints the SyncResult counts, and exits 1 naming the count when any file failed to parse.

**`geekity user add`** is registered and prints that admin authentication has not shipped, then exits 1 — see the blocker below.

**README.** `packages/cms/README.md` is now the site-author guide (init, existing project, upgrading, CLI table, TypeScript config loading, entry file and the Cms table, config table, hooks, and the existing negotiation/feeds/theme/Eleventy material). The root README gained a pointer to it and stays the contributor guide.

## Blocked on TASK-9

Acceptance criterion #4 is half done. `geekity sync` is implemented and verified; `geekity user add` cannot be, because TASK-9 (admin auth: users table, password hashing, login) is in M2 and is not started. There is no users table to write to and nothing an account could log in to, so building password hashing here would be guessing at a schema TASK-9 owns. The command is registered so it explains itself rather than reading as a typo, and exits 1. When TASK-9 lands, replace `userCommand` in `src/cli.ts` and check the second half of #4. The task stays In Progress for that reason.

## Verification

Workspace gates, all green on the final source: `pnpm lint` (Done), `pnpm format:check` (all files formatted), `pnpm typecheck` (both projects Done), `pnpm test` (279 tests, 279 pass, 0 fail — up from 277 before this task's 27 new ones), `pnpm test:11ty` (6 pass), `pnpm build`.

Packed-artifact run, the evidence for #1 and #6. `pnpm build` then `pnpm --filter @geekity/cms pack --pack-destination <scratch>`; the tarball carries `templates/site/**` including the sample content. Outside the repo: `node packages/cms/dist/cli.js init my-site` exited 0; the dependency was repointed at `file:../geekity-cms-0.0.0.tgz`; `pnpm install` exited 0 with no warnings at all (that is what the generated `pnpm` block buys). `pnpm dev` booted on GEEKITY_PORT=3210 and curl gave: `/` 200, `/2026/01/hello-world/` 200 (title 'Hello, world · A Geekity site'), `/about/` 200, `/hello/` 200 returning 'a route of my own' from the template's own route, `/tags/introductions/` 200, `/feed.xml` 200, `/feed.json` 200, `/theme/style.css` 200, `/2026/01/hello-world/index.json` 200, `/nowhere/` 404, and `Accept: text/markdown` returned the file's front matter.

#6 specifically: `npx tsc --noEmit` in the generated site, on TypeScript 7.0.2, exited 0. To prove the declarations were being read rather than skipped, a probe file importing `createCms`, `defineConfig`, `Cms` and `DocumentChange` and calling `cms.onDocumentChange` was added with one deliberate error (`port: 'three thousand'`); tsc reported exactly that one error and nothing else.

#4 (the sync half): `pnpm sync` in the generated site — the bin, plain `node dist/cli.js`, no tsx preloaded — loaded `geekity.config.ts` and printed 'Scanned 2: 2 created, 0 updated, 0 removed, 0 unchanged, 0 failed', exit 0. The parse-failure path is covered by a spawned test asserting exit 1 and the failing filename on stderr.

All three rungs of the config ladder were exercised from that packed install: native type stripping (exit 0); `NODE_OPTIONS=--no-experimental-strip-types` forcing the tsx fallback (exit 0); the same with `node_modules/tsx` moved away, which printed the error naming both fixes and exited 1; and then `geekity.config.js` in its place, exit 0.

#2: the generated site has no `theme/` directory (`ls -d theme` -> no such file). `npx geekity serve` with `server.ts` untouched but unused — config and content only — served `/` 200, the post 200, `/about/` 200 and `/theme/style.css` 200 from the packaged theme, with `/hello/` correctly 404 because that route lives only in the entry file.

#3: proved twice. In the packed site, `/hello/` returned the entry file's route while the post's permalink is also `/hello/` in the unit test. In `src/index.test.ts`, a document indexed at `/hello/` and a route registered at `/hello/` after `createCms`: the route wins, and every other document still resolves.

`pnpm dlx @geekity/cms init my-site` was checked against the tarball in both the bare and the `--package=` form; both work, so the README's headline command is right. `pnpm geekity --version` and `pnpm exec geekity --version` both print the version inside an installed site.

Regression check: `pnpm --filter demo dev` still boots and serves `/`, `/about/`, `/2026/08/markdown-on-disk/` and `/feed.xml` at 200.

Cleanup: every scratch server killed, ports 3000, 3210 and 3211 all empty, the scratch site and the tarball deleted, and no `*.tgz` left anywhere in the repository.

2026-09-03: geekity user add split out to TASK-27 (M2, depends on TASK-9) so this task can close; the user command stub in src/cli.ts stays until then. geekity sync was verified on the packed install during implementation.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @andrewshell
created: 2026-09-02 22:10
---
Left In Progress deliberately. Five of six acceptance criteria are checked; #4 stays open because its second half (geekity user add creates a user that can log in) depends on TASK-9, which has not started. Everything else in the task is done and verified against a packed tarball. See the implementation notes for the handover point.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Public API (createCms with store, events, onDocumentChange, onPublish, sync, serve, close; defineConfig), geekity CLI with serve, init, sync, help, version, TypeScript config loading from a packed install, site template with sample content, and the package README as the site-author guide. Verified against the packed tarball on a scratch site. geekity user add moved to TASK-27.
<!-- SECTION:FINAL_SUMMARY:END -->
