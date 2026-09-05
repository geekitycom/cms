---
id: TASK-71
title: >-
  geekity import wordpress-actor: a user's key pair, stored actor id and
  followers from a WordPress ActivityPub site
status: To Do
assignee: []
created_date: '2026-09-05 13:51'
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
- [ ] #1 geekity import wordpress-actor with a username, actor id, numeric actor id and PEM key pair writes the JWK files, sets both ids on the user, and a fedify lookup of the user afterwards shows the imported public key under the stored id
- [ ] #2 The followers collection is fetched and every reachable follower lands in the user's followers.json and index with inbox, shared inbox, handle, name, avatar and URL; unreachable ones are reported and skipped
- [ ] #3 Running the command a second time changes nothing and says so; running it against a user who already has a key pair refuses unless a force flag is given
- [ ] #4 The command is tested against a fake WordPress served in-process with the shapes recorded in decision-14, and the README documents the wp-cli export it expects
- [ ] #5 The package README and doc-4 carry a cutover checklist for a site leaving the plugin: export, import, switch on, watch the federation screen, switch off
<!-- AC:END -->
