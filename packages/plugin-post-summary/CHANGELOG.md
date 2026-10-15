# Changelog

## [0.4.0](https://github.com/geekitycom/cms/compare/plugin-post-summary-v0.3.0...plugin-post-summary-v0.4.0) (2026-10-15)


### ⚠ BREAKING CHANGES

* **cms:** a plugin names every file it keeps through host.data in a `data` field on its definition (kept, rebuildable or credential). host.data.read and update throw on an undeclared file, and PluginDataFolder.path is removed. The testing helper pluginDataFolder takes the plugin instead of its name.

### Features

* **cms:** plugins declare their data files, and an undeclared file is refused ([91319f1](https://github.com/geekitycom/cms/commit/91319f1c3a44487f93fceff23e057918dc9a942b))


### Bug Fixes

* **plugin-post-summary:** target host api 2 ([686dac6](https://github.com/geekitycom/cms/commit/686dac6ce0aa059a8644836a2ba5d550905119ee))

## [0.3.0](https://github.com/geekitycom/cms/compare/plugin-post-summary-v0.2.1...plugin-post-summary-v0.3.0) (2026-10-09)


### Features

* **plugin-post-summary:** suggest three fresh titles without showing the current one ([768d10c](https://github.com/geekitycom/cms/commit/768d10c3d1787f3114ea97e30f469e98f26b29a2))

## [0.2.1](https://github.com/geekitycom/cms/compare/plugin-post-summary-v0.2.0...plugin-post-summary-v0.2.1) (2026-10-09)


### Bug Fixes

* **plugin-post-summary:** accept any later 0.x core ([3f968ef](https://github.com/geekitycom/cms/commit/3f968efd20c3a9ffc874fb6e53bf9114a2be512d))

## [0.2.0](https://github.com/geekitycom/cms/compare/plugin-post-summary-v0.1.0...plugin-post-summary-v0.2.0) (2026-10-09)


### Features

* **plugin-post-summary:** suggest short titles in the author's style ([183bfaa](https://github.com/geekitycom/cms/commit/183bfaaa9fbd44063d01766d8fbb42ffc4432d59))


### Bug Fixes

* **plugin-post-summary:** show the llm service's reason when a suggestion fails ([e24ee4f](https://github.com/geekitycom/cms/commit/e24ee4f7576e3cec16645ae58a0eeb4a1db067db))

## 0.1.0 (2026-10-08)


### Features

* **plugin-post-summary:** suggest a post's title and description from the llm service ([3aa1af9](https://github.com/geekitycom/cms/commit/3aa1af97ea0c1f0794cd3dd1abf65ad8cea2dfa7))
