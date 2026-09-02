---
id: TASK-24
title: 'GitHub Actions: CI checks, release-please, npm publish with provenance'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-02 13:38'
updated_date: '2026-09-02 22:51'
labels:
  - infra
milestone: m-0
dependencies:
  - TASK-23
references:
  - 'https://github.com/googleapis/release-please-action'
  - >-
    backlog/decisions/decision-7 -
    release-please-with-Conventional-Commits-enforced-by-husky-and-commitlint.md
type: chore
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ci.yml runs lint, typecheck, test, and build on push and pull request with pnpm caching and Node 22, plus a pull request title check for Conventional Commits. release-please.yml runs on push to main in manifest mode tracking packages/cms with bump-minor-pre-major; when a release is created it builds and publishes @geekity/cms with pnpm publish and npm provenance. Document required secrets and branch protection in the README.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A pull request shows lint, typecheck, test, and build as separate required checks
- [x] #2 A pull request titled without a Conventional Commit prefix fails the title check
- [ ] #3 Merging a feat commit to main opens or updates a release pull request with a changelog entry and minor bump
- [ ] #4 Merging the release pull request creates a GitHub release and a git tag, and the publish job runs against npm
- [x] #5 README lists the NPM_TOKEN or trusted publishing setup and the branch protection rules
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add .github/workflows/ci.yml: push + pull_request, concurrency per ref, minimal permissions (contents: read). Shared setup = actions/checkout@v5, pnpm/action-setup@v4 (version from packageManager), actions/setup-node@v6 with node-version 22 and cache: pnpm, pnpm install --frozen-lockfile with HUSKY=0. Separate named jobs so each can be a required check: lint (eslint + prettier --check), typecheck, test, build, test-11ty, coverage (uploads the summary as an artifact), and pr-title (pull_request only, amannn/action-semantic-pull-request@v6 with the commitlint scopes and an empty scope allowed).
2. Add release-please-config.json (manifest mode, packages/cms only, release-type node, bump-minor-pre-major, bump-patch-for-minor-pre-major, include-component-in-tag false so tags read v0.1.0) and .release-please-manifest.json pinned to the current packages/cms version.
3. Add .github/workflows/release-please.yml: push to main, googleapis/release-please-action@v4 with contents: write and pull-requests: write; a publish job gated on releases_created that checks out the tag, installs, builds, runs the tests and pnpm publish --filter @geekity/cms --provenance --access public --no-git-checks with id-token: write (trusted publishing first, NODE_AUTH_TOKEN fallback).
4. Add .github/dependabot.yml for github-actions and npm, weekly, with commit prefixes ci(deps) and chore(deps) so commitlint passes.
5. Document in README.md: a CI and releasing section covering the job names for branch protection, trusted publishing vs NPM_TOKEN, and the feat commit -> release PR -> tag -> npm flow.
6. Verify locally: prettier format + format:check, pnpm lint, YAML parses with js-yaml, actionlint if available, every script the workflows call (lint, format:check, typecheck, test, test:11ty, build, test:coverage), pnpm publish --dry-run file list, release-please JSON parses and the manifest version matches packages/cms/package.json.
7. Leave the task In Progress: acceptance criteria 1-4 can only be proven on GitHub after a push, so record the exact post-push steps in the implementation notes and check only #5.

8. Plan revisions made during implementation, so the plan matches what shipped: actions are pinned to the current majors (actions/checkout@v7, actions/setup-node@v7, actions/upload-artifact@v7, pnpm/action-setup@v6, googleapis/release-please-action@v5, amannn/action-semantic-pull-request@v6), verified as existing tags; the shared setup lives in a local composite action at .github/actions/setup-workspace with checkout kept in each caller; bump-patch-for-minor-pre-major is set to false, not true, because true would make a feat a patch and contradict acceptance criterion #3 and decision-7; Node 24 is a separate job (test-node-24) rather than a matrix so the required check keeps the plain name 'test'; push is limited to main so pull request branches are not built twice; and the publish job installs npm@latest before publishing because pnpm shells out to npm for the upload and trusted publishing needs npm 11.5.1 or newer.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was added

- `.github/workflows/ci.yml` — on `push` to `main` and on `pull_request` (types opened, edited, reopened, synchronize, so a corrected title re-runs `pr-title`). Workflow-level `permissions: contents: read`, concurrency group `ci-${{ github.workflow }}-${{ github.ref }}` cancelling only pull request runs. Eight jobs, each named so it can be a required check: `lint` (`pnpm lint` then `pnpm format:check`), `typecheck`, `test` (Node 22), `test-node-24`, `build`, `test-11ty`, `coverage` (`pnpm test:coverage` teed to `coverage-summary.txt` and uploaded with actions/upload-artifact), and `pr-title` (amannn/action-semantic-pull-request@v6, pull_request only, `pull-requests: read`).
- `.github/actions/setup-workspace/action.yml` — local composite action holding pnpm/action-setup@v6 (no `version`, so it reads the pinned `packageManager`), actions/setup-node@v7 with `cache: pnpm` and a `node-version` input defaulting to 22, and `HUSKY=0 pnpm install --frozen-lockfile`. `actions/checkout@v7` stays in each caller because a local action cannot run before the repository is on disk.
- `.github/workflows/release-please.yml` — googleapis/release-please-action@v5 in manifest mode on pushes to `main` (`contents: write`, `pull-requests: write`, `issues: write`), then a `publish` job gated on `releases_created` that checks out the release tag, builds, runs `pnpm test` and `pnpm test:11ty`, refreshes npm for OIDC, writes `~/.npmrc` only when an `NPM_TOKEN` secret is non-empty, and runs `pnpm publish --filter @geekity/cms --provenance --access public --no-git-checks` with `id-token: write`.
- `release-please-config.json` and `.release-please-manifest.json` — one tracked package, `packages/cms`, release-type node, `include-component-in-tag: false` so tags read `v0.1.0`; manifest starts at `0.0.0`, the current `packages/cms/package.json` version. `apps/demo` is simply not listed.
- `.github/dependabot.yml` — weekly grouped updates for github-actions (`ci(deps)`) and npm (`chore(deps)`), prefixes chosen so Dependabot's own pull requests pass commitlint and `pr-title`.
- `README.md` — new 'Continuous integration' section (job table, the composite action, why `pnpm install` already builds, branch protection rules) and an expanded 'Releasing' section (release flow from feat commit to npm, bump rules, the secrets table).

## Decisions worth flagging

- **`bump-patch-for-minor-pre-major` is set to `false`, not `true`.** With it on, a `feat` on a 0.x version bumps the patch, which directly contradicts acceptance criterion #3 ('a changelog entry and minor bump') and decision-7 ('feat and fix drive minor and patch bumps'). `bump-minor-pre-major: true` is on, so a breaking change stays on a minor before 1.0, which is what decision-7 asks for.
- **`test` is not a matrix job.** A matrix would rename the check to `test (22)`, and criterion #1 wants a check named `test`. Node 24 gets its own job, `test-node-24`.
- **`push` is limited to `main`.** Pull request branches are already covered by the `pull_request` trigger; leaving `push` unfiltered would run every check twice on every branch push.
- **The publish job installs `npm@latest`.** `pnpm publish` shells out to `npm publish` for the upload, and npm trusted publishing needs npm 11.5.1 or newer. The pinned pnpm is 10.26.1, which predates the pnpm fix that lets OIDC override a static `_authToken`, so the token fallback writes `~/.npmrc` only when the secret is actually set — leaving `NPM_TOKEN` unset is how the repository opts into trusted publishing.

## Local verification (all run from the repository root)

| Command | Result |
| --- | --- |
| `actionlint` (1.7.12, installed via Homebrew) | exit 0, no findings across all four YAML files. Confirmed it really resolves the local composite action by temporarily renaming an input, which it flagged, then restoring. |
| js-yaml parse of the four YAML files | all parse; ci jobs = lint, typecheck, test, test-node-24, build, test-11ty, coverage, pr-title; release jobs = release-please, publish |
| `pnpm lint` | exit 0 |
| `pnpm format:check` | exit 0 ('All matched files use Prettier code style') after `pnpm format` |
| `pnpm typecheck` | exit 0 (builds first, then tsc --noEmit in both packages) |
| `pnpm test` | exit 0, 245 tests, 0 failures |
| `pnpm test:11ty` | exit 0, 6 tests, 0 failures |
| `pnpm build` | exit 0 |
| `set -o pipefail; pnpm test:coverage \| tee coverage-summary.txt` (the coverage job's exact pipeline) | exit 0, all files 93.91% lines / 90.89% branches / 96.20% functions |
| `HUSKY=0 pnpm install --frozen-lockfile` | exit 0, 'Lockfile is up to date', prepare printed 'HUSKY=0 skip install' and still ran the build; lockfile and .husky hook files byte-identical afterwards |
| `pnpm publish --filter @geekity/cms --dry-run --no-git-checks` | exit 0, 105 files, 87.4 kB. Top-level entries are exactly dist/, themes/, templates/, package.json, README.md, LICENSE — no src, no tests, no fixtures |
| release-please JSON | both files parse; `release-please-config.json` tracks only `packages/cms`, that path exists, `apps/demo` is absent, and `.release-please-manifest.json` value `0.0.0` equals `packages/cms/package.json` version |
| `pr-title` inputs, replayed in node | 11 types matching @commitlint/config-conventional; scopes parse to exactly [cms, demo, deps, ci, docs, release], identical to `commitlint.config.js`; `requireScope` false so an empty scope passes; `subjectPattern` accepts 'serve atom and json feeds' and rejects 'Serve atom feeds' and 'serve atom feeds.' |

Nothing was committed or pushed.

## What a maintainer must do after pushing, to confirm criteria 1 to 4

These four can only be proven on GitHub, so they are left unchecked.

**Before anything else:** push this branch, create the `geekitycom/cms` remote if it does not exist, and enable Settings -> Actions -> General -> 'Allow GitHub Actions to create and approve pull requests'.

**#1 — lint, typecheck, test and build appear as separate required checks.** Open any pull request against `main`. The Checks tab should list `lint`, `typecheck`, `test`, `test-node-24`, `build`, `test-11ty`, `coverage` and `pr-title` as eight separate check runs. Then add them under Settings -> Rules -> Rulesets -> require status checks, spelled exactly as above, and confirm the pull request now says the checks are required.

**#2 — a non-Conventional title fails the title check.** On that pull request, rename the title to something like `updated the readme` (no type prefix). The `edited` trigger re-runs CI; `pr-title` must go red with a message naming the allowed types. Also try `feat(nope): add a thing` — it must fail on the scope. Rename it back to something valid, for example `ci: add GitHub Actions workflows`, and confirm `pr-title` goes green.

**#3 — a feat commit opens a release pull request with a minor bump.** Squash-merge a pull request whose title starts with `feat` into `main`. The `release-please` workflow runs on the push and should open a pull request titled 'chore(main): release 0.1.0' that bumps `packages/cms/package.json` to 0.1.0, creates `packages/cms/CHANGELOG.md` with the feature under 'Features', and updates `.release-please-manifest.json`. If it opens no pull request, check the run log for a permissions error and confirm the Actions setting above is on.

**#4 — merging the release pull request tags, releases and publishes.** Before merging, set up publishing: either configure npm trusted publishing for `@geekity/cms` (npmjs.com -> package -> Settings -> Trusted publishing -> GitHub Actions, org `geekitycom`, repository `cms`, workflow `release-please.yml`, environment empty), which needs the package to exist so the very first publish has to use a token; or add an `NPM_TOKEN` repository secret holding an npm automation token. The `@geekity` scope must be owned first (decision-6). Then merge the release pull request. release-please runs again on the push, creates the tag `v0.1.0` and the GitHub release; the `publish` job should then run (it is skipped if `releases_created` is false) and end with `+ @geekity/cms@0.1.0`. Confirm on npmjs.com that version 0.1.0 exists and carries a provenance badge; if the badge is missing, `id-token: write` or the OIDC setup is the thing to check.

Verified on PR #1 (run 33692126519): nine separate check runs (lint, typecheck, test, test-node-24, build, test-11ty, coverage, pr-title, pack-install) all green; renaming the PR to 'updated the readme' turned pr-title red and restoring the title turned it green. AC 3 and 4 remain until the PR merges and a release PR is cut.
<!-- SECTION:NOTES:END -->
