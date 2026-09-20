---
id: TASK-117
title: 'pnpm npm:publish: one command that publishes the tagged version'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-20 19:15'
updated_date: '2026-09-20 19:23'
labels:
  - ci
  - infra
dependencies: []
references:
  - scripts/docker-build-push.sh
  - packages/cms/src/docker-build-push.test.ts
  - package.json
  - README.md
type: feature
ordinal: 141800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Publishing to npm is six commands typed by hand, and the README's own recipe starts with `git checkout v0.1.0` — a detached HEAD, which is how a run of this session ended up committing five commits onto no branch without noticing. Pushing the Docker image is one command with its gates and its refusals inside it. Publishing the package should be the same.

Add `scripts/npm-publish.sh`, `pnpm npm:publish` and `pnpm npm:dry-run`, modelled on `scripts/docker-build-push.sh` — same shape, same order, same kind of refusals, because the two are the halves of one release and somebody who has run one should recognise the other.

**Publish the tagged commit, without checking it out.** release-please tags the release commit and merges it to main, so `main` right after that merge already *is* `v<version>`. The script should read the version from `packages/cms/package.json`, then refuse unless `HEAD` carries the matching tag — which is a better check than the README's checkout, because it proves the working commit is the released one rather than assuming it. No detached HEAD, nothing to undo afterwards. `--no-git-checks` then stops being needed.

**Refuse before it does anything slow**, the way the Docker script does: not the repository root, a dirty working tree, HEAD not at the version's tag, not logged in to npm, or a version already on the registry — that last one matters because npm will not take the same version twice and the error it gives is not obvious.

**Then the quality gates**, the same four the Docker script runs plus `test:11ty`, since the README's recipe runs it. A failing gate stops before anything is published.

**`--dry-run` prints what it would publish** — the package, the version, the tag it found, the gates it would run — and publishes nothing, exactly as `pnpm docker:dry-run` does.

The README's Publishing to npm section becomes the one command and what it checks, rather than the six-step recipe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pnpm npm:dry-run prints the package, the version and the tag it would publish from, runs no gate and publishes nothing, proven by a test
- [x] #2 The version is read from packages/cms/package.json and the tag it requires is that version's, proven by a test
- [x] #3 The script refuses, before any gate runs, when it is not at the repository root, the tree is dirty, HEAD is not at the version's tag, npm has nobody logged in, or that version is already published — each with a message saying which, proven by a test for each
- [x] #4 A failing quality gate stops the script before anything is published, proven by a test
- [ ] #5 A real run publishes the package and nothing else, confirmed by the maintainer on the next release
- [x] #6 The README's Publishing to npm section is the one command and what it checks
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write packages/cms/src/npm-publish.test.ts on the docker-build-push.test.ts harness: a throwaway fixture repo with the script copied in, stand-in git/npm/pnpm on PATH that log every call to $STUB_LOG and fail or answer as the test says (dirty tree, tag at HEAD, npm whoami, npm view).
2. Red/green, one slice at a time: --dry-run prints package, version and tag and calls nothing; version comes from packages/cms/package.json not the workspace root; refusals in order (not the repository root, dirty tree, HEAD not at v<version>, nobody logged in to npm, version already on the registry); a failing gate (lint, format:check, typecheck, test, test:11ty) stops before the publish; the real run publishes with pnpm publish --filter @geekity/cms --access public and no --no-git-checks.
3. scripts/npm-publish.sh, shaped like scripts/docker-build-push.sh: same header comment, log/fail/usage helpers, argument loop, root check, read_version, dry-run block, then checks, gates, publish. bash 3.2 only, shellcheck clean.
4. package.json: npm:publish and npm:dry-run scripts next to the docker ones.
5. README: the Publishing to npm section becomes the one command and what it checks, matching the Docker section's shape.
6. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint, shellcheck, prettier on the changed files, and a real pnpm npm:dry-run. Nothing is ever published and nothing logs in to npm; AC #5 stays for the maintainer's next real release.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
scripts/npm-publish.sh is shaped like scripts/docker-build-push.sh: the same header comment, log/fail/usage helpers, argument loop, root check, read of packages/cms/package.json, dry-run block, then checks, gates and the publish. It runs on bash 3.2 (the tests spawn /bin/bash, which is 3.2.57 here) and is shellcheck clean.

Order: parse arguments (unknown option refused) -> repository root -> read name and version -> --dry-run prints and returns -> clean working tree -> HEAD carries v<version> -> npm whoami -> npm view <pkg>@<version> is empty -> gates lint, format:check, typecheck, test, test:11ty -> pnpm publish --filter @geekity/cms --access public.

The tag check replaces the README's git checkout v<version>: git tag --points-at HEAD must list v<version>, so the commit being published is proven to be the released one and nothing goes detached. Because HEAD is then the tagged commit on the publish branch with a clean tree, pnpm's own git checks pass and --no-git-checks is gone.

The script never runs npm login; when npm whoami fails it refuses and tells the maintainer to run npm login. A test asserts no 'npm login' call is ever made. Nothing was published and nothing logged in during this work.

packages/cms/src/npm-publish.test.ts drives a copy of the script in a throwaway fixture repo with stand-in git, npm and pnpm first on PATH that log every call and answer as the test says (dirty tree, tags at HEAD, whoami, view). 14 tests, all green. Separately, the script was exercised against real git in a scratch repo: it refused an untagged HEAD, refused a dirty tree, and on a tagged clean HEAD ran the gates and called pnpm publish (both npm and pnpm stubbed).

Validation: pnpm build, pnpm test (2136 + 30 pass, 0 fail), pnpm test:11ty (16 + 5 pass), pnpm typecheck, pnpm lint all pass; shellcheck scripts/npm-publish.sh is clean; prettier --check passes on README.md, package.json and the new test.

pnpm npm:dry-run, run for real:
  Dry run: nothing will be published
  Package:  @geekity/cms
  Version:  0.5.0 (from packages/cms/package.json)
  Tag:      v0.5.0 (HEAD must carry it)
  Would run the quality gates: lint format:check typecheck test test:11ty
  Would publish with:
    pnpm publish --filter @geekity/cms --access public

AC #5 is left unchecked on purpose: it can only be proven by a real publish, which this work deliberately never does. 0.5.0 is already on the registry (npm view @geekity/cms@0.5.0 returns 0.5.0), so the next real run will be on the version after release-please's next bump.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added scripts/npm-publish.sh with pnpm npm:publish and pnpm npm:dry-run, modelled on scripts/docker-build-push.sh. It reads the name and version from packages/cms/package.json and refuses, before any gate, when it is not at the repository root, the tree is dirty, HEAD does not carry v<version>, nobody is logged in to npm, or that version is already on the registry; then it runs lint, format:check, typecheck, test and test:11ty and publishes with pnpm publish --filter @geekity/cms --access public, with no --no-git-checks and no tag checkout. The README's Publishing to npm section is now that one command and what it checks. Verified by packages/cms/src/npm-publish.test.ts (14 tests driving a copy of the script in a fixture repo with stand-in git, npm and pnpm), a real pnpm npm:dry-run, a real-git scratch-repo run of the refusals, shellcheck, and pnpm build/test/test:11ty/typecheck/lint. AC #5 stays unchecked: only a real release can prove it, and nothing here was published or logged in.
<!-- SECTION:FINAL_SUMMARY:END -->
