# Changelog

## [0.2.1](https://github.com/geekitycom/cms/compare/plugin-llm-v0.2.0...plugin-llm-v0.2.1) (2026-10-09)


### Bug Fixes

* **plugin-llm:** accept any later 0.x core ([8121838](https://github.com/geekitycom/cms/commit/81218384196d972964b568681891888a0f6ef7fa))

## [0.2.0](https://github.com/geekitycom/cms/compare/plugin-llm-v0.1.0...plugin-llm-v0.2.0) (2026-10-09)


### ⚠ BREAKING CHANGES

* **plugin-llm:** LlmFailure gains the cut-off kind, a failed completion carries message, and describeFailure and LlmConnection are no longer exported. A consumer shows completion.message instead of its own words.

### Features

* **plugin-llm:** ask reasoning models for brief reasoning and report replies cut off at the limit ([a8eebd7](https://github.com/geekitycom/cms/commit/a8eebd7cb56e8d3d3361a188aed26017c86be74f))

## 0.1.0 (2026-10-08)


### Features

* **plugin-llm:** connect to an OpenAI-compatible provider with a connection check ([08ff57b](https://github.com/geekitycom/cms/commit/08ff57b5bbd41e3ca17c366bc53b0ad92fd3ddcb))
* **plugin-llm:** provide a completion service with schema-checked output and show the last call ([57badb2](https://github.com/geekitycom/cms/commit/57badb212315e17bd064ce447fa61a745982f5ce))
