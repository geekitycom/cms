---
id: TASK-305
title: >-
  geekity plugin upgrade: bring every installed plugin up to its newest
  compatible version
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 01:53'
updated_date: '2026-10-09 02:24'
labels: []
dependencies: []
references:
  - packages/cms/src/plugins/install.ts
  - packages/cms/src/cli.ts
  - README.md
priority: medium
type: feature
ordinal: 265800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On Docker, plugins live in the mounted plugins folder and are updated one at a time with `geekity plugin add <package>`. Andrew asked for one command that goes through every installed plugin and looks for a newer version, like WordPress's plugin updates. It should install only versions this core and the other installed plugins can run, and leave the site to load the change on Reload as plugin add does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `geekity plugin upgrade` checks every plugin in the plugins folder against the registry and installs, for each, the newest version whose manifest this core and the installed plugins satisfy (host API and ranges), using the same verified install as plugin add
- [x] #2 It reports one line per plugin: upgraded from x to y, already newest, or held back with the reason (for example a newer version needs a newer core), and ends by saying to press Reload when anything changed
- [x] #3 `geekity plugin upgrade <package>...` limits it to the named plugins; `--check` (or a `geekity plugin outdated` command, pick one and document it) reports what would change and installs nothing
- [x] #4 A plugin that is not on the registry, or a registry that cannot be reached, is reported and skipped without stopping the others; the exit code is non-zero only when an install that was attempted failed
- [x] #5 Requirements between plugins are respected: when two plugins must move together (a consumer needs a newer plugin-llm), upgrading both in one run works, and upgrading only one never leaves an installed plugin unsatisfied without saying so
- [x] #6 Tests run against a local fake registry; the README Docker plugin section and the command table document it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Fake registry publishes each version's peerDependencies in the packument, as npm does (pluginFiles writes them into package.json).
2. install.ts exports fetchPackument; resolveRelease uses it.
3. New packages/cms/src/plugins/upgrade.ts: upgradePlugins({pluginsDir, registry, coreVersion, fixed, only, check}) returns a typed per-plugin result (upgraded / available / newest / held / skipped / failed) plus unmet requirement notes. Plan step is pure: candidates = released, non-prerelease, <= latest, newer than installed, core range satisfied by semver.satisfies; start every target at its newest and back off one step at a time on any plugin-to-plugin conflict (lower the provider when it is too new for a consumer, the consumer when it needs a newer provider), floor = installed. Installs go through addPlugin with the exact version, providers first; a consumer whose provider upgrade failed is held.
4. CLI: geekity plugin upgrade [<package>...] [--check]; one line per plugin, unmet notes, Reload line when anything changed; exit 1 only when an attempted install failed. --check chosen over a plugin outdated command (one command to learn).
5. Tests in cli-plugin-upgrade.test.ts against the fake registry for every AC; README Docker section and CLI usage; docker smoke runs plugin upgrade against its fake registry.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built packages/cms/src/plugins/upgrade.ts: upgradePlugins({pluginsDir, registry, coreVersion, configured, only, check}) returns {plugins: PluginUpgrade[], unmet}. PluginUpgrade statuses: upgraded, available (found by --check, not installed), newest, held (reason), skipped (reason), failed (reason). Candidates: released (no prerelease), <= dist-tags.latest, newer than installed, @geekity/cms range satisfied by this core (semver.satisfies against the packument peerDependencies). newestThatFit starts each plugin at its newest candidate and steps one release down while a plugin range is unmet: the required plugin when it is too new (semver.gtr), the requiring plugin otherwise; never below installed. Installs go through addPlugin with the exact version, required plugins first; a plugin whose required plugin failed is held. unmet is requirementNotes over every folder plugin after the run. install.ts exports fetchPackument (and names an unreachable registry); requirementNotes takes Pick<PluginManifest,'peerDependencies'>. CLI: geekity plugin upgrade [<package>...] [--check]; --check chosen over a plugin outdated command so there is one command to learn. Fake registry now publishes peerDependencies per version like npm. Docker smoke publishes plugin-hello 1.0.0 and 1.1.0, adds 1.0.0, upgrades to 1.1.0. deslop + no-comments run: comment-sicko removed new doc comments; accepted reshape flags (only undefined = all, settle renamed newestThatFit with named providerTooNew); rejected renaming 'available' since it is the update-available term TASK-306 renders.

Validation on the final tree: pnpm build, pnpm test (cms 4980+ pass, every package fail 0), typecheck, lint, format:check all pass; scripts/pack-install-smoke.sh passed; pnpm docker:smoke passed with the new ok geekity plugin upgrade step (upgraded 1.0.0 to 1.1.0 inside the container), no containers or images left behind. cli-plugin-upgrade.test.ts: 9 tests; the step-down direction and install order were mutation-checked (swapping either makes a test fail).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added geekity plugin upgrade [<package>...] [--check]. upgradePlugins in packages/cms/src/plugins/upgrade.ts picks, per folder plugin, the newest released version whose @geekity/cms range this core satisfies and whose plugin ranges fit the other installed plugins, moving required and requiring plugins together and holding one back with a reason when they cannot; it installs through addPlugin in dependency order and returns a typed per-plugin result (upgraded, available, newest, held, skipped, failed) plus unmet requirement notes, for the CLI now and the admin Plugins screen in TASK-306. Unreachable or missing registry entries are skipped; exit 1 only when an attempted install failed. Documented in the README Docker plugin section and the CLI help. Verified by cli-plugin-upgrade.test.ts against the fake registry, the full gates, pack-install smoke and docker smoke (which now upgrades a plugin in the container).
<!-- SECTION:FINAL_SUMMARY:END -->
