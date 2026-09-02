---
id: decision-7
title: release-please with Conventional Commits enforced by husky and commitlint
date: '2026-09-02 13:37'
status: accepted
---
## Context

Publishing a package means versions, changelogs, and tags need to be produced consistently. release-please derives all three from Conventional Commit messages, which only works if every commit that lands on main follows the convention.

## Decision

- release-please runs as a GitHub Action on pushes to `main` in manifest mode, tracking `packages/cms` only. `apps/demo` is private and unversioned.
- Merging the release pull request creates the tag and GitHub release; a follow-up job builds and runs `pnpm publish` for `@geekity/cms` with npm provenance.
- Conventional Commits are enforced locally by a husky `commit-msg` hook running commitlint with the conventional config, and in CI by a pull request title check so squash merges also comply.
- Scopes are optional; when used they are `cms`, `demo`, `docs`, or `ci`.
- `feat` and `fix` drive minor and patch bumps. `feat!` or a `BREAKING CHANGE` footer drives a major. Before 1.0 the `bump-minor-pre-major` option keeps breaking changes on minors.

## Consequences

- Contributors need `pnpm install` to have run so husky hooks exist; the root `prepare` script installs them.
- Commit messages carry meaning, so agents and people must write them deliberately. The CLAUDE.md gets a short commit-message section.
- Publishing needs an `NPM_TOKEN` repository secret or trusted publishing configured on npm.
