# Changelog

## [0.5.0](https://github.com/geekitycom/cms/compare/plugin-tag-suggest-v0.4.0...plugin-tag-suggest-v0.5.0) (2026-10-20)


### Features

* **cms:** start a post by choosing its kind and show only that kind's fields ([eae19d6](https://github.com/geekitycom/cms/commit/eae19d6266199b2f29afa682af3d0d50f2ede9d7))

## [0.4.0](https://github.com/geekitycom/cms/compare/plugin-tag-suggest-v0.3.0...plugin-tag-suggest-v0.4.0) (2026-10-18)


### Features

* **cms:** add @geekity/cms/config so a site config loads without the whole CMS ([b61a063](https://github.com/geekitycom/cms/commit/b61a063a29a80dd51be7c5230c3df49f73aa582c))

## [0.3.0](https://github.com/geekitycom/cms/compare/plugin-tag-suggest-v0.2.2...plugin-tag-suggest-v0.3.0) (2026-10-15)


### ⚠ BREAKING CHANGES

* **cms:** a plugin names every file it keeps through host.data in a `data` field on its definition (kept, rebuildable or credential). host.data.read and update throw on an undeclared file, and PluginDataFolder.path is removed. The testing helper pluginDataFolder takes the plugin instead of its name.

### Features

* **cms:** plugins declare their data files, and an undeclared file is refused ([91319f1](https://github.com/geekitycom/cms/commit/91319f1c3a44487f93fceff23e057918dc9a942b))


### Bug Fixes

* **plugin-tag-suggest:** await the settings and target host api 2 ([d08d771](https://github.com/geekitycom/cms/commit/d08d771b79c47b58241b1a5bd1df024ea25ad0e2))
* **plugin-tag-suggest:** await the site info the host now returns as a promise ([f95571a](https://github.com/geekitycom/cms/commit/f95571a1b45036897e952023571e9064751c83c9))

## [0.2.2](https://github.com/geekitycom/cms/compare/plugin-tag-suggest-v0.2.1...plugin-tag-suggest-v0.2.2) (2026-10-12)


### Bug Fixes

* **cms:** keep the site base path in email and reset links ([c27443c](https://github.com/geekitycom/cms/commit/c27443cdc2343537ba6c93ea57255ecc3b8059d1))

## [0.2.1](https://github.com/geekitycom/cms/compare/plugin-tag-suggest-v0.2.0...plugin-tag-suggest-v0.2.1) (2026-10-09)


### Bug Fixes

* **plugin-tag-suggest:** accept any later 0.x core ([db2f04e](https://github.com/geekitycom/cms/commit/db2f04ea3ae6ee4171839114135729676da1f1d1))
* **plugin-tag-suggest:** offer reach tags in a readable spelling ([482642e](https://github.com/geekitycom/cms/commit/482642e8caac1a9bc95344dc1daf5629c8d43817))

## [0.2.0](https://github.com/geekitycom/cms/compare/plugin-tag-suggest-v0.1.0...plugin-tag-suggest-v0.2.0) (2026-10-09)


### Features

* **plugin-tag-suggest:** readable tags in two groups, for this post and for reach ([778dfe1](https://github.com/geekitycom/cms/commit/778dfe1b6ce9aaf2e85a50635b1d3325cf4b0578))


### Bug Fixes

* **plugin-tag-suggest:** show the llm service's reason when a suggestion fails ([6db94f9](https://github.com/geekitycom/cms/commit/6db94f9b05c53033faa214f674ce67c71323466b))

## 0.1.0 (2026-10-08)


### Features

* **plugin-tag-suggest:** suggest tags ranked by tags.pub followers ([de7aa0a](https://github.com/geekitycom/cms/commit/de7aa0a2908b310d42fd95222b5bd287a2b0ec40))
