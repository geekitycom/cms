---
id: decision-6
title: Ship the CMS as an npm package in a pnpm workspace; sites are separate repos
date: '2026-09-02 13:37'
status: accepted
---
## Context

A site should be able to adopt the CMS, keep its own content and theme under its own version control, and pick up CMS improvements without merging from an upstream git repository. WordPress achieves this with an in-app updater; for a Node project the equivalent is an npm dependency.

## Decision

This repository is a pnpm workspace containing:

- `packages/cms`, published to npm as `@geekity/cms`. It exports `createCms(config)`, `defineConfig`, types, and a `geekity` CLI (`serve`, `init`, `sync`, `user add`). The default theme and database migrations ship inside the package.
- `apps/demo`, a private site that depends on the package through the workspace protocol and doubles as the integration test bed and the reference for `geekity init` output.

A site created by `geekity init` is a standalone repository with one dependency on `@geekity/cms`, its own `content/`, an optional `theme/` for template overrides, a config file, and an entry file. Upgrading is `pnpm up @geekity/cms`.

Template resolution looks in the site `theme/` first and falls back to the package default theme file by file, so sites override only what they change and still receive updates to everything else.

## Consequences

- The public API (config schema, `createCms`, template context, JSON representation, content format) is a semver contract. Breaking changes are majors and get a migration note in the changelog.
- Migrations must be forward-only and run automatically on boot so a version bump is the whole upgrade.
- The default theme cannot assume anything about the site's build; it ships plain CSS and no bundler.
- The package must be tested as an installed dependency, not only from source, so the demo app installs the built `dist/` through the workspace link and CI also runs `pnpm pack` and installs the tarball in a scratch site.
- npm scope `@geekity` must be owned by the project before first publish; if it is not available the package name changes but nothing else does.
