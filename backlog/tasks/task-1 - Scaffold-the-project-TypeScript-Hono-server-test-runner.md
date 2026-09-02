---
id: TASK-1
title: 'Scaffold pnpm workspace: packages/cms and apps/demo'
status: Done
assignee:
  - '@andrewshell'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 19:25'
labels:
  - infra
milestone: m-0
dependencies: []
references:
  - >-
    backlog/decisions/decision-6 -
    Ship-the-CMS-as-an-npm-package-in-a-pnpm-workspace-sites-are-separate-repos.md
type: chore
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the pnpm workspace that every other task builds on. See doc-1 (Architecture Overview) and decisions 2, 6.

Root: pnpm-workspace.yaml, pinned packageManager, tsconfig.base.json, root scripts that fan out (dev, build, lint, typecheck, test). packages/cms: package.json with name @geekity/cms, exports map, bin geekity, files whitelist, tsc build to dist/, a createCms(config) that returns a Hono app answering GET /, and a first node:test test. apps/demo: private package depending on @geekity/cms via workspace:*, a geekity.config.ts and server.ts that boot the CMS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pnpm install at the root installs both workspace packages and links apps/demo to packages/cms
- [x] #2 pnpm --filter demo dev starts the demo site and GET / answers 200
- [x] #3 pnpm build compiles packages/cms to dist/ with type declarations, and pnpm pack produces a tarball containing only dist, themes, templates, README, and LICENSE
- [x] #4 pnpm test runs at least one passing node:test test in packages/cms through tsx
- [x] #5 Config (port, content dir, data dir, base URL) comes from geekity.config.ts with environment variable overrides and documented defaults
- [x] #6 README documents the workspace layout and the dev, build, test, and start commands
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root workspace: pnpm-workspace.yaml (packages/*, apps/*), root package.json with pinned packageManager (pnpm@10.26.1), engines node >=22, fan-out scripts (dev, build, test, typecheck, lint placeholder), tsconfig.base.json with strict + NodeNext ESM, .gitignore covering node_modules, dist, data/, *.tgz.
2. packages/cms: package.json @geekity/cms, type module, exports map (. -> dist/index.js + types), bin geekity -> dist/cli.js, files whitelist [dist, themes, templates, README.md, LICENSE], deps hono + tsx/typescript as dev deps.
3. Test-first with the tdd skill: write src/config.test.ts covering resolveConfig defaults, explicit overrides and env var overrides (GEEKITY_PORT, GEEKITY_CONTENT_DIR, GEEKITY_DATA_DIR, GEEKITY_BASE_URL, precedence env > explicit > default); write src/index.test.ts asserting createCms(config) returns { app, config, serve, close } and app.request('/') answers 200. Run through tsx --test, watch them fail, then implement config.ts, index.ts (createCms + defineConfig) and cli.ts.
4. apps/demo: private package depending on @geekity/cms via workspace:*, geekity.config.ts using defineConfig, server.ts booting createCms(...).serve(), dev script via tsx watch.
5. README documenting workspace layout and dev/build/test/start commands; LICENSE; themes/ and templates/ placeholders so the files whitelist resolves.
6. Verify: pnpm install, pnpm test, pnpm build (check dist has .js and .d.ts), pnpm --filter @geekity/cms pack + tar -tzf inspection, boot demo and curl GET / for 200, then kill it.
7. Finalize: check each AC after its evidence, append implementation notes, set Done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the workspace test-first with node:test through tsx (29 tests, all passing).

Structure: root pnpm-workspace.yaml (packages/*, apps/*) with onlyBuiltDependencies: [esbuild] so tsx's binary unpacks under pnpm 10's blocked-scripts default. Root package.json pins packageManager pnpm@10.26.1, engines node >=22, and fans out dev/build/start/test/typecheck/lint/clean. tsconfig.base.json is strict NodeNext ESM with allowImportingTsExtensions + rewriteRelativeImportExtensions, so source imports name the .ts file (tsx and node type-stripping resolve it) and tsc rewrites to .js on emit.

packages/cms exports createCms, defineConfig, resolveConfig and types; bin geekity -> dist/cli.js; files whitelist [dist, themes, templates, README.md, LICENSE]. src/config.ts is the config seam: defaults (port 3000, <cwd>/content, <cwd>/data, <cwd>/theme, http://localhost:<port>), relative paths resolved against cwd, trailing slash stripped from baseUrl, and precedence env > config file > default via GEEKITY_PORT (then PORT), GEEKITY_CONTENT_DIR, GEEKITY_DATA_DIR, GEEKITY_THEME_DIR, GEEKITY_BASE_URL. Invalid ports and non-URL base URLs throw.

Two ordering constraints surfaced during verification and are fixed in scripts, not documentation: apps/demo consumes @geekity/cms through the workspace link and therefore needs dist/*.d.ts, so root typecheck runs build first and demo has predev/prestart that build the package; and a fresh clone had no dist when pnpm linked the geekity bin, so the root has a prepare script that builds on install.

One real bug was caught by a test rather than by reading code: the CLI's main-module guard compared import.meta.url with pathToFileURL(process.argv[1]), which never matches when a bin runs through node_modules/.bin (argv[1] is a symlinked path, import.meta.url is already resolved), so 'geekity --version' exited 0 printing nothing. Added a regression test that runs src/cli.ts through a symlinked directory, then fixed the guard to realpath the entry first.

Deliberately left for later tasks: themes/default holds only a README describing resolution order (Nunjucks templates are TASK-5), templates/site holds geekity.config.ts, server.ts and gitignore but no package.json (geekity init is TASK-25, and a nested package.json risks confusing workspace tooling); root 'lint' fans out to per-package lint scripts that TASK-23 will add. GET / and 404 currently render a placeholder HTML page; the content index and theme replace them.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Scaffolded the pnpm workspace: root config (pnpm-workspace.yaml, pinned pnpm@10.26.1, strict NodeNext tsconfig.base.json, fan-out scripts, .gitignore, LICENSE, README), packages/cms (@geekity/cms with createCms/defineConfig/resolveConfig, a geekity bin, an exports map and a files whitelist) and apps/demo (private site consuming the package via workspace:*).

Verified with real commands, not inspection: clean 'pnpm install --frozen-lockfile' links apps/demo/node_modules/@geekity/cms -> packages/cms (readlink confirmed); 'pnpm test' runs 29 node:test tests through tsx, all passing, covering config defaults/env overrides/validation and createCms answering GET / 200, 404 and a real listening socket; 'pnpm typecheck' clean across both packages; 'pnpm build' emits .js, .d.ts and maps to dist/; 'pnpm --filter @geekity/cms pack' produces a tarball holding only dist, themes, templates, README.md, LICENSE and package.json (tar -tzf verified); 'pnpm dev' boots the demo and curl GET / returns 200 with HTML, with GEEKITY_PORT/GEEKITY_BASE_URL overrides confirmed end to end through the geekity bin. git check-ignore confirms node_modules, dist, data dirs and *.tgz are ignored.

One bug found and fixed test-first along the way: the CLI's main-module guard failed through the node_modules/.bin symlink, so 'geekity --version' printed nothing; it now realpaths the entry and a regression test runs the CLI through a symlinked path.
<!-- SECTION:FINAL_SUMMARY:END -->
