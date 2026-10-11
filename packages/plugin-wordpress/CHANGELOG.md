# Changelog

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
