---
id: TASK-21
title: Federation smoke test with @fedify/cli
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 22:33'
labels:
  - federation
milestone: m-2
dependencies:
  - TASK-19
references:
  - 'https://fedify.dev/cli'
type: chore
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Script npm run fed:smoke that starts the server on a temporary port with a fixture content dir and settings, runs fedify lookup on the actor and on a post object, and uses fedify inbox to receive a Create delivery after publishing a fixture post. Document how to test against a real Mastodon instance using a tunnel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm run fed:smoke passes locally and in CI
- [x] #2 README section describes testing federation with fedify tunnel and a Mastodon account
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add @fedify/cli as an exact-pinned devDependency of packages/cms, so the fedify binary is on PATH for a package script and CI takes it from the lockfile.
2. Fixture under packages/cms/test/fixtures/federation/: content/ (site.json plus one already-published post) and publish/ (the post the run publishes while the watcher is running). Copied to a temp dir per run so the repo is never dirtied.
3. packages/cms/scripts/fed-smoke.ts, run with tsx: pick free ports, seed settings, boot createCms with watch: true and federation { queue: null, allowPrivateAddress: true }.
4. fedify lookup --raw --allow-private-address on the actor URL and on a post object URL; assert id, type, handle, attributedTo, name.
5. fedify inbox --no-tunnel as a real receiving inbox; register it as a follower and assert it displays Create(Article).
6. A second peer built in the script out of Fedify + @hono/node-server on a third port: it sends a real signed Follow, the CMS must verify it and answer Accept, and the Create must reach its shared inbox with a sent delivery row.
7. Wire pnpm fed:smoke at the root (delegating to the package script) and add a fed-smoke job to .github/workflows/ci.yml.
8. README section in packages/cms/README.md on testing federation against a real Mastodon account through fedify tunnel.
9. Root gates: build, test, typecheck, lint, format:check, plus the new script.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What landed

`pnpm fed:smoke` at the workspace root delegates to `@geekity/cms`'s own `fed:smoke`, which is `tsx scripts/fed-smoke.ts`. The script boots a real CMS on a free port over a temporary copy of the new `packages/cms/test/fixtures/federation/` fixture and then, in order:

1. `fedify lookup --raw --allow-private-address` on the actor URL — asserts `id`, `type: Person`, `preferredUsername: blog`, and the presence of `inbox`, `outbox`, `followers` and `publicKey`.
2. The same on the fixture post's object URL (the slug is read back out of `cms.store.listPosts()` rather than hard-coded) — asserts `id`, `type: Article`, `attributedTo` and `name`.
3. `fedify inbox --no-tunnel`, registered as a follower off the URIs it prints.
4. A second peer built in the script out of Fedify itself plus `@hono/node-server` on a third port: it sends a real signed `Follow`, and the run waits for both halves of the handshake — the follower row the CMS writes after verifying the signature, and the `Accept` arriving back at the peer.
5. A new post file copied into the watched content directory. The run waits for the outbound `Create`, then `cms.delivery.settled()`, then asserts the peer's delivery row is `sent` and went to its **shared** inbox, that the peer accepted a `Create` of an `Article` carrying this post's object id, and that `fedify inbox` displayed `Create(Article)`.

Nothing is written inside the repository: the fixture is copied to `mkdtemp` directories, and both temporary directories, the CMS, the peer's server and the `fedify` child process go on the way out through a reversed cleanup stack, whether the run passed or not. Failures print the ephemeral inbox's whole screen as a diagnostic. Every wait has a 30s ceiling and the process exits non-zero.

## The fallback, and why

`fedify inbox --follow <url>` cannot be used against a loopback actor, and this is not a flag I missed. `@fedify/cli` 2.3.6 builds the inbox's document loader in `dist/docloader.js` with `allowPrivateAddress: false`, and the `inbox` schema in `dist/config.js` has no key for it (`actorName`, `actorSummary`, `authorizedFetch`, `noTunnel`, `follow`, `acceptFollow` — that is the whole list), so the command answers `Not an actor: http://localhost:PORT/ap/actor` before any request is signed. The same restriction makes its inbox listener throw when it dereferences a loopback *sender*, so it answers 500 after it has decoded and displayed the activity.

So the run does what TASK-21 anticipated as the fallback, but keeps both ends:

- The `Follow` -> `Accept` -> `Create` handshake is proved against the in-script peer, over sockets, with real HTTP signatures verified in both directions. That leg's delivery row is asserted to be `sent`.
- `fedify inbox` is still a real second inbox receiving a real POST; the run asserts on the `Activity type: | Create(Article)` line it prints, which is the evidence that the CLI parsed our JSON-LD into a `Create` of an `Article`. Its delivery row's status is deliberately not asserted, and the script prints a `--` note before publishing so the expected `Could not deliver ... 500` line is not read as a failure.

Two other findings from the same reading: `fedify lookup` is fine on loopback (`-p` covers the URLs it follows; a URL on the command line is always allowed), which is why the two lookups are the CLI's real load-bearing role here; and the CMS delivers to a follower's shared inbox when it has one, which is why the peer's delivery is matched on `actorId` rather than on `inboxId`.

## Choices worth recording

- `@fedify/cli` is a devDependency of `packages/cms` pinned to exact `2.3.6`, not a caret range. The script reads the CLI's human-readable table output, which no version range promises to keep stable; and being a package devDependency puts `fedify` on PATH for a package script without a `pnpm dlx` network fetch in CI.
- The port is chosen before `createCms` rather than binding `port: 0`, because `baseUrl` is what every ActivityStreams id is minted from and has to be known first.
- `packages/cms/tsconfig.json` gained `scripts/**/*.ts` in `include`, so the script is type checked by `pnpm typecheck` and eslint's project service can type it. `tsconfig.build.json` still includes only `src`, so nothing new is emitted to `dist` or shipped by `files`.
- CI: a `fed-smoke` job in `.github/workflows/ci.yml`, after `test-11ty`, following the repo's one-job-per-gate convention. It needs no network — everything is loopback and `@fedify/cli` comes out of the lockfile.

## Validation

`pnpm fed:smoke` from the repo root, exit 0, about 3 seconds wall clock, run four times in a row with no flake and no orphaned processes (`pgrep -fl fedify` empty afterwards). Passing output:

```
==> booting the site on http://localhost:61208
ok  the site is listening on http://localhost:61208
==> fedify lookup http://localhost:61208/ap/actor
ok  the actor is @blog@localhost:61208 (Federation Smoke)
==> fedify lookup http://localhost:61208/ap/posts/already-published
ok  the post object is an Article titled "Already Published"
==> starting fedify inbox
ok  the ephemeral inbox is http://localhost:61211/i, delivering to http://localhost:61211/i/inbox
==> following the actor from a peer built out of Fedify
ok  accepted a Follow from http://localhost:61212/users/peer and the peer got the Accept
==> publishing 2026-03-05-hot-off-the-press.md into the watched content directory
--  expect one "Could not deliver ... to http://localhost:61211/i/inbox": the ephemeral inbox
    answers 500 because it may not dereference a sender on loopback.
ok  built http://localhost:61208/ap/posts/hot-off-the-press#create
Could not deliver ... (500): Internal server error.
ok  delivered Create to 2 inboxes
ok  the peer accepted Create(Article) of http://localhost:61208/ap/posts/hot-off-the-press
ok  the ephemeral inbox displayed Create(Article) at http://localhost:61211/i/inbox
==> federation smoke passed
```

Repo root gates, all clean: `pnpm build`, `pnpm test` (577 package + 10 demo, 0 fail), `pnpm test:11ty` (6 + 5), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.

The CI workflow was checked by loading it with js-yaml: it parses, and `jobs` now reads lint, typecheck, test, test-node-26, build, test-11ty, fed-smoke, pack-install, coverage, pr-title, with `fed-smoke` running checkout, the setup-workspace action and `pnpm fed:smoke`.

## On acceptance criterion 1

Half of it is proved and half of it cannot be, from here. `pnpm fed:smoke` passes locally — run four times, exit 0 each time, output pasted above. The CI half is a `fed-smoke` job added to `.github/workflows/ci.yml`; the workflow parses (checked with js-yaml) and the job runs the same `pnpm fed:smoke` behind the same `setup-workspace` action every other job uses, but no run has happened, so criterion 1 is left unchecked until the pull request goes green. Nothing in the script needs the network or a TTY, which is what would most plausibly differ on a runner.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `pnpm fed:smoke`: a federation smoke test that boots a real CMS on a free port over a temporary copy of the new `packages/cms/test/fixtures/federation/` fixture, runs `fedify lookup` from `@fedify/cli` against the actor and a post object, receives a real signed `Follow` and answers `Accept`, and then publishes a post into the watched content directory and proves the `Create(Article)` reached two real inboxes over sockets. It runs in about three seconds, needs no network, cleans up its temporary directories and child processes on any exit, and is a `fed-smoke` job in CI.

Files: `packages/cms/scripts/fed-smoke.ts`, `packages/cms/test/fixtures/federation/`, `fed:smoke` scripts in the root and package manifests, `@fedify/cli` pinned at 2.3.6 as a package devDependency, `scripts/**/*.ts` added to `packages/cms/tsconfig.json`, a `fed-smoke` job in `.github/workflows/ci.yml`, and a 'Testing federation against a real Mastodon account' section in `packages/cms/README.md` covering `fedify tunnel`, `GEEKITY_BASE_URL`, the search-follow-publish round trip, and the two traps (a tunnel address changes per run so its followers are throwaway; the actor keys live in the data directory and survive).

`fedify inbox --follow` turned out to be unusable against a loopback actor — `@fedify/cli` 2.3.6 builds that command's document loader with `allowPrivateAddress: false` and its config schema has no key for it — so the `Follow` is sent by a peer built in the script out of Fedify and `@hono/node-server`, which is the fallback the task allowed for; `fedify inbox` is still run as a second real inbox and asserted on the `Create(Article)` line it displays. The notes record the reading that established this.

Verified: `pnpm fed:smoke` exit 0 four consecutive times with no orphaned processes; `pnpm build`, `pnpm test` (577 + 10, 0 failures), `pnpm test:11ty`, `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all clean from the repo root; the CI workflow loads under js-yaml with the new job present. Acceptance criterion 1 is left unchecked because only its local half could be run here.
<!-- SECTION:FINAL_SUMMARY:END -->
