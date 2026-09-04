---
id: TASK-30
title: Actor key pairs live in data/keys as JWK files
status: To Do
assignee: []
created_date: '2026-09-04 00:18'
updated_date: '2026-09-04 00:19'
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
- [ ] #1 On first boot with no key files, both pairs are generated, written under data/keys with 0600 permissions, and the actor document publishes them
- [ ] #2 On a later boot the same files are read back and the actor publishes the identical publicKey and assertionMethods
- [ ] #3 A database holding actor_keys rows and no key files is migrated file-first on boot, the actor keeps its existing keys, and the table is dropped; a test proves the public key is unchanged across that boot
- [ ] #4 Deleting the database and booting leaves the keys untouched
- [ ] #5 A key file that will not import is reported clearly rather than silently regenerated, since regeneration would change the actor's identity
<!-- AC:END -->
