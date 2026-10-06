---
id: TASK-282
title: >-
  Move the WordPress ActivityPub compatibility out of core into the wordpress
  plugin
status: To Do
assignee: []
created_date: '2026-10-06 12:09'
updated_date: '2026-10-06 12:09'
labels:
  - plugins
  - federation
milestone: m-30
dependencies:
  - TASK-281
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/federation/wordpress.ts
  - packages/cms/src/federation/import-wordpress.ts
  - packages/cms/src/admin/accounts.ts
  - packages/cms/src/cli.ts
priority: high
type: chore
ordinal: 238800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second WordPress step of M31 (decision-33). Everything behind the decision-14 switch moves into `packages/cms/plugins/wordpress/`: the second Fedify federation (src/federation/wordpress.ts), its gate, the `data/wordpress-activitypub.json` request record, the Federation > Settings section that shows it, the `geekity import wordpress-actor` CLI command (src/federation/import-wordpress.ts) and the per-user `wordpressActorId`. Core gains the host API these need and nothing more: a middleware phase in the federation mount (after the canonical Fedify middleware, before the stored-id middleware), access to the site federation KV and inbox handlers, a plugin data directory under `data/plugins/wordpress/` with atomic writes, a plugin admin screen under Plugins, and CLI command registration. Stored actor and object ids, WebFinger aliases, the feed and archive layout and oEmbed stay in core (decision-14).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No file under packages/cms/src imports from packages/cms/plugins or names WordPress outside the boot migration, enforced by a lint rule that fails on a planted import
- [ ] #2 The wordpress plugin imports only the host API types and its own files, enforced by the same lint
- [ ] #3 With the plugin enabled, every /wp-json/activitypub/1.0/ route (actor, inbox, shared inbox, outbox, followers, following) behaves as before; the existing wordpress, settings-federation, import and fed-smoke tests pass against the plugin
- [ ] #4 The canonical inbox keeps withIdempotency(per-origin) and a core test fails if it is removed
- [ ] #5 The request record and the last-asked-for view live on the plugin screen under Plugins > WordPress; Federation > Settings no longer shows them
- [ ] #6 `geekity import wordpress-actor` works as before when registered by the plugin, and `geekity --help` lists it
- [ ] #7 At boot each wordpressActorId in data/users.json moves to the plugin data file and leaves the user record; the move is idempotent, and a crash halfway leaves a state the next boot finishes
- [ ] #8 decision-14 cutover steps in the README read "enable the WordPress plugin" instead of "turn the switch on"
<!-- AC:END -->
