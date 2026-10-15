# Changelog

## [0.3.0](https://github.com/geekitycom/cms/compare/plugin-llm-v0.2.2...plugin-llm-v0.3.0) (2026-10-15)


### ⚠ BREAKING CHANGES

* **cms:** a plugin names every file it keeps through host.data in a `data` field on its definition (kept, rebuildable or credential). host.data.read and update throw on an undeclared file, and PluginDataFolder.path is removed. The testing helper pluginDataFolder takes the plugin instead of its name.

### Features

* **cms:** plugins declare their data files, and an undeclared file is refused ([91319f1](https://github.com/geekitycom/cms/commit/91319f1c3a44487f93fceff23e057918dc9a942b))


### Bug Fixes

* **plugin-llm:** await the settings and target host api 2 ([d5a892f](https://github.com/geekitycom/cms/commit/d5a892ffa1362a9e7645b0db6af18ddbd6330742))
* **plugin-llm:** await the site info the host now returns as a promise ([0a836a6](https://github.com/geekitycom/cms/commit/0a836a6d40c5e357626483edc1e7bb4578e8e24d))

## [0.2.2](https://github.com/geekitycom/cms/compare/plugin-llm-v0.2.1...plugin-llm-v0.2.2) (2026-10-12)


### Bug Fixes

* **cms:** keep the site base path in email and reset links ([c27443c](https://github.com/geekitycom/cms/commit/c27443cdc2343537ba6c93ea57255ecc3b8059d1))

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
