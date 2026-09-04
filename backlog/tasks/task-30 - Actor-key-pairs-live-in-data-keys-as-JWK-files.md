---
id: TASK-30
title: Actor key pairs live in data/keys as JWK files
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:18'
updated_date: '2026-09-04 16:24'
labels:
  - federation
milestone: m-4
dependencies:
  - TASK-16
  - TASK-29
references:
  - >-
    backlog/decisions/decision-9 -
    Files-are-the-source-of-truth-for-all-durable-state-SQLite-is-a-disposable-cache.md
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: task
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move the site actor's RSA and Ed25519 key pairs out of the `actor_keys` table into JWK files under `data/keys/` (for example `actor.rsassa-pkcs1-v1_5.jwk` and `actor.ed25519.jwk`), written atomically with 0600 permissions. `loadActorKeyPairs` reads the files, generating and writing a pair only when its file is absent. This is the one migration that must not fail: a site whose database holds keys but whose files do not exist must get the rows written out as files on first boot before the table is dropped, otherwise every follower's cached public key stops verifying. Keep the sentinel identifier so file names never depend on the handle.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On first boot with no key files, both pairs are generated, written under data/keys with 0600 permissions, and the actor document publishes them
- [x] #2 On a later boot the same files are read back and the actor publishes the identical publicKey and assertionMethods
- [x] #3 A database holding actor_keys rows and no key files is migrated file-first on boot, the actor keeps its existing keys, and the table is dropped; a test proves the public key is unchanged across that boot
- [x] #4 Deleting the database and booting leaves the keys untouched
- [x] #5 A key file that will not import is reported clearly rather than silently regenerated, since regeneration would change the actor's identity
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test, all public: loadActorKeyPairs(dataDir, identifier) — generates both pairs on the first call, writes data/keys/actor.rsassa-pkcs1-v1_5.jwk and actor.ed25519.jwk at 0600 inside a 0700 directory, reads them back identically on the next call, and throws an error naming the file rather than regenerating when one will not import; and app.request('/ap/actor') against a real CMS — the actor publishes the file's keys, publishes the identical publicKey and assertionMethods after a restart, keeps them when the database is deleted, and keeps them across the boot that migrates an actor_keys-shaped database.

2. packages/cms/src/federation/keys.ts becomes the whole story of a key. ACTOR_KEY_ALGORITHMS and ActorKeyAlgorithm move here from admin/store.ts, since keys are no longer the store's business. actorKeysDir(dataDir) is data/keys and actorKeyFile(dataDir, identifier, algorithm) is {identifier}.{algorithm lowercased}.jwk, so the sentinel identifier keeps the names off the handle. Each file holds the private JWK alone; the public key is derived from it by keeping kty, alg, crv, n, e and x and dropping d, p, q, dp, dq, qi and key_ops, which is what makes a single file the whole pair.

3. loadActorKeyPairs(dataDir, identifier) reads each file: present and importable, it is the pair; present and not importable, it throws naming the file and saying that regeneration would change the actor's identity and that deleting the file is the deliberate way to ask for a new one (AC #5); absent, a pair is generated and written through updateFileAtomically at { mode: 0o600 }, with the re-check inside the queue so two concurrent first calls cannot each generate. The directory is created 0700 first, so the bytes are never in a world-readable place. federation.ts passes context.data.config.dataDir instead of context.data.admin.

4. migrateActorKeysToFiles({ admin, dataDir }) in the same file, run in createCms on the line after migrateSettingsToFile. It reads the rows through a new AdminStore.legacyActorKeys() — prepared lazily behind hasTable, like legacySettings() — writes each row's private JWK to its file with writeFileAtomicallySync at 0600 only when the file is absent, so a file always wins, and then calls dropLegacyTable('actor_keys'). The drop is after the write, never before. Migration 4 stays exactly as it shipped and its comment says so, as migration 3's does.

5. The store loses what it no longer holds: listActorKeys, putActorKey, their two prepared statements (a SELECT over a dropped table throws when it is prepared), ActorKey and NewActorKey. It gains legacyActorKeys() and LegacyActorKey. ACTOR_KEY_ALGORITHMS and ActorKeyAlgorithm are re-exported from the package barrel through the federation barrel instead of the admin one, so the two names a consumer might use stay exported.

6. Tests: keys.test.ts is rewritten over the files (generation, permissions, read-back, the unimportable file, the concurrent first call); a new describe in it or in federation.test.ts covers the actor across a restart, across a deleted database and across the migration; store.test.ts loses the actor key describe and gains a legacyActorKeys one beside the legacySettings one.

7. Docs: doc-4 line 17 says the keys are in SQLite and must say data/keys; packages/cms/README.md at 238 ("live in SQLite whatever those are set to") and 403 ("live in the SQLite database under dataDir") say the same; README.md 235 and the .gitignore comment call data/ derived state, which data/keys is not. Then pnpm build, test, typecheck, lint, format:check and fed:smoke from the root, and a manual pass on port 3000 over a scratch content and data dir: fetch the actor, restart and compare the publicKey, delete geekity.db and boot again, boot a database rebuilt in the old shape, and corrupt a key file.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

`packages/cms/src/federation/keys.ts` is now the whole story of an actor's keys. `ACTOR_KEY_ALGORITHMS` and `ActorKeyAlgorithm` moved here from `admin/store.ts`; `actorKeysDir(dataDir)` is `data/keys` and `actorKeyFile(dataDir, identifier, algorithm)` is `{identifier}.{algorithm lowercased}.jwk` — `actor.rsassa-pkcs1-v1_5.jwk` and `actor.ed25519.jwk`, built from the sentinel identifier so the names never depend on the handle. Each file holds the private JWK alone.

`loadActorKeyPairs(dataDir, identifier)` replaced `loadActorKeyPairs(store, identifier)`; `federation.ts` passes `context.data.config.dataDir`. Present and importable, the file is the pair; absent, one is generated and written through `updateFileAtomically` at `{ mode: 0o600 }` with the re-check inside the queue; present and unusable, it throws naming the file rather than replacing it.

`migrateActorKeysToFiles({ admin, dataDir })` runs in `createCms` on the line after `migrateSettingsToFile`. It reads the rows through a new `AdminStore.legacyActorKeys()` (prepared lazily behind `hasTable`, like `legacySettings()`), writes each row's private JWK with `writeFileAtomicallySync` at 0600 only when the file is absent, then `dropLegacyTable('actor_keys')`. Migration 4 stays exactly as it shipped; its comment now says why, as migration 3's does.

The store lost `listActorKeys`, `putActorKey`, their two prepared statements, `ActorKey` and `NewActorKey`, and gained `legacyActorKeys()` and `LegacyActorKey`.

## The one thing the plan missed

Fedify catches whatever the key pairs dispatcher throws and returns an empty list (`getActorKeyPairs` in `middleware`, logging only 'No actor key pairs dispatcher registered'). So the clear error `loadActorKeyPairs` raises reached nobody: the first manual pass truncated `actor.ed25519.jwk` and the server answered `/ap/actor` with HTTP 200 and no `publicKey` and no `assertionMethod` at all — silently unverifiable to every follower, which is exactly what AC #5 forbids. Two guards were added, each test-first:

- `assertActorKeysUsable(dataDir, identifier)`, called in `createCms` after the migration: a synchronous read of each present key file that refuses to boot when it is not a JWK private key of the right shape (the checks `importJwk` makes, minus the arithmetic, which is all a synchronous boot can do). Refusing to start is the report; the message names the file.
- `siteActor` throws when `getActorKeyPairs` comes back empty, so a file damaged after boot answers with an error rather than a keyless actor document a peer would cache.

## Decisions

- **One file per pair, private half only.** The public key is derived from the private JWK by keeping `kty`, `alg`, `crv`, `n`, `e` and `x` and dropping `d`, `p`, `q`, `dp`, `dq`, `qi` and `key_ops` (a key exported for signing says `["sign"]`, and importing it for verification with that on it is refused). Storing both halves would only invite them to disagree, and a site signing with a key nobody can check is the worst state available.
- **Files win, always.** The migration writes a row out only when its file is absent. A site that has booted this version once has the truth on disk, and a database restored from a backup taken before the upgrade must not overwrite it.
- **The drop is after the write, and unconditional.** A fresh database gets `actor_keys` from migration 4 and drops it a moment later; a site that has migrated must not be asked again.
- **Damaged is not healed.** The old code replaced a row that would not import. That heals a cache and destroys an identity, so it is now the one thing that stops a boot.
- **0700 on the directory.** `ensureKeysDir` makes `data/keys` with mode 0700 before the atomic writer's own `mkdir -p` can make it with the process default; the files are 0600, applied to the temporary file before the rename.
- **The file name is sanitised.** `fileToken` lowercases and turns anything but a letter, digit, dash or underscore into a dash, so nothing an identifier or a row's algorithm carries can reach out of `data/keys`. The migration takes the algorithm as a bare string for that reason: a row a later version wrote still reaches a file rather than going with the table.
- **Lazy generation, not boot generation.** Keys are still minted by the first request that needs them, which is what keeps `createCms` synchronous. The boot check covers the files that are already there.

## Mutation checks

Each mutation failed exactly the tests that name that behaviour, and nothing else:

- `loadPair` ignoring the file and always generating -> 9 failed: both read-back tests, the per-algorithm one, the race, both AC #5 ones, the restart, the deleted database and the migration.
- `migrateActorKeysToFiles` a no-op -> only 'writes an older database's rows out as files and drops the table (AC #3)'.
- the migration writing over a file that is already there -> only 'leaves a key file alone when the old table still holds a row for it'.
- `assertActorKeysUsable` gutted -> only 'refuses to boot on a key file that will not import (AC #5)'.
- the empty-keys guard removed from `siteActor` -> only 'answers the actor with an error rather than no key at all (AC #5)'.

## Validation

`pnpm build`, `pnpm test` (949 package + 11 demo, 0 fail), `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test:11ty` (10 + 5) all pass from the repo root. `pnpm fed:smoke` passes: a peer built out of Fedify followed the actor, was sent a `Create(Article)` and accepted it, so the file-borne keys sign HTTP Signatures a real peer verifies.

## Manual pass on port 3000

A scratch content and data directory (`GEEKITY_CONTENT_DIR`/`GEEKITY_DATA_DIR`, the demo's content copied in) and `apps/demo/server.ts`. `apps/demo/data` was never opened.

- **AC #1.** Booted with no key files; `data/keys` did not exist yet. The first `GET /ap/actor` (200) created `data/keys` `drwx------` with `actor.ed25519.jwk` and `actor.rsassa-pkcs1-v1_5.jwk` both `-rw-------`, and the document carried a `CryptographicKey` with a `-----BEGIN PUBLIC KEY-----` PEM and two `Multikey` assertion methods. `sqlite_master` had neither `actor_keys` nor `settings`.
- **AC #2.** Killed the server and booted again on the same directories: `publicKey` and `assertionMethod` were byte-identical, and both key files kept their md5 and their mtime.
- **AC #3.** Put the two files' contents into a hand-made `actor_keys` table, deleted the files and removed `data/keys`, then booted. The files were back before any request arrived, both 0600, `actor_keys` was gone from `sqlite_master`, and `/ap/actor` published the identical `publicKey` and `assertionMethod` as the first boot.
- **AC #4.** Deleted `geekity.db`, `geekity.db-shm` and `geekity.db-wal`, leaving only `data/keys`, and booted: the actor published the identical keys and both files kept their md5 and mtime, untouched.
- **AC #5.** Truncated `actor.ed25519.jwk` to 120 bytes. `npx tsx server.ts` exited 1 with 'The actor key file …/data/keys/actor.ed25519.jwk could not be read as a JWK private key: Unterminated string in JSON at position 120. It has deliberately not been replaced, because a new key would change the actor's identity and every follower would stop verifying the site. Restore the file from a backup, or delete it to ask for a new key on purpose.' Nothing listened on 3000, and the file was still the same 120 bytes. Deleting it — what the message says — let the site boot: the RSA `publicKey` was unchanged, the Ed25519 multikey was new, and `/`, `/feed/`, `/feed/atom/`, WebFinger and `/ap/actor/outbox` all answered 200. `npx fedify lookup http://localhost:3000/ap/actor` fetched the Person with its `CryptographicKey`.

Port 3000 was released and the scratch directories deleted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The site actor's key pairs are files: `data/keys/actor.rsassa-pkcs1-v1_5.jwk` and `data/keys/actor.ed25519.jwk`, each the private JWK alone, written atomically 0600 in a 0700 directory, and the `actor_keys` table is gone.

`loadActorKeyPairs` now takes a data directory rather than the admin store: it reads each file, derives the public half from the private one, and generates a pair only where a file is absent — through `updateFileAtomically` with the look-again inside the queue, so two callers racing on a fresh site cannot each mint a key. The names come from the sentinel identifier, so renaming the handle still leaves every URL, every follower and every key alone. A database holding `actor_keys` rows has them written out as files on the first boot, before the table is dropped and only where no file already exists — the file always wins — and migration 4 stays exactly as it shipped.

The one thing the plan missed and the manual pass caught: Fedify swallows whatever the key pairs dispatcher throws and answers with an actor document that has no `publicKey` at all, so the clear error over a damaged key file reached nobody and the site went on serving something no follower could verify. A synchronous `assertActorKeysUsable` in `createCms` now refuses to boot on a key file that is not a usable JWK, naming it and saying to restore or delete it, and `siteActor` throws rather than publishing an actor with no keys when a file is damaged after boot. Neither ever replaces a key, because a new key is a new identity.

Verified with 949 package tests (0 fail), 17 of them over the keys — generation, permissions, read-back, per-algorithm independence, the race, an unimportable file, the boot refusal, the keyless-actor refusal, the actor across a restart, across a deleted database, across the migration, and the file winning over a stale row — each mutation-checked: ignoring the file, skipping the migration, letting it overwrite a file, gutting the boot check and dropping the actor guard each failed exactly the tests that name that behaviour and nothing else. `pnpm fed:smoke` passes, so a real Fedify peer verifies signatures made with the file-borne keys. Then a manual pass on a real server on port 3000 over scratch directories covering all five criteria, including booting over a hand-made `actor_keys` table with the files deleted and watching the actor keep its exact `publicKey`, deleting `geekity.db` and watching the keys stay untouched, and truncating a key file to see the boot exit 1 naming it. `pnpm build`, `test`, `typecheck`, `lint`, `format:check` and `test:11ty` all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
