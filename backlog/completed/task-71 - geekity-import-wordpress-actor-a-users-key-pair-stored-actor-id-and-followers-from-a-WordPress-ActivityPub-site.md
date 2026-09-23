---
id: TASK-71
title: >-
  geekity import wordpress-actor: a user's key pair, stored actor id and
  followers from a WordPress ActivityPub site
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:51'
updated_date: '2026-09-13 05:56'
labels:
  - federation
  - infra
milestone: m-11
dependencies:
  - TASK-69
  - TASK-70
references:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/cli.ts
  - packages/cms/src/federation/keys.ts
  - packages/cms/src/federation/records.ts
  - 'https://andrewshell.org/wp-json/activitypub/1.0/actors/2/followers'
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 99500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The cutover for a site leaving the WordPress ActivityPub plugin is: export the key pair and the followers before DNS moves, import them, set the user's stored actor id and WordPress actor id, and turn the compatibility switch on. Add a CLI command that does the import for one user. It takes the username, the actor's id as WordPress published it (https://example.com/?author=2), the plugin's numeric actor id, and the RSA key pair as PEM files exported from user meta with wp-cli, and it writes the pair as the user's JWK files under data/keys/, sets the stored actor id (TASK-69) and the WordPress actor id (TASK-70) on the user record, and fetches the public followers collection at the plugin's URL, dereferencing each follower for its inbox, shared inbox, handle, name, avatar and profile URL, into the user's followers.json with the index updated. A follower that cannot be fetched is listed in the report and skipped rather than failing the import. The command is idempotent: run twice it changes nothing the second time. It refuses to overwrite an existing key pair unless told to, because losing a private key breaks federation for every follower. andrewshell.org is the test case: its actor, key id, inbox paths and followers collection are recorded in decision-14.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 geekity import wordpress-actor with a username, actor id, numeric actor id and PEM key pair writes the JWK files, sets both ids on the user, and a fedify lookup of the user afterwards shows the imported public key under the stored id
- [x] #2 The followers collection is fetched and every reachable follower lands in the user's followers.json and index with inbox, shared inbox, handle, name, avatar and URL; unreachable ones are reported and skipped
- [x] #3 Running the command a second time changes nothing and says so; running it against a user who already has a key pair refuses unless a force flag is given
- [x] #4 The command is tested against a fake WordPress served in-process with the shapes recorded in decision-14, and the README documents the wp-cli export it expects
- [x] #5 The package README and doc-4 carry a cutover checklist for a site leaving the plugin: export, import, switch on, watch the federation screen, switch off
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `src/federation/keys.ts`: export `writeActorKeyFile(dataDir, identifier, algorithm, privateJwk)` so the file layout, the 0700 directory and the 0600 mode stay in one place.
2. `src/admin/accounts.ts`: `setUserWordPressActor({ dataDir, username, actorId, wordpressActorId })` — the only writer of the two fields, with the collision check (another user already carrying either id) inside the write, the way createUser's duplicate check is.
3. New `src/federation/import-wordpress.ts`: `importWordPressActor()`. PEM (PKCS#1 or PKCS#8) through node:crypto into WebCrypto and out through fedify's `exportJwk`, so the file is byte-identical in shape to a generated one; an optional public PEM is checked against the private half and refused if it disagrees. An existing key file that is the same key is a no-op, a different one is refused unless `force`. Then `loadActorKeyPairs` to mint the Ed25519 pair and prove the RSA file imports. Then the followers: fetch the OrderedCollection, walk first/next, dereference each item (the live plugin answers `orderedItems` as bare actor URLs), map to the follower shape and `addFollower`. A follower that will not fetch is reported and skipped. Returns a report saying what changed.
4. `src/cli.ts`: `geekity import wordpress-actor <username>` with `--actor-id`, `--wordpress-id`, `--private-key`, `--public-key`, `--keypair` (the JSON `wp option get` prints), `--followers <url|file|none>` and `--force`. parseArgs grows one `flags` map rather than seven fields.
5. Tests first: `src/federation/import-wordpress.test.ts` against a fake WordPress served in-process by a stubbed `fetch` with the shapes in decision-14, and CLI tests in `cli.test.ts` driving the real bin with `--followers` pointing at a file so the child never reaches the network.
6. `scripts/fed-smoke.ts`: the migrated account's stored id, its WordPress number and its RSA key come from the importer instead of being written by hand, and the `fedify lookup` of the stored id asserts the `publicKeyPem` is the imported one (AC #1).
7. README: the command's table row, a section with the wp-cli export it expects, and the cutover checklist; the same checklist in doc-4.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned, test-first.

**New `src/federation/import-wordpress.ts`** — `importWordPressActor()`. The PEM goes node:crypto -> DER -> WebCrypto -> fedify's `exportJwk`, the long way round on purpose: an imported key file is then byte-for-byte the shape a generated one has, `alg: "RS256"` included, which is what the boot check in `keys.ts` insists on. PKCS#1 and PKCS#8 both read. An optional public PEM is compared against the derived half and refused if it disagrees; it is never stored, because it is derivable. Everything that can be refused is decided before anything is written, so a refused run leaves the disk as it was.

**Idempotence** is per thing rather than global: a key file holding the same key is `unchanged`, a different one is refused unless `force`; `setUserWordPressActor` writes nothing when the record already says both ids; `addFollower` keeps a follower's place and follow time, so a second run writes the same bytes.

**Followers.** The live plugin (checked 2026-09-12) answers the collection with `first` and no items, and the page's `orderedItems` are bare actor URLs, so each follower is one dereference. The walker follows `first` only when a document listed nothing itself and `next` otherwise, tracks visited URLs so a self-referential `next` cannot loop, and accepts an embedded page or an embedded actor without fetching. A follower that will not fetch lands in `report.followers.failed` and is skipped.

**`writeActorKeyFile`** added to `keys.ts` so the 0700 directory and the 0600 file stay the one answer to where a key lives. **`setUserWordPressActor`** added to `accounts.ts` as the only writer of `actorId`/`wordpressActorId`, with the uniqueness check inside the write the way `createUser`'s duplicate check is.

**CLI.** `parseArgs` grew one `flags` map over a `VALUE_FLAGS`/`SWITCH_FLAGS` table rather than seven more near-identical branches, and now refuses an unknown `--option` instead of reading it as a positional. `--keypair` reads the JSON `wp option get activitypub_keypair_for_{login} --format=json` prints (the current plugin's storage; source-checked against Automattic/wordpress-activitypub `includes/collection/class-actors.php`); `--private-key`/`--public-key` read the legacy `magic_sig_*` user meta PEMs.

**fed-smoke** now gets the migrated account's stored id, WordPress number and RSA key from the importer instead of `writeUsers`, and asserts the `publicKeyPem` a `fedify lookup` of the stored id returns is the public half of the pair that was imported. That is AC #1 over a real socket, and the second run there proves idempotence against a live site.

Validation: `pnpm build`, `pnpm test` (1613 + 15 pass, 0 fail), `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm fed:smoke` all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `geekity import wordpress-actor <username>`: the cutover, for one person. `src/federation/import-wordpress.ts` turns the plugin's exported RSA PEM into the user's JWK key file (through WebCrypto and fedify's `exportJwk`, so it is identical in shape to a generated one), mints the Ed25519 pair beside it, writes the stored actor id and the WordPress number onto the user record through a new `setUserWordPressActor` — the only writer of either — and walks the plugin's public followers collection, dereferencing each bare actor URL into `content/_data/federation/{username}/followers.json` and the index. Unreachable followers are reported and skipped; a second run writes nothing and says so; a different key pair already on the user is refused without `--force`.

Verified by `src/federation/import-wordpress.test.ts` against a fake WordPress served in process with the shapes decision-14 recorded (collection with only a `first`, page of bare actor URLs, one 410), by `src/cli.test.ts` driving the real bin over a saved collection file so the child never touches the network, and by `pnpm fed:smoke`, where the migrated account is now imported rather than hand-written and a `fedify lookup` of its stored actor id returns the public half of the imported pair. README and doc-4 carry the wp-cli export and the export/import/switch-on/watch/switch-off checklist. `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm fed:smoke` all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
