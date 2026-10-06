---
id: TASK-282
title: >-
  @geekity/plugin-wordpress: move the WordPress ActivityPub compatibility out of
  core
status: To Do
assignee: []
created_date: '2026-10-06 12:09'
updated_date: '2026-10-06 13:15'
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
  - release-please-config.json
  - commitlint.config.js
priority: high
type: chore
ordinal: 238800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). Everything behind the decision-14 switch moves into a new package, packages/plugin-wordpress, published as @geekity/plugin-wordpress: the second Fedify federation (src/federation/wordpress.ts), its gate, the data/wordpress-activitypub.json request record, the Federation > Settings section that shows it, the `geekity import wordpress-actor` CLI command (src/federation/import-wordpress.ts) and the per-user wordpressActorId. Core gains the host API these need and nothing more: a middleware phase in the federation mount (after the canonical Fedify middleware, before the stored-id middleware), access to the site federation KV and inbox handlers, a plugin data directory under data/plugins/wordpress/ with atomic writes, a plugin admin screen under Plugins, and CLI command registration. Stored actor and object ids, WebFinger aliases, the feed and archive layout and oEmbed stay in core (decision-14). No deployed site uses the switch (2026-10-06: shll.me is the only site on the CMS and does not use it; andrewshell.org is still on WordPress), so nothing migrates: the setting, the user field and the code leave core outright. Each plugin package added here gets its release-please entry (include-component-in-tag true), its commitlint scope and CLAUDE.md scope row, CI lint, typecheck and tests, the shared bundle build, and a smoke test installing it against the packed @geekity/cms tarball.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The plugin package imports only @geekity/cms/plugin from core
- [ ] #2 With the plugin installed and enabled, every /wp-json/activitypub/1.0/ route (actor, inbox, shared inbox, outbox, followers, following) behaves as before; the wordpress, settings-federation, import and fed-smoke tests pass against the package
- [ ] #3 The canonical inbox keeps withIdempotency(per-origin) and a core test fails if it is removed
- [ ] #4 The request record and the last-asked-for view live on the plugin screen; Federation > Settings no longer shows them
- [ ] #5 `geekity import wordpress-actor` works as before when the plugin is installed, and `geekity --help` lists it
- [ ] #6 The package has its release-please entry, commitlint scope, CLAUDE.md scope row, CI jobs, bundle build and packed-tarball smoke test
- [ ] #7 Nothing in @geekity/cms names WordPress, checked by a test over the source; the wordpressActivityPub setting and the wordpressActorId user field are gone from core
- [ ] #8 The plugin keeps each user to WordPress actor id mapping in its own data file, written by `geekity import wordpress-actor` and read by its federation
- [ ] #9 The cms commit carries a BREAKING CHANGE footer naming the package that replaces the switch; the decision-14 cutover steps in the README read "install and enable the WordPress plugin"
<!-- AC:END -->
