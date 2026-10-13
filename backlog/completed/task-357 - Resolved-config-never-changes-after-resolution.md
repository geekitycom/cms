---
id: TASK-357
title: Resolved config never changes after resolution
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-12 00:28'
labels: []
milestone: m-34
dependencies:
  - TASK-356
type: chore
ordinal: 316800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
resolveConfig returns an object that createCms then mutates (resolved.baseUrl = effectiveBaseUrl(...), resolved.commentChecker ??= ...), so what a service sees depends on build order. createCms re-resolves config the CLI already resolved. config.ts repeats the env, config, default pattern about 25 times with near-copy resolvers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The resolved config is frozen; boot-time values come from an explicit step that returns a new config before any service is built
- [x] #2 createCms accepts an already resolved config without resolving it again
- [x] #3 Env-backed settings are declared in one table holding env name, kind and default, and one resolver per kind produces values and error messages
- [x] #4 Every existing env var and error message keeps its behaviour, shown by tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pin current behaviour first: a test recording every resolved default, every env error message and every config error message byte for byte (passes on the old config.ts).
2. config.ts: one ENV_SETTINGS table (field -> env name(s), kind, default) and one kind object per value kind (boolean, count, bytes, seconds, port, dir, optional dir, upload types, image widths, image formats, url) that reads the env text or the config value and words the errors. resolveConfig spreads the table's results and adds the non-env fields.
3. resolveConfig returns a frozen ResolvedConfig (readonly fields, its own arrays frozen too) carrying an enumerable symbol brand; isResolvedConfig() tells it from a raw GeekityConfig.
4. cms/boot.ts: boot takes a raw or resolved config, resolves only a raw one, and a named step (settleConfig) returns a new frozen config with the effective baseUrl and the Akismet checker before the plugin registry and services are built. No mutation.
5. createCms(config: GeekityConfig | ResolvedConfig): a resolved config is used as is. CLI: one helper resolves the loaded config (with any command overrides applied before resolution, so env precedence is unchanged) and every command passes the resolved config to createCms.
6. Test that every env var in the table appears in docs/configuration.md.
7. Verify: pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pinned first: config.test.ts 'what the environment and config may say' records every resolved default, every env error message (27 variables) and every config error message byte for byte, plus GEEKITY_PORT='' hiding PORT and empty values counting as unset; it passed on the old config.ts before the rewrite and passes after.
Table: ENV_SETTINGS in config.ts maps each field to its variable(s), a kind (BOOLEAN, PORT, COUNT, BYTES, SECONDS, DIRECTORY, OPTIONAL_DIRECTORY, URL_KIND, UPLOAD_TYPES, IMAGE_WIDTHS, IMAGE_FORMATS) and default; resolveEnvSettings is the one loop. ENV_VARIABLES is derived from it; a test checks each is in docs/configuration.md.
Freezing: resolveConfig returns Object.freeze'd config; the lists and securityHeaders it builds are frozen too. User-supplied objects (mail, indexNow, federation, plugins) are not frozen: they are the site's, and nothing mutates them (grep found the only mutations were the two in boot.ts). Tests that mutated a config: none, so none needed rewriting.
Brand: an enumerable symbol RESOLVED on the resolved config; isResolvedConfig() checks it. Enumerable so a spread copy ({ ...resolved, watch: false }) stays a resolved config rather than being silently re-resolved (which would lose baseUrlSource).
Boot: boot() resolves only a raw config, then settleConfig() returns a new frozen config with the effective baseUrl and the Akismet checker, after migrateSettingsToFile and before the plugin registry and services. The registry is now built after the cache opens (it needs the settled baseUrl), so a refused registry closes both stores before rethrowing. The content store still opens with the pre-settings baseUrl, as before.
CLI: loadResolvedConfig(configPath, adjust?) loads and resolves once; adjust edits the raw config before resolution so env precedence is unchanged (sync/rebuild watch:false, resend queue:null, serve accessLog default true). Every command now passes the resolved config to createCms; rebuild no longer resolves twice.
One ordering nuance: securityHeaders is now checked after every env setting, so a config with both a bad header and a bad env value reports the env one first. Single errors are unchanged.
Validation: pnpm build, pnpm test (cms 5581 pass, all packages pass), pnpm typecheck, pnpm lint, pnpm format:check all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
resolveConfig now returns a frozen, branded ResolvedConfig built from one env table (ENV_SETTINGS: variable, kind, default) with one resolver per kind. boot() resolves only a raw config and a settleConfig step returns a new frozen config with the effective baseUrl and Akismet checker before the plugin registry and services are built; nothing mutates config. createCms accepts GeekityConfig | ResolvedConfig and uses a resolved one as is; the CLI resolves once via loadResolvedConfig and passes the result. Verified by pinning tests for every default and error message (written against the old code first), cms/boot.test.ts (resolved config keeps baseUrlSource 'environment' through createCms, boot config is new and frozen, resolved left alone), a docs coverage test for every env variable, and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
