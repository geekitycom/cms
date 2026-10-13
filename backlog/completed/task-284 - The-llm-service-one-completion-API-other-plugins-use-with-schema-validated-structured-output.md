---
id: TASK-284
title: >-
  The llm service: one completion API other plugins use, with schema-validated
  structured output
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 12:09'
updated_date: '2026-10-08 15:38'
labels:
  - plugins
  - llm
milestone: m-30
dependencies:
  - TASK-283
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - 'https://openrouter.ai/docs/features/structured-outputs'
  - 'https://openrouter.ai/docs/app-attribution'
priority: medium
type: feature
ordinal: 240800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). Core gains services between plugins: host.provide(service), which names the service for the providing plugin, and host.use(packageName), typed by a declaration map the provider package augments, and allowed only for names in the consumer requires list. @geekity/plugin-llm provides llm.complete({ messages, schema?, model?, maxTokens?, signal? }) over the OpenAI chat-completions shape, so OpenRouter, OpenAI and Ollama work by base URL. With a schema it asks for json_schema output (and provider.require_parameters on OpenRouter) and validates the reply itself; a schema validator, if needed, is a dependency of the llm package, never of core. It returns a Completion: ok with text or value, usage and the model that answered, or a typed error. Consumers never parse model output. The plugin screen shows the usage and outcome of the last call. A consumer package peer-depends on @geekity/plugin-llm for the service types and lists @geekity/plugin-llm in requires.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 host.use on a name missing from requires is a type error and refuses to register at boot; host.use returns the provider service typed without a cast
- [x] #2 complete with a schema returns a value that satisfies the schema, or ok:false with invalid-output when the model reply does not, including when the provider claimed strict support
- [x] #3 Each of 401, 402, 429 with Retry-After, 502/503, a timeout and a refused connection maps to its typed error, tested against a local fake server
- [x] #4 complete honours signal and a default timeout and default maxTokens set by the plugin
- [x] #5 HTTP-Referer and X-OpenRouter-Title carry the site base URL and title on OpenRouter
- [x] #6 The llm plugin screen shows the model, token usage and outcome of the last call; nothing about the prompt is stored
- [x] #7 A test plugin that requires @geekity/plugin-llm calls it end to end against the fake server, proving the service path a third party would use
- [x] #8 Core gains no dependency for the llm service; the llm package depends on nothing it does not use
- [x] #9 host.provide registers the one instance every consumer receives; host.use throws when called during register, so registration order never matters and a consumer only reaches a service once every plugin has registered
- [x] #10 A plugin provides at most one service, named by its package name; a second host.provide from the same plugin fails at boot naming the plugin
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core types (plugin.ts): an augmentable PluginServices declaration map; Plugin, PluginHost and definePlugin become generic over the package name and the requires record, so host.use accepts only names in requires and returns PluginServices[name] without a cast, and host.provide takes the service the map names for the plugin's own name. host.siteInfo() returns the site base URL and title, read now, which OpenRouter attribution needs.
2. Registry (registry.ts): provide is allowed once, during register; a second call fails register naming the plugin. use refuses a name outside requires (so calling it in register fails the boot with that reason), throws until every plugin has registered, and hands every consumer the one provided instance. Update the host-keys test. site.ts supplies siteInfo from the config base URL and site.json title.
3. Lint: consumers may import another plugin package only as types (@typescript-eslint/no-restricted-imports with allowTypeImports), so a bundle never inlines a second copy of a provider.
4. plugin-llm: complete({ messages, schema, model, maxTokens, signal }) on chatCompletion, returning Completion (ok with text or value, usage, model; or a typed LlmFailure). Add invalid-output, timeout, aborted and rejected (400/404/422: the provider refused the request as asked, such as an unknown model or a model without structured output; retrying will not help). With a schema send response_format json_schema strict, plus provider.require_parameters on OpenRouter, and validate the reply with @cfworker/json-schema (a dependency of plugin-llm only). Default timeout and max_tokens are the plugin's constants. HTTP-Referer and X-OpenRouter-Title carry siteInfo on OpenRouter. The plugin provides { complete } and augments PluginServices for @geekity/plugin-llm. Test connection goes through complete.
5. Last call: data/plugins/@geekity/plugin-llm/last-call.json keeps when, model, usage and outcome, never the prompt; the screen shows it.
6. Tests first per AC: core registry tests (type error via ts-expect-error, boot refusal, use during register, one instance, second provide), plugin-llm complete tests against the loopback fake (each failure kind, timeout, abort, schema valid/invalid, attribution, defaults), screen last-call test, and an end-to-end consumer plugin that requires @geekity/plugin-llm.
7. Docs: plugin-llm README, core README plugin authors section, doc-1 Plugins section. Verify with build, test, typecheck, lint, format:check and pack-install-smoke.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Core: plugin.ts gains PluginServices (an empty interface providers augment), PluginService<Name>, PluginSiteInfo, and host.provide / host.use / host.siteInfo. Plugin, PluginHost and definePlugin are generic over name and requires; definePlugin returns Plugin<NoInfer<Name>, NoInfer<Requires>> because without NoInfer a call inside plugins: [...] infers requires from the array's wide type and use accepts any name (found by the ts-expect-error test going unused). HOST_API_VERSION stays 1 (unreleased). registry.ts: provide once during register (a second fails register naming the plugin); use checks requires first, then refuses until every plugin has registered, then returns the one instance; a register that fails provides nothing. Registry options gain siteInfo(), which site.ts reads lazily from config.baseUrl and site.json's title.
Lint: geekity/plugin-boundary now uses @typescript-eslint/no-restricted-imports and refuses a value import of @geekity/plugin-* (type imports allowed), so a consumer's bundle never inlines a second copy of a provider. Proved by linting a probe file with a value import (error) and a type import (clean).
AC#1 'refuses to register at boot': use cannot be reached at boot except from register, so a use on a name outside requires fails that register with 'X uses Y, which is not in its requires.' and throws the same at request time.
plugin-llm: complete.ts adds callModel/complete with json_schema strict output, provider.require_parameters on OpenRouter, validation with @cfworker/json-schema (2020-12, the only dependency, inlined in the bundle), a code-fence courtesy for non-strict providers, usage with cost when reported. Defaults are the plugin's constants: max_tokens 1024, timeout 60 s. Failure kinds added beyond decision-33's list: rejected (400/404/422, retrying will not help: unknown model, or no endpoint for the required parameters), timeout (with seconds) and aborted (caller's signal); these were separate because 'network' and 'unavailable' would tell a consumer to retry or check the base URL when neither helps. decision-33's list of kinds should gain them. HTTP-Referer and X-OpenRouter-Title go only to openrouter.ai. last-call.json in the plugin's data folder keeps time, model, usage, outcome kind and message, never prompt or reply; the screen draws it as a Last call table. Test connection goes through the same call and counts as the last call. testConnection and the chatCompletion re-export are gone (unreleased).
Validation: pnpm build && pnpm test (cms 4879, demo 32, plugin-llm 36, plugin-wordpress 36, all pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0; scripts/pack-install-smoke.sh passed (installs plugin-llm with its dependency against the packed core and type-checks the scratch site). Core package.json unchanged; the lockfile changes only under packages/plugin-llm.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Core gains services between plugins: host.provide (once, during register), host.use (typed by an augmentable PluginServices map, only for names in requires, only after every plugin has registered, one shared instance) and host.siteInfo; Plugin/PluginHost/definePlugin are generic over name and requires. A lint rule keeps imports of other plugin packages type-only. @geekity/plugin-llm provides complete({ messages, schema, model, maxTokens, signal }) returning a Completion with text or a schema-validated value, usage and model, or a typed failure (adds invalid-output, rejected, timeout, aborted). OpenRouter gets require_parameters and attribution headers. The screen shows the last call's model, tokens, cost and outcome, never the prompt. Verified by services.test.ts (core), complete/connection/service/screen/bundle tests in plugin-llm against a loopback fake, including a third-party consumer plugin end to end; full build, test, typecheck, lint, format:check and pack-install smoke pass.
<!-- SECTION:FINAL_SUMMARY:END -->
