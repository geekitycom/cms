# Changelog

## [0.7.0](https://github.com/geekitycom/cms/compare/plugin-wordpress-v0.6.1...plugin-wordpress-v0.7.0) (2026-10-20)


### Features

* **cms:** look up a review item from its ISBN, DOI or link ([29652f4](https://github.com/geekitycom/cms/commit/29652f4e07aedb75a34b9705c26fdffae413095a))
* **plugin-wordpress:** log refused deliveries at the compatibility inboxes ([933875c](https://github.com/geekitycom/cms/commit/933875c6406eb6190b4637fcae897ace2d3c03ad))

## [0.6.1](https://github.com/geekitycom/cms/compare/plugin-wordpress-v0.6.0...plugin-wordpress-v0.6.1) (2026-10-19)


### Bug Fixes

* **plugin-wordpress:** remove imported comments that left WordPress on a rerun ([4b8f36b](https://github.com/geekitycom/cms/commit/4b8f36be88e41ae8025c55ecbf4ebea477c45477))
* **plugin-wordpress:** sign follower fetches so authorized-fetch servers answer ([9ac1047](https://github.com/geekitycom/cms/commit/9ac1047f3c4d591735869719dedc53386a0f9f3a))

## [0.6.0](https://github.com/geekitycom/cms/compare/plugin-wordpress-v0.5.0...plugin-wordpress-v0.6.0) (2026-10-18)


### Features

* **cms:** add @geekity/cms/config so a site config loads without the whole CMS ([b61a063](https://github.com/geekitycom/cms/commit/b61a063a29a80dd51be7c5230c3df49f73aa582c))


### Bug Fixes

* **plugin-wordpress:** turn a Jetpack contact form into contact: true ([c06d552](https://github.com/geekitycom/cms/commit/c06d552b0544ef1eb86edd3ba78d506f787970e2))

## [0.5.0](https://github.com/geekitycom/cms/compare/plugin-wordpress-v0.4.0...plugin-wordpress-v0.5.0) (2026-10-15)


### ⚠ BREAKING CHANGES

* **cms:** a plugin names every file it keeps through host.data in a `data` field on its definition (kept, rebuildable or credential). host.data.read and update throw on an undeclared file, and PluginDataFolder.path is removed. The testing helper pluginDataFolder takes the plugin instead of its name.
* **cms:** PluginFederationContext.outbox(username) and .followers(username) return Promise<PluginCollection<…> | undefined>; await them before reading totalItems, firstCursor, lastCursor or a page.

### Features

* **cms:** a census test fails on any data file a site writes without a declaration ([1d853c2](https://github.com/geekitycom/cms/commit/1d853c21ab315b7a39f7c6264524e8e113d48dfd))
* **cms:** geekity export writes a tar.gz of the kept files with a manifest ([e992983](https://github.com/geekitycom/cms/commit/e992983afd73b6016871e957ff31755735c0acea))
* **cms:** geekity import restores an export and installs its plugins from npm ([3f158c3](https://github.com/geekitycom/cms/commit/3f158c3b018744282d8642423f58124bd6efea39))
* **cms:** plugins declare their data files, and an undeclared file is refused ([91319f1](https://github.com/geekitycom/cms/commit/91319f1c3a44487f93fceff23e057918dc9a942b))
* **cms:** return promises from the plugin federation outbox and followers ([02eeafc](https://github.com/geekitycom/cms/commit/02eeafcba58e588854375d244c1c6827342f417f))


### Bug Fixes

* **plugin-wordpress:** target host api 2 ([dc41cde](https://github.com/geekitycom/cms/commit/dc41cdeb85566971bae518cb9b25f9657eeb5972))

## [0.4.0](https://github.com/geekitycom/cms/compare/plugin-wordpress-v0.3.0...plugin-wordpress-v0.4.0) (2026-10-12)


### ⚠ BREAKING CHANGES

* **cms:** openAdminStore, intakeComment, addComment, updateComment, deleteComment, pluginSite, pluginDataFolder and documentContent, and the types OpenAdminStoreOptions, IntakeCommentOptions, CommentIntakeOutcome, CommentOrigin, ProposedComment and NewComment, are no longer exported from @geekity/cms. Tests that build a host import them from the new test-only entry @geekity/cms/testing.

### Features

* **cms:** add a test-only @geekity/cms/testing entry for building a host ([7e4ff28](https://github.com/geekitycom/cms/commit/7e4ff283e12c43feb4a4c0233c2091675c44c089))


### Bug Fixes

* **cms:** keep the site base path in email and reset links ([c27443c](https://github.com/geekitycom/cms/commit/c27443cdc2343537ba6c93ea57255ecc3b8059d1))
* **plugin-wordpress:** decode HTML entities in imported names and titles ([a808f36](https://github.com/geekitycom/cms/commit/a808f3645f78fa1a149b9d2bcd24f59a98ee5562))
* **plugin-wordpress:** slug, serialize and write imports through core helpers ([514a6ee](https://github.com/geekitycom/cms/commit/514a6ee6c3e63bf7a81bca9cad2dad0665d55529))

## [0.3.0](https://github.com/geekitycom/cms/compare/plugin-wordpress-v0.2.0...plugin-wordpress-v0.3.0) (2026-10-11)


### ⚠ BREAKING CHANGES

* **cms:** comment ids, anchors, /comment/ and /replies/ URLs are 16-hex keys, re-keyed at boot; openAdminStore no longer takes baseUrl, and ConversationReader.replyNamed returns the entry rather than its id.

### Features

* **cms:** give every comment and repliable item one 16-hex key ([047b78f](https://github.com/geekitycom/cms/commit/047b78f6dab1e9dcb020164f73ac8a5d94d31a61))
* **cms:** show a redelivered or backfilled copy of an imported fediverse comment once ([7d58df2](https://github.com/geekitycom/cms/commit/7d58df2d225adbac5020dca4eba3e55f78e51d1a))
* **plugin-wordpress:** attribute comments written signed in to the site user by login ([b9bf223](https://github.com/geekitycom/cms/commit/b9bf223149cb45045092efd75c12bf85e338e09d))
* **plugin-wordpress:** give imported fediverse comments their actor's avatar and id ([d7d75d4](https://github.com/geekitycom/cms/commit/d7d75d4dbd39a27d87c44ecec9bd53e0ac6b9f5c))
* **plugin-wordpress:** mark imported comments migrated and key them by their origin ([aa39239](https://github.com/geekitycom/cms/commit/aa3923953f214fd4a031ed369b565b26a2f1aa90))


### Bug Fixes

* **plugin-wordpress:** point the static front page's ?p= and ?page_id= redirects at / ([4e5bf46](https://github.com/geekitycom/cms/commit/4e5bf4697ba8792e21324b34a675745b12976786))

## [0.2.0](https://github.com/geekitycom/cms/compare/plugin-wordpress-v0.1.1...plugin-wordpress-v0.2.0) (2026-10-09)


### Features

* **plugin-wordpress:** import a wordpress export into the content directory ([811425d](https://github.com/geekitycom/cms/commit/811425dbb01a1738ca82424f84d6a3249ec588fc))
* **plugin-wordpress:** import wordpress comments, webmentions and fediverse reactions ([dc5efca](https://github.com/geekitycom/cms/commit/dc5efca2fa022e77f620ecda7ca05dbae9ad20dd))
* **plugin-wordpress:** import wordpress media to /uploads/ and redirect old media urls ([1e8b033](https://github.com/geekitycom/cms/commit/1e8b0338c2de377699111ea1cd18ed5706b6a43f))
* **plugin-wordpress:** import wordpress posts and pages with their urls, dates, terms and ids ([ff371e6](https://github.com/geekitycom/cms/commit/ff371e6016728f49f306fe756af6c8b44af93913))
* **plugin-wordpress:** redirect wordpress ?p=, ?page_id=, old slugs and attachment pages ([cba3915](https://github.com/geekitycom/cms/commit/cba39154a5f81d16c7043267ed3955f2853b1085))

## [0.1.1](https://github.com/geekitycom/cms/compare/plugin-wordpress-v0.1.0...plugin-wordpress-v0.1.1) (2026-10-09)


### Bug Fixes

* **plugin-wordpress:** accept any later 0.x core ([18511bd](https://github.com/geekitycom/cms/commit/18511bdc8d719f82d32cd713e51c408d1049baf5))

## 0.1.0 (2026-10-08)


### Features

* **plugin-wordpress:** serve the WordPress ActivityPub paths as a plugin ([4d069ac](https://github.com/geekitycom/cms/commit/4d069ac4dc7a56675c6bfac6b085d71d674f7663))


### Bug Fixes

* **cms:** keep a flash queued on a draining worker and make plugin route order irrelevant ([459aa01](https://github.com/geekitycom/cms/commit/459aa01693c43b93c840be86dd99d1bd4f6cdded))
