---
id: TASK-302
title: >-
  A reasoning model answers an editor suggestion instead of running out of
  tokens
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 23:58'
updated_date: '2026-10-09 14:17'
labels: []
dependencies: []
references:
  - packages/plugin-llm/src/complete.ts
  - packages/plugin-llm/src/connection.ts
  - packages/plugin-post-summary/src/index.ts
  - packages/plugin-tag-suggest/src/index.ts
priority: high
type: bug
ordinal: 262800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On shll.me (0.25.0, plugin-llm 0.1.0) with the default model openrouter/auto, Suggest title failed with "The model’s answer was not usable": the Last call row showed z-ai/glm-5.3-flash, 1024 reply tokens and "It had no text". A reasoning model spent the whole default budget (DEFAULT_MAX_TOKENS 1024) thinking and never wrote the answer. qwen/qwen3.8-flash failed the same way even on Test connection. openai/gpt-4.1-mini, which does not reason, works. The editor also showed only post-summary's generic words, not the reason, so the owner had to find it on Plugins > LLM.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A reply cut off at the token limit (finish_reason length, or empty content with the reply tokens at the cap) is reported as its own plain-words failure that names the limit and suggests the fix, not "It had no text"
- [x] #2 By default a call asks a reasoning model to keep its reasoning short (OpenRouter's documented reasoning request field, checked against its docs), and a caller can override it; a model that does not reason is unaffected
- [x] #3 Test connection and editor suggestions succeed against a fake OpenRouter that reasons until a small budget runs out unless told to keep reasoning short
- [x] #4 The reply budget is large enough for a short structured answer after brief reasoning, and the default is documented
- [x] #5 Post summary and Tag suggest show the failure's reason in the editor, not only a generic message, and share one wording with plugin-llm instead of keeping their own copies
- [x] #6 The plugin-llm README recommends choosing a model with structured outputs and says what happens with openrouter/auto and reasoning models
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. plugin-llm connection.ts: add LlmFailure kind 'cut-off' { maxTokens, reasoningTokens }; describeFailure words that also say where to fix it (Plugins > LLM), so one wording serves the screen and the editor.
2. plugin-llm complete.ts: detect finish_reason 'length', or empty content with completion tokens at the cap, as cut-off. Completion failures carry message (describeFailure) beside error. describeFailure leaves the public exports.
3. plugin-llm catalog.ts: OpenRouter's public model list (GET {baseUrl}/models, no key, cached an hour per plugin instance) says which models take the reasoning parameter and which efforts they support. Only those get reasoning { effort, exclude: true }; a model without it gets the request it got before, because provider.require_parameters would otherwise route it nowhere. Other base URLs get no reasoning field.
4. LlmRequest.reasoning: ReasoningEffort | 'model-default', default 'low', mapped to the nearest effort the model lists. DEFAULT_MAX_TOKENS 1024 -> 4096. Test connection drops maxTokens 16 and uses the same path.
5. Test fake: extend plugin-llm/test/provider.ts with a /models catalog, answers computed from the request, a thinker() that reasons until max_tokens runs out unless asked for low effort, and standInForOpenRouter() that sends https://openrouter.ai requests to the fake. post-summary and tag-suggest import it instead of keeping copies.
6. post-summary and tag-suggest: drop failureWords, show completion.message; requires ^0.2.0.
7. README: reasoning field, cut-off, default budget, model advice (structured outputs, no default reasoning, openrouter/auto).
8. Verify: build, test, typecheck, lint, format:check, pack-install smoke.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Research (2026-10-08, WebFetch and the public model list; no key, no completion call):
- https://openrouter.ai/docs/use-cases/reasoning-tokens: request field reasoning { effort: max|xhigh|high|medium|low|minimal|none, max_tokens, exclude (default false), enabled }; effort OR max_tokens, not both. For budget-only models effort maps to a share of max_tokens: minimal ~10%, low ~20%, medium ~50%, high ~80%. max_tokens covers reasoning plus visible output on most providers; if reasoning uses it all the response has finish_reason 'length' and empty content. Reasoning text comes back in message.reasoning / reasoning_details; exclude:true still bills it. Models with reasoning.mandatory reject effort 'none'.
- https://openrouter.ai/docs/api-reference/overview: finish_reason normalized to tool_calls|stop|length|content_filter|error; raw value in native_finish_reason; usage.completion_tokens_details.reasoning_tokens.
- https://openrouter.ai/docs/features/provider-routing: require_parameters routes only to providers that support all parameters in the request; without it unknown parameters are ignored.
- https://openrouter.ai/api/v1/models (public): z-ai/glm-5.3-flash reasoning { mandatory: true, default_effort: max, supported_efforts: [max, high, low] }; qwen/qwen3.8-flash { default_enabled: true, supports_max_tokens: true }; openai/gpt-4.1-mini has no 'reasoning' in supported_parameters, nor do its endpoints (https://openrouter.ai/api/v1/models/openai/gpt-4.1-mini/endpoints). 'low' is missing from ~30 of 198 models that list efforts.
Decisions:
- Because a schema call sends provider.require_parameters (decision-33), sending reasoning to gpt-4.1-mini could route it nowhere (inferred, not observed). So the plugin reads the public model list (GET {baseUrl}/models, no key, kept an hour per plugin instance, 10 s timeout) and sends reasoning only to models whose supported_parameters include it. A failed read sends no reasoning, as before.
- Default effort 'low' (not 'minimal', which glm-5.3-flash does not list), mapped to the nearest listed effort above it, so a mandatory model never gets 'none'. exclude: true since no consumer reads the reasoning text. reasoning: 'model-default' sends nothing.
- DEFAULT_MAX_TOKENS 1024 -> 4096: at low effort a budget-only model reasons in ~800 and the answer has thousands left. Test connection drops maxTokens 16 and uses the default path.
- Other base URLs get no reasoning field: OpenAI refuses unknown or unsupported request fields (reasoning_effort on a non-reasoning model), and Ollama names it differently. The cut-off failure still explains a reasoning model there.
- Completion failures carry message (describeFailure), which now also says where to fix it, so post-summary and tag-suggest drop their failureWords copies. describeFailure and LlmConnection leave the public exports; LlmFailure gains cut-off. Breaking for consumers (exhaustive switches, removed export) -> feat!, 0.2.0 pre-1.0; consumers require ^0.2.0.
- The fake provider lives once in plugin-llm/test/provider.ts (thinker(), /models catalog, standInForOpenRouter() that redirects https://openrouter.ai/api/v1 to loopback); the consumers import it.
Verification: pnpm build, pnpm test (llm 48, post-summary 15, tag-suggest 16, cms 4963, all pass), pnpm typecheck, pnpm lint, pnpm format:check, scripts/pack-install-smoke.sh (wording check updated) pass. Mutations: putting maxTokens 16 back on Test connection, or dropping the reasoning field, fails the new tests.

AC evidence: #1 complete.test 'a reply cut off at the limit' (finish_reason length; empty content at the cap with reasoning tokens), screen.test cut-off flash and Last call 4096. #2 complete.test 'reasoning' (low by default, override high/minimal/none mapped, model-default sends nothing, plain model gets the same keys as before, non-OpenRouter gets nothing and reads no list); request shape from the OpenRouter reasoning-tokens doc. #3 screen.test Test connection and post-summary/tag-suggest 'reasoning model on OpenRouter' tests against thinker() through standInForOpenRouter. #5 post-summary and tag-suggest show completion.message (cut-off words in both editor tests); failureWords copies deleted. #6 README 'Choosing a model' and 'Reasoning models'.
AC #4 left unchecked: the default (4096) is documented and a fake that reasons 300 or half the budget answers within it, but whether z-ai/glm-5.3-flash at effort low and qwen/qwen3.8-flash (low = ~20% of max_tokens) answer within 4096 can only be seen on a real OpenRouter call. Confirm on shll.me after release: with openrouter/auto and with each of those models set as Default model, press Test connection and Suggest title; Last call should show the model, reply tokens well under 4096, and Answered.

2026-10-09, on shll.me (0.27.0, plugin-llm 0.2.1): with the default model z-ai/glm-5.3-flash (the model that spent all 1024 tokens reasoning before), Test connection passed and Suggest title answered within a couple of seconds with no cut-off. qwen/qwen3.8-flash not retried. The answer echoed the post's current title, a post-summary prompt issue filed as TASK-310.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
On OpenRouter a reasoning model is asked for low effort with its reasoning left out, the default budget is 4096 tokens, Test connection makes the same call as a suggestion, a reply cut off at the limit is its own failure with plain words, and the editor shows the llm service's message. Verified by tests against a reasoning fake and on shll.me with z-ai/glm-5.3-flash.
<!-- SECTION:FINAL_SUMMARY:END -->
