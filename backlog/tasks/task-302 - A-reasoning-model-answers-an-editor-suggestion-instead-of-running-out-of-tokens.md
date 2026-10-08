---
id: TASK-302
title: >-
  A reasoning model answers an editor suggestion instead of running out of
  tokens
status: To Do
assignee: []
created_date: '2026-10-08 23:58'
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
- [ ] #1 A reply cut off at the token limit (finish_reason length, or empty content with the reply tokens at the cap) is reported as its own plain-words failure that names the limit and suggests the fix, not "It had no text"
- [ ] #2 By default a call asks a reasoning model to keep its reasoning short (OpenRouter's documented reasoning request field, checked against its docs), and a caller can override it; a model that does not reason is unaffected
- [ ] #3 Test connection and editor suggestions succeed against a fake OpenRouter that reasons until a small budget runs out unless told to keep reasoning short
- [ ] #4 The reply budget is large enough for a short structured answer after brief reasoning, and the default is documented
- [ ] #5 Post summary and Tag suggest show the failure's reason in the editor, not only a generic message, and share one wording with plugin-llm instead of keeping their own copies
- [ ] #6 The plugin-llm README recommends choosing a model with structured outputs and says what happens with openrouter/auto and reasoning models
<!-- AC:END -->
