---
id: TASK-284
title: >-
  The llm service: one completion API other plugins use, with schema-validated
  structured output
status: To Do
assignee: []
created_date: '2026-10-06 12:09'
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
M31 (decision-33). Core gains services between plugins: `host.provide(name, service)` and `host.use(name)`, typed by a declaration map the provider augments, and allowed only for names in the consumer requires list. The llm plugin provides `llm.complete({ messages, schema?, model?, maxTokens?, signal? })` over the OpenAI chat-completions shape, so OpenRouter, OpenAI and Ollama work by base URL. With a schema it asks for json_schema output (and provider.require_parameters on OpenRouter) and validates the reply itself. It returns a Completion: ok with text or value, usage and the model that answered, or a typed error. Consumers never parse model output. The plugin screen shows the usage and outcome of the last call.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 host.use on a name missing from requires is a type error and refuses to register at boot; host.use returns the provider service typed without a cast
- [ ] #2 complete with a schema returns a value that satisfies the schema, or ok:false with invalid-output when the model reply does not, including when the provider claimed strict support
- [ ] #3 Each of 401, 402, 429 with Retry-After, 502/503, a timeout and a refused connection maps to its typed error, tested against a local fake server
- [ ] #4 complete honours signal and a default timeout and default maxTokens set by the plugin
- [ ] #5 HTTP-Referer and X-OpenRouter-Title carry the site base URL and title on OpenRouter
- [ ] #6 The llm plugin screen shows the model, token usage and outcome of the last call; nothing about the prompt is stored
- [ ] #7 A test plugin that requires llm calls it end to end against the fake server, proving the service path a third party would use
<!-- AC:END -->
