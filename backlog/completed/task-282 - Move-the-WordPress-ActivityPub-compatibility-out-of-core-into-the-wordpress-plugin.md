---
id: TASK-282
title: >-
  @geekity/plugin-wordpress: move the WordPress ActivityPub compatibility out of
  core
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 12:09'
updated_date: '2026-10-08 15:03'
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
M31 (decision-33). Everything behind the decision-14 switch moves into a new package, packages/plugin-wordpress, published as @geekity/plugin-wordpress: the second Fedify federation (src/federation/wordpress.ts), its gate, the data/wordpress-activitypub.json request record, the Federation > Settings section that shows it, the `geekity import wordpress-actor` CLI command (src/federation/import-wordpress.ts) and the per-user wordpressActorId. Core gains the host API these need and nothing more: a middleware phase in the federation mount (after the canonical Fedify middleware, before the stored-id middleware), access to the site federation KV and inbox handlers, a plugin data directory under data/plugins/@geekity/plugin-wordpress/ with atomic writes, a plugin admin screen under Plugins, and CLI command registration. Stored actor and object ids, WebFinger aliases, the feed and archive layout and oEmbed stay in core (decision-14). No deployed site uses the switch (2026-10-06: shll.me is the only site on the CMS and does not use it; andrewshell.org is still on WordPress), so nothing migrates: the setting, the user field and the code leave core outright. Each plugin package added here gets its release-please entry (include-component-in-tag true), its commitlint scope and CLAUDE.md scope row, CI lint, typecheck and tests, the shared bundle build, and a smoke test installing it against the packed @geekity/cms tarball.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The plugin package imports only @geekity/cms/plugin from core
- [x] #2 With the plugin installed and enabled, every /wp-json/activitypub/1.0/ route (actor, inbox, shared inbox, outbox, followers, following) behaves as before; the wordpress, settings-federation, import and fed-smoke tests pass against the package
- [x] #3 The canonical inbox keeps withIdempotency(per-origin) and a core test fails if it is removed
- [x] #4 The request record and the last-asked-for view live on the plugin screen; Federation > Settings no longer shows them
- [x] #5 `geekity import wordpress-actor` works as before when the plugin is installed, and `geekity --help` lists it
- [x] #6 The package has its release-please entry, commitlint scope, CLAUDE.md scope row, CI jobs, bundle build and packed-tarball smoke test
- [x] #7 Nothing in @geekity/cms names WordPress, checked by a test over the source; the wordpressActivityPub setting and the wordpressActorId user field are gone from core
- [x] #8 The plugin keeps each user to WordPress actor id mapping in its own data file, written by `geekity import wordpress-actor` and read by its federation
- [x] #9 The cms commit carries a BREAKING CHANGE footer naming the package that replaces the switch; the decision-14 cutover steps in the README read "install and enable the WordPress plugin"
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Host API in @geekity/cms/plugin (plain data across the boundary, so a bundled plugin with its own Fedify copy never hands core a foreign object): host.data (data/plugins/<name>/, read + atomic update), host.federation(middleware) run in the federation mount after the canonical Fedify middleware and before stored ids, with the site federation KV, allowPrivateAddress, the canonical actor/outbox/followers as JSON-LD and receive(activity JSON-LD, recipient) running core's inbox handlers on a canonical context; host.screen (structured blocks drawn by core under Plugins, in the menu while active); host.command (words, usage, options, run) listed by geekity --help and run by the CLI for installed plugins. PluginSite: users, setActorId, actor keys, followers, addFollower.
2. Core: one inbox handler table used by the canonical listeners (withIdempotency per-origin, held by a test) and by receive. Generic setUserActorId replaces setUserWordPressActor.
3. Subtract from core: wordpress.ts, import-wordpress.ts, the wordpressActivityPub setting and its Federation > Settings section and panel, wordpressActorId, the import CLI command and exports. fed-smoke seeds the stored actor id and RSA key directly.
4. packages/plugin-wordpress (@geekity/plugin-wordpress): second Fedify federation over the host, request record and actor map in its data folder, plugin screen, geekity import wordpress-actor command. Port wordpress, settings panel, import and CLI tests; a plugin fed-smoke over real sockets.
5. Packaging: release-please entry (include-component-in-tag true), commitlint scope plugin-wordpress + CLAUDE.md row, CI lint/typecheck/test/fed-smoke via pnpm -r, esbuild bundle build, pack-install smoke installs the packed plugin against the packed core.
6. Remove every mention of WordPress from @geekity/cms source with a test over src/ and admin/; README cutover reads install and enable the WordPress plugin.
7. Verify: pnpm build, test, typecheck, lint, format:check, test:11ty, fed:smoke, pack-install smoke, curl a running demo with the plugin.

8. Revised for step 6: the source test strips comments, so no code, string, template or script names WordPress; comments citing its conventions as rationale for core-by-decision layouts stay. Step 1 grew keyPairs on the federation context, which Fedify's inbox needs for the recipient.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Host API (packages/cms/src/plugin.ts, HOST_API_VERSION stays 1): host.data (data/plugins/<name>/, read + atomic update, one-segment file names only), host.federation(middleware) run in the federation mount after the canonical Fedify middleware and before stored ids, host.screen (cards of paragraphs and tables drawn by core at /admin/plugins/<name>, in the Plugins menu while active), host.command (words, usage, options, run; listed by geekity --help, runs for any available plugin, enabled or not). PluginFederationContext hands over the site KV, allowPrivateAddress, the canonical actor, key pairs, outbox and followers as plain data (JSON-LD, URL strings, WebCrypto keys) and receive(activity JSON-LD, recipient), which core re-parses with its own vocabulary and dispatches through INBOX_LISTENERS, the same table the canonical inbox listens with. Plain data because the bundle inlines its own Fedify: test/bundle.test.ts runs the built bundle against core and an Undo(Follow) removes the follower, which needs core's instanceof Follow to hold. PluginSite: users, setActorId (core setUserActorId replaces setUserWordPressActor), actorKey, writeActorKey, loadActorKeys, followers, addFollower. pluginSite and pluginDataFolder are exported from @geekity/cms for a site's scripts and the plugin's tests.

Removed from core: federation/wordpress.ts, federation/import-wordpress.ts (moved to packages/plugin-wordpress with their tests), the wordpressActivityPub setting, the Federation > Settings switch and panel, User.wordpressActorId, the import CLI command and its flags, and every WordPress export. The plugin keeps actors.json (username -> WordPress number) and requests.json in its data folder. Core fed-smoke now seeds the migrated account's stored id and RSA key directly; the plugin has its own fed-smoke (import, fedify lookup of the old actor and collections, a signed Follow from a Fedify peer to the old inbox with the Accept verified against the imported key, the request record, disable).

AC #7 interpretation: plugin-boundary.test.ts fails on any code, string, template text or script in @geekity/cms that names WordPress, with comments stripped (probe: a reintroduced wordpressActivityPub const fails it). About 110 comment lines still cite WordPress conventions as the reason for layouts core keeps by decision-14 (feed and archive URLs, ?p= ids, oEmbed's wp-embed protocol, the admin menu order); rewording them would drop the rationale. If the criterion means comments too, extend withoutComments to keep them and sweep. Test names that named it were reworded.

Packaging: release-please entry (component plugin-wordpress, include-component-in-tag true, extra-files src/version.ts, own PR title), manifest 0.0.0, commitlint scope plugin-wordpress, CLAUDE.md row. Root build/fed:smoke now run over packages/*; lint, typecheck, test already recurse, so every CI job covers the plugin. Bundle: scripts/build-plugin-bundle.js (esbuild, deps inlined, dist/bundle/index.js, 7.5 MB). pack-install-smoke.sh packs and installs the plugin beside core, runs --help and the import through the installed bin, loads the bundle with no node_modules, curls the old actor path on the booted site, and type checks a site importing the package. Dockerfile copies the plugin's package.json for the frozen install only; docker-smoke passed. Not done here: publishing plugin packages (scripts/npm-publish.sh is core-only), and plugin.json from the geekity field (TASK-287).

Validation 2026-10-08: pnpm build && pnpm test (cms 4851, demo 32, plugin 36 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0; pnpm test:11ty 18 + 8 pass; pnpm fed:smoke passes for core and the plugin; scripts/pack-install-smoke.sh passes; docker build + scripts/docker-smoke.sh pass. Per-origin idempotency test fails with actual 2 vs expected 1 when withIdempotency is removed. AC #9 waits on the commit: the cms commit needs a BREAKING CHANGE footer naming @geekity/plugin-wordpress.

Orchestrator: the feat(cms)! commit carries the BREAKING CHANGE footer naming @geekity/plugin-wordpress; doc-4 and doc-5 now describe the plugin instead of the switch. decision-14 still mentions the switch; the backlog CLI has no decision edit.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the WordPress ActivityPub compatibility out of @geekity/cms into a new package, packages/plugin-wordpress (@geekity/plugin-wordpress): the second Fedify federation for /wp-json/activitypub/1.0/, its request record and screen under Plugins, geekity import wordpress-actor, and the user to WordPress-number map, all in the plugin's data folder. Core gained only what those need: host.data, a federation middleware phase with the site KV and canonical documents and inbox handlers passed as plain data, host.screen and host.command; the setting, the user field, the CLI command and the Federation > Settings section left core. Verified with pnpm build, test, typecheck, lint, format:check, test:11ty, fed:smoke (core and plugin), the pack-install smoke and the Docker smoke. AC #9 stays open until the commit carries the BREAKING CHANGE footer; the README half is done.
<!-- SECTION:FINAL_SUMMARY:END -->
