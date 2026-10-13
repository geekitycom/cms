---
id: TASK-287
title: >-
  geekity plugin add: install plugin packages into a mounted plugins folder on
  Docker
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 12:09'
updated_date: '2026-10-08 17:15'
labels:
  - plugins
  - deploy
milestone: m-30
dependencies:
  - TASK-281
  - TASK-288
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - Dockerfile
  - deploy/compose.yaml
  - packages/cms/src/cli.ts
  - 'https://docs.npmjs.com/cli/v10/configuring-npm/package-json'
priority: medium
type: feature
ordinal: 243800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). The Docker image contains core alone, so a Docker site needs a way to install plugin packages without npm or a package.json in the container. `GEEKITY_PLUGINS_DIR` (/site/plugins in the image, a writable mount) holds one folder per plugin. `geekity plugin add <package>[@version]` fetches the tarball from the npm registry, checks its integrity hash, and unpacks the package bundle and manifest into plugins/<package name>/ (for example plugins/@geekity/plugin-llm/); `geekity plugin remove <package>` deletes it; Reload on the Plugins screen (TASK-288) loads the change. A hand-copied folder with a bundled index.js works the same way. This task also adds the shared build every plugin package uses to emit its self-contained bundle (dependencies inlined), proven on a private fixture plugin package in the workspace.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `docker compose exec cms geekity plugin add <package>` installs a plugin that then appears on the Plugins screen after Reload, with no container restart; proven by building the image and installing the fixture package from a local registry or packed tarball while it runs
- [x] #2 plugin add refuses a tarball whose integrity hash does not match, a package with no bundle, and a bundle that targets a newer host API version, each with a plain message, and leaves the folder as it was
- [x] #3 plugin add is idempotent: running it twice leaves one folder, and adding a newer version replaces the old one atomically so a reload never sees a half-written folder
- [x] #4 A folder whose module fails to import or exports no plugin is unavailable on the Plugins screen with the reason; the site still boots
- [x] #5 The shared bundle build turns a plugin package into one index.js with its dependencies inlined and fails on a native module
- [x] #6 The Dockerfile creates /site/plugins and sets GEEKITY_PLUGINS_DIR; deploy/compose.yaml has a writable plugins volume beside themes
- [x] #7 The README has a plugin section for operators (plugin add, remove, Reload) and for authors (the package shape, requires and services, settings and secrets, the host API version and peer range, the bundle, and a warning that a plugin runs with the site's access to data/)
- [x] #8 A folder install whose manifest peer ranges are not met by core or by an installed plugin package is unavailable on the Plugins screen, naming the package and the range it needs
- [x] #9 A plugin package marks itself a plugin and declares its host API range and required plugin packages in a geekity field of package.json, each required package also a peer dependency; the bundle build writes plugin.json from it and fails when the plugin object requires differs from package.json
- [x] #10 plugin add installs only the package it is given; when that plugin requires plugins that are missing or out of range, it still installs it, and both the command and the Plugins screen name each missing package and the range it needs. Nothing is installed on the operator behalf.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core semver: add the semver dependency to @geekity/cms for range checks.
2. Manifest: the shared bundle build (scripts/build-plugin-bundle.js) writes dist/bundle/plugin.json {name, version, hostApi, peerDependencies} from package.json (geekity field + peer ranges, workspace: ranges resolved as pnpm publish would). It fails when the geekity field is missing, a required package is not a peer dependency, the bundled plugin's name/version/hostApi/requires differ from package.json, or any input is a native module (.node file, binding.gyp, gypfile, bindings/node-gyp-build). Tested on fixture plugin packages built in a temp dir.
3. Folder loading: importPluginFolders never throws; a folder whose index.js fails to import or exports no plugin becomes an InstalledPlugin with a load problem; a folder with plugin.json carries its peer ranges. The registry skips register for a load problem and marks a plugin unavailable when a peer range is not met by core's version or the installed plugin's version.
4. geekity plugin add <pkg>[@version|tag|range] and plugin remove <pkg>: read the registry (npm_config_registry, default registry.npmjs.org), resolve the version, download the tarball, check dist.integrity (sha512) or shasum, unpack package/dist/bundle/ with a small tar reader into a hidden staging folder, refuse no-bundle/no-manifest/name mismatch/newer hostApi, then rename into place (old moved aside first). Prints each required package that is missing or out of range. Plugin commands and help also see folder plugins.
5. Docker: Dockerfile creates /site/plugins and sets GEEKITY_PLUGINS_DIR; compose gets a writable ./plugins volume; docker-smoke checks plugin add against a local fake registry and Reload without a restart.
6. README operator and author sections; doc-1 / backlog docs updated where they describe plugins.
7. Verify: pnpm build/test/typecheck/lint/format:check, pack-install-smoke, docker build + docker-smoke.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. Decisions:
- Manifest shape: dist/bundle/plugin.json = {name, version, hostApi, peerDependencies}, where peerDependencies holds @geekity/cms (workspace: range resolved as pnpm publish writes it, ^0.24.0 today) and each geekity.requires range. The installed plugin folder is exactly the package's dist/bundle/, so a hand copy of that folder is the same install.
- The registry checks a folder install's manifest ranges with semver (new core dependency): core's own version for @geekity/cms, the installed plugin's version otherwise. Only folder installs carry ranges; npm checks the rest.
- importPluginFolders no longer throws: an import failure, a missing index.js, no plugin default export or an unusable plugin.json becomes an InstalledPlugin with a load problem, registered as unavailable under the folder name. A duplicate name still refuses the boot (TASK-288 behaviour kept).
- plugin add: registry from npm_config_registry / NPM_CONFIG_REGISTRY, else registry.npmjs.org; accepts a version, dist-tag or range; checks dist.integrity (strongest of sha512/384/256/1) or shasum; unpacks only dist/bundle/ with a small tar reader (ustar, pax path, GNU long name); refuses a path that climbs out. Writes a dot-prefixed staging folder, then renames the old folder aside and the new one into place. A directory cannot be renamed over a non-empty one, so there is an instant with no folder; a reload in that instant sees the plugin removed, never half-written, and the screen then offers Reload again.
- Plugin commands and --help now include folder plugins, so docker compose exec ... geekity import wordpress-actor works once plugin-wordpress is added (README Docker step 5 updated).
- scripts/npm-publish.sh still publishes core only. No criterion needs a published plugin package: AC#1 is proven with a fixture package from a registry run inside the container. Publishing the plugin packages is release work left as it is.
- Pre-release note: post-summary and tag-suggest require @geekity/plugin-llm ^0.1.0 while every plugin package is 0.0.0, so a folder install of packed 0.0.0 tarballs shows 'It requires @geekity/plugin-llm ^0.1.0, and 0.0.0 is installed.' until the first release. A ^0.24.0 core range also makes a folder plugin unavailable after the next core minor; that is npm's caret rule for 0.x, which the decision adopts.
Validation: pnpm build && pnpm test (cms 4958 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass; scripts/pack-install-smoke.sh passed; GEEKITY_SMOKE_PLATFORM=linux/arm64 scripts/docker-smoke.sh passed twice (plugin add into the mounted plugins volume, Reload, plugin on the screen, StartedAt and RestartCount unchanged, plugin remove), with no containers, images or volumes left. Real pnpm-packed plugin-llm and plugin-post-summary tarballs installed through a local registry with dist/cli.js.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added geekity plugin add/remove (src/plugins/install.ts): fetches a plugin package from the npm registry, checks its integrity hash, unpacks dist/bundle/ into plugins/<package name>/ through a hidden staging folder, refuses a bad hash, a missing bundle and a newer host API without touching the folder, and names each required plugin that is missing or out of range. The shared bundle build now writes plugin.json from the package.json geekity field and fails on an unmarked package, a required package that is not a peer dependency, a plugin object that disagrees with package.json, and native modules. A plugin folder that cannot load, or whose manifest ranges are unmet, is an unavailable row on the Plugins screen and the site still boots. The Dockerfile sets GEEKITY_PLUGINS_DIR=/site/plugins, compose mounts ./plugins writable, the README has operator and author sections. Verified by new unit and end-to-end tests (fake loopback registry), all quality gates, pack-install smoke, and docker-smoke installing a fixture plugin into a running container and loading it with Reload, no restart.
<!-- SECTION:FINAL_SUMMARY:END -->
