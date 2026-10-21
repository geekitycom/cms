# Changelog

## [0.39.0](https://github.com/geekitycom/cms/compare/v0.38.0...v0.39.0) (2026-10-21)


### Features

* **cms:** let each user arrange their dashboard cards ([6172377](https://github.com/geekitycom/cms/commit/6172377089366b6b21d87484f3ba46a91c523d2e))
* **cms:** list an archive page's posts in its markdown ([adc86a6](https://github.com/geekitycom/cms/commit/adc86a6b9ee568ac3d0777f8f7be83151473f627))

## [0.38.0](https://github.com/geekitycom/cms/compare/v0.37.0...v0.38.0) (2026-10-21)


### Features

* **cms:** give add plugin its own page under plugins ([8b20900](https://github.com/geekitycom/cms/commit/8b209000c50e31293521f01f291897cd0ee8b359))


### Bug Fixes

* **cms:** space admin card actions from the last field ([b04313f](https://github.com/geekitycom/cms/commit/b04313f8fc7e3cfa2d4ff841a08da03019b35c13))
* **cms:** version admin asset URLs so an upgrade loads fresh CSS and JS ([8247ea1](https://github.com/geekitycom/cms/commit/8247ea1aabf609ddda8ba896bfa4133a2a31f853))

## [0.37.0](https://github.com/geekitycom/cms/compare/v0.36.1...v0.37.0) (2026-10-21)


### Features

* **cms:** chart fediverse likes, boosts and replies per day on the dashboard ([022e966](https://github.com/geekitycom/cms/commit/022e9667cf692b11eafbd58997ac3379c86f96b2))
* **cms:** chart posting activity over the year on the dashboard ([2235dde](https://github.com/geekitycom/cms/commit/2235ddec9e22e7a085a0f1fe0a3c0a9523ce732b))
* **cms:** draw stats, time series, ranked lists and calendars as server-rendered blocks ([68e40cb](https://github.com/geekitycom/cms/commit/68e40cb2dfd2792bc94cd8c8d8b579725761cb6b))
* **cms:** drop the recent posts card from the dashboard ([f1a970e](https://github.com/geekitycom/cms/commit/f1a970e616df6a7896b068042feaa22ab4647dd8))
* **cms:** fill the media library with alt text a post gives an upload ([ddf1966](https://github.com/geekitycom/cms/commit/ddf19669c1768c6d4b77f1f4e51fae4f1042e976))
* **cms:** format a dashboard stat as a percent or a duration ([89b9ead](https://github.com/geekitycom/cms/commit/89b9eadc3c5b8fa499a581e5699936a42fdcbbf4))
* **cms:** format the values of a ranked list ([919e09d](https://github.com/geekitycom/cms/commit/919e09d5188b1f214f5906d75c4814fd5986ca65))
* **cms:** hand dashboard widgets a signal that aborts at the time limit ([e52df21](https://github.com/geekitycom/cms/commit/e52df21dab28a19ec488c24f9853306f3b6060fa))
* **cms:** let host.fetch post a JSON body ([c6ace8e](https://github.com/geekitycom/cms/commit/c6ace8e3c092f25a02846bf6ad00c9f0f880d078))
* **cms:** let plugins add script, link and meta tags to every public page ([c908d13](https://github.com/geekitycom/cms/commit/c908d13328d60b46841f09af4d5776ebb1bab0ba))
* **cms:** let plugins and the core add widgets to the dashboard ([d3947f5](https://github.com/geekitycom/cms/commit/d3947f56de508adb2c52f6486eae4ddb5d10258e))
* **cms:** let plugins list the posts published since a time ([07f987f](https://github.com/geekitycom/cms/commit/07f987f601b0e6556c25c8a1f8695bda5ffafaa8))
* **cms:** let plugins look up the post at a path ([7d626f9](https://github.com/geekitycom/cms/commit/7d626f9e0ba918c5ed4726c0f1e25f5c6ed49e5f))
* **cms:** list recent interactions on the dashboard ([6fdc560](https://github.com/geekitycom/cms/commit/6fdc560685e538f24519c8eaaf26b337d250b85d))
* **cms:** list scheduled posts on the dashboard ([5571731](https://github.com/geekitycom/cms/commit/5571731938870cc6cd0db1ad6c82908d8ce993c0))
* **cms:** rank posts by engagement on the dashboard and offer per-post totals to plugins ([3b37422](https://github.com/geekitycom/cms/commit/3b374221a180841965b00cbb6b988849d58fb211))
* **cms:** record follower changes and chart followers on the dashboard ([c707988](https://github.com/geekitycom/cms/commit/c7079886806383db1616ef18354d1d8ab4398fcb))
* **cms:** tell plugin page tags whether the reader is signed in and the site is in dev mode ([729c265](https://github.com/geekitycom/cms/commit/729c2653fd2fe1c1a4113c297815b95df26cac02))
* **cms:** warn on the dashboard when jobs, deliveries or webmentions fail ([a3c9e04](https://github.com/geekitycom/cms/commit/a3c9e041fad8c57274d51cdacd18ed9899aa4bcc))
* **plugin-umami:** add the umami tracker to every public page ([1ce8dd6](https://github.com/geekitycom/cms/commit/1ce8dd677f4db5410d4633c177f17ae893745a1b))


### Bug Fixes

* **cms:** fit the calendar block to its card and open it on the newest weeks ([abf4cf2](https://github.com/geekitycom/cms/commit/abf4cf2f803e5d9058a33c0dc9930be393060cff))
* **cms:** keep a plugin's credentials off a cross-origin redirect ([3e62d4c](https://github.com/geekitycom/cms/commit/3e62d4c7d4006c7a26853e3437b73270a39894b1))
* **cms:** let stats blocks wrap on narrow cards instead of scrolling sideways ([3166264](https://github.com/geekitycom/cms/commit/316626443bdc435c760e7e3bf32017a83526ae09))
* **cms:** summarise a photo-only post by its alt text in the feeds ([6d7856e](https://github.com/geekitycom/cms/commit/6d7856e781c40a97fb317966575bb7bae5b51a7f))

## [0.36.1](https://github.com/geekitycom/cms/compare/v0.36.0...v0.36.1) (2026-10-20)


### Bug Fixes

* **cms:** name the repository so npm can verify provenance ([7a2eedc](https://github.com/geekitycom/cms/commit/7a2eedcc0fe56fd187fa9a95b0cf2e496e39aaed))

## [0.36.0](https://github.com/geekitycom/cms/compare/v0.35.0...v0.36.0) (2026-10-20)


### Features

* **cms:** let an upload ask to be refused unless it is an image ([3c480aa](https://github.com/geekitycom/cms/commit/3c480aa0edaf9a9d2aa742b1105b7806b9eb583a))
* **cms:** upload by button or drop wherever the admin asks for a file ([1c110ce](https://github.com/geekitycom/cms/commit/1c110ce9a8bc8491cb4cf33c3af585e504ca813c))


### Bug Fixes

* **cms:** count front matter, settings and profiles as uses of an upload ([5d31369](https://github.com/geekitycom/cms/commit/5d31369b999ba2d1fc042220ba0b257a0085dda9))
* **cms:** refresh a running job's status box until the job ends ([5c363b2](https://github.com/geekitycom/cms/commit/5c363b29765e4cb3448a65400c0bb8addd3cf407))

## [0.35.0](https://github.com/geekitycom/cms/compare/v0.34.0...v0.35.0) (2026-10-20)


### ⚠ BREAKING CHANGES

* **cms:** read-of and read-status are no longer understood. There is no read post type, editor section, read line or q=config entry, and the template context loses read and excerpt (listings use summary).
* **plugin-post-summary:** offersDescription is no longer exported.

### Features

* **cms:** add review posts with an item and a rating ([89a7606](https://github.com/geekitycom/cms/commit/89a76063a130efdfea66a088c1e6896795303d4a))
* **cms:** find a review item by searching its title ([f612a98](https://github.com/geekitycom/cms/commit/f612a98eee03ed1063bacd233d54fb90d244099c))
* **cms:** log inbox deliveries refused for their signature ([21b2ce9](https://github.com/geekitycom/cms/commit/21b2ce99e1a0cb7c5a0b11fbc13d5b0149a4f839))
* **cms:** look up a review item from its ISBN, DOI or link ([29652f4](https://github.com/geekitycom/cms/commit/29652f4e07aedb75a34b9705c26fdffae413095a))
* **cms:** remove read posts ([e4de744](https://github.com/geekitycom/cms/commit/e4de74401ec3459f3a58246b70dde692921c7a50))
* **cms:** show the media library as a grid with a details screen per file ([cef1eba](https://github.com/geekitycom/cms/commit/cef1ebaba946203271a1419ce1723467367ce150))
* **cms:** start a post by choosing its kind and show only that kind's fields ([eae19d6](https://github.com/geekitycom/cms/commit/eae19d6266199b2f29afa682af3d0d50f2ede9d7))
* **plugin-post-summary:** offer suggest description on every post type ([8ebf586](https://github.com/geekitycom/cms/commit/8ebf5863983940e8d35a2c8d34894ea87eadd7fe))


### Bug Fixes

* **cms:** show follower avatars in the admin through the avatar cache ([6ff9dcd](https://github.com/geekitycom/cms/commit/6ff9dcdfa9217fc5d950184ce9f73f885707ea3b))

## [0.34.0](https://github.com/geekitycom/cms/compare/v0.33.0...v0.34.0) (2026-10-19)


### Features

* **cms:** let a plugin remove a comment by id ([2ec5f76](https://github.com/geekitycom/cms/commit/2ec5f76594668800f6d0e6740b4a85e82edfb778))

## [0.33.0](https://github.com/geekitycom/cms/compare/v0.32.1...v0.33.0) (2026-10-18)


### Features

* **cms:** add @geekity/cms/config so a site config loads without the whole CMS ([b61a063](https://github.com/geekitycom/cms/commit/b61a063a29a80dd51be7c5230c3df49f73aa582c))
* **cms:** attach a read post's uploaded cover when it federates ([9aafc74](https://github.com/geekitycom/cms/commit/9aafc7445156e9db7a965dc763e4b5c7f6dcf8ca))


### Bug Fixes

* **cms:** even the gaps around a short breadcrumb link ([bcc2dca](https://github.com/geekitycom/cms/commit/bcc2dcad43e9c19232800903e38da4b337ab86d7))
* **cms:** keep watching a content file the CMS has replaced on Linux ([29e32c2](https://github.com/geekitycom/cms/commit/29e32c2fe85cd32f50d52f2fe08e6cd47087ae8f))
* **cms:** report a config whose imports fail instead of ignoring it ([503e483](https://github.com/geekitycom/cms/commit/503e483c650bfb7827371eef653f8d28a4ce78c8))
* **cms:** report files in a new directory and watch existing ones before start ([c157715](https://github.com/geekitycom/cms/commit/c1577154e3a1480e2da9163969f930151b1f8648))


### Performance Improvements

* **cms:** start the geekity command without loading the whole CMS ([ccfe4ad](https://github.com/geekitycom/cms/commit/ccfe4adea1f628f97cc0fe3dcb7eb8ff5d0db16c))

## [0.32.1](https://github.com/geekitycom/cms/compare/v0.32.0...v0.32.1) (2026-10-15)


### Bug Fixes

* **cms:** federate a returning post under an object id it never deleted ([2302840](https://github.com/geekitycom/cms/commit/2302840921a3676f4261cb3fe600f82d5656e4bf))
* **cms:** list a titled read post's read line under its headline, as its page does ([ae223ce](https://github.com/geekitycom/cms/commit/ae223cea6cb7e513518d74d7ed95ba33f51c672b))
* **cms:** open a titled read post's Note with its title, as its page does ([bc9cd78](https://github.com/geekitycom/cms/commit/bc9cd78375152633a7f7d046906c03e141786d72))
* **cms:** use a post's current object id everywhere and backfill earlier deletes ([f1856c3](https://github.com/geekitycom/cms/commit/f1856c30adc708a62a169a96b2622c067bd23a3d))

## [0.32.0](https://github.com/geekitycom/cms/compare/v0.31.0...v0.32.0) (2026-10-15)


### ⚠ BREAKING CHANGES

* **cms:** a plugin names every file it keeps through host.data in a `data` field on its definition (kept, rebuildable or credential). host.data.read and update throw on an undeclared file, and PluginDataFolder.path is removed. The testing helper pluginDataFolder takes the plugin instead of its name.
* **cms:** PluginFederationContext.outbox(username) and .followers(username) return Promise<PluginCollection<…> | undefined>; await them before reading totalItems, firstCursor, lastCursor or a page.
* **cms:** settings.current() returns a Promise and HOST_API_VERSION is 2. Plugin settings move from site.json to data/plugins/<name>/ at boot.
* **cms:** host.siteInfo() returns a Promise. SiteSettings keys are snake_case and the three license fields are one license value; readSiteSettings is removed, read cms.settings.values(SITE) instead. ConversationReader methods take the site settings. RelayService.sync, FeedNotifier.feedsFor, IndexNowNotifier.urlsFor and MailService.from return promises. A site that builds its own CMS passes await settleConfig(config) to createCms.
* **cms:** MailService.configured() and providerName() return promises, and CommentNotifier gains settled().

### Features

* **cms:** a census test fails on any data file a site writes without a declaration ([1d853c2](https://github.com/geekitycom/cms/commit/1d853c21ab315b7a39f7c6264524e8e113d48dfd))
* **cms:** choose on Settings &gt; Discussion which document types take comments by default ([e84e774](https://github.com/geekitycom/cms/commit/e84e7742ca83ea736d829b06cb08ff12f063404d))
* **cms:** geekity export writes a tar.gz of the kept files with a manifest ([e992983](https://github.com/geekitycom/cms/commit/e992983afd73b6016871e957ff31755735c0acea))
* **cms:** geekity import restores an export and installs its plugins from npm ([3f158c3](https://github.com/geekitycom/cms/commit/3f158c3b018744282d8642423f58124bd6efea39))
* **cms:** give a read citation an optional book cover ([df8f1f1](https://github.com/geekitycom/cms/commit/df8f1f1a5d5fff8ebbcc0466844cb1156b3a2bdc))
* **cms:** keep federation messages in a SQLite queue under data/ ([2872231](https://github.com/geekitycom/cms/commit/2872231d69a353eda935eccf58c50a20df5debcf))
* **cms:** keep plugin settings in data/plugins/&lt;name&gt; on the settings registry ([f046118](https://github.com/geekitycom/cms/commit/f046118bf30e929e65e1da4a6d0e8f42c60dbcc0))
* **cms:** list, get and set plugin settings from geekity settings ([4a7cb23](https://github.com/geekitycom/cms/commit/4a7cb231fd4fbd309204c7642b890dfee465783f))
* **cms:** mail and Akismet credentials move onto the settings registry ([e2341f0](https://github.com/geekitycom/cms/commit/e2341f0178eca017920ee35ac77ba763ecadf1ce))
* **cms:** plugins declare their data files, and an undeclared file is refused ([91319f1](https://github.com/geekitycom/cms/commit/91319f1c3a44487f93fceff23e057918dc9a942b))
* **cms:** return promises from the plugin federation outbox and followers ([02eeafc](https://github.com/geekitycom/cms/commit/02eeafcba58e588854375d244c1c6827342f417f))
* **cms:** run admin jobs on an in-process queue with records in data/ ([9c26bab](https://github.com/geekitycom/cms/commit/9c26bab115362bd079cf42f254b54c188e704bd6))
* **cms:** run resends as a queued job from the federation screen ([88abd04](https://github.com/geekitycom/cms/commit/88abd04cc190edca2cc07d5db30f853c35f17655))
* **cms:** run strip-metadata as a queued job from the media screen ([68a1246](https://github.com/geekitycom/cms/commit/68a12465b6e71849683d02dc777d40c2b1d8ae68))
* **cms:** settings registry with maintenance and dev mode switches ([7a16fce](https://github.com/geekitycom/cms/commit/7a16fce05475e636b24f286adfcca494e5a99a59))
* **cms:** the site settings move onto the settings registry ([5e8ac71](https://github.com/geekitycom/cms/commit/5e8ac7176280735303d542b6edc329d60d4ad927))
* **cms:** tools &gt; export runs a site export as a job and offers the download ([cfc37b7](https://github.com/geekitycom/cms/commit/cfc37b7bc1e92ed0e3846e1cb3818033fef01260))


### Bug Fixes

* **cms:** answer 404 for a variant of an upload that is not an image ([2e67287](https://github.com/geekitycom/cms/commit/2e67287105a23c284b16b083a7be5f9206e4eb3b))
* **cms:** close the gaps the review found in site export and import ([b20c83b](https://github.com/geekitycom/cms/commit/b20c83b83717c2f7967d5055174e985b8224a175))
* **cms:** escape admin field labels and hints unless the caller marks them safe ([caa8be3](https://github.com/geekitycom/cms/commit/caa8be37bd34cbfdfb5cd4bb79c9805ae49acc8e))
* **cms:** give newestPosts entries an excerpt in the Eleventy example config ([1c53e16](https://github.com/geekitycom/cms/commit/1c53e16359fa48b9eac941d595a494cb0b713c8c))
* **cms:** leave a job a live process is running alone at start-up recovery ([41230d1](https://github.com/geekitycom/cms/commit/41230d1bccdb5ef7c161dcbd4724177fdd3b94de))
* **cms:** leave the export's own job and lost+found out of a site move ([7033ff0](https://github.com/geekitycom/cms/commit/7033ff071fd0722aa880b3cbc498c1b9370c05e1))
* **cms:** let a missing upload fall through to declared redirects ([8e7480a](https://github.com/geekitycom/cms/commit/8e7480aae3fe74c23314fb549169877e3cc8c26d))
* **cms:** list a titled read post by its headline and words, with the read line after them ([312c524](https://github.com/geekitycom/cms/commit/312c52424aaf1f9d00114c9306a8e6076973ba36))
* **cms:** migrate plugin settings before a plugin command and keep env secrets untrimmed ([8691bdd](https://github.com/geekitycom/cms/commit/8691bdd27292b62154c23c2bcbdf1c3cf4af464a))
* **cms:** mint the indexnow key at boot and warn when a term redirect is not saved ([57d46c3](https://github.com/geekitycom/cms/commit/57d46c34b07ae3f2d06caf52815a726e5e648aac))
* **cms:** name every file under content/ an export could not carry ([e716415](https://github.com/geekitycom/cms/commit/e7164157f0fae92ea5064e6ddf081870405bf2bf))
* **cms:** refuse a job command while the same job is active ([960167c](https://github.com/geekitycom/cms/commit/960167cb8ebc91c1c960884bcfbc93282c8deed5))
* **cms:** remove temp files a cut-off metadata sweep left in uploads ([d51d9ca](https://github.com/geekitycom/cms/commit/d51d9ca25358769af17cc8f90e7d9b415e8f805a))
* **cms:** run a job a dead or discarded worker left behind without a restart ([0148218](https://github.com/geekitycom/cms/commit/0148218b4d6b3cbdf442e0fcbeceab054dd23282))
* **cms:** say a web address where the editor accepts http and https ([d0b4482](https://github.com/geekitycom/cms/commit/d0b448298313c15ae70e345d100190efbf0539a5))
* **cms:** serve uploads with the type of their kind, so a PDF is application/pdf ([6b01f82](https://github.com/geekitycom/cms/commit/6b01f82c7e63d5c39ba1ccdddfcc20acfd1ba2ba))
* **cms:** stage an import inside content/ and data/ so it works on mount points ([0f50930](https://github.com/geekitycom/cms/commit/0f5093001e91bfcf859cd010338230348f8dd514))
* **cms:** wait for and stop a federation queue passed through config ([ca575fc](https://github.com/geekitycom/cms/commit/ca575fc705bf0bcfc49de199623d92fb625a644c))

## [0.31.0](https://github.com/geekitycom/cms/compare/v0.30.0...v0.31.0) (2026-10-12)


### ⚠ BREAKING CHANGES

* **cms:** openAdminStore, intakeComment, addComment, updateComment, deleteComment, pluginSite, pluginDataFolder and documentContent, and the types OpenAdminStoreOptions, IntakeCommentOptions, CommentIntakeOutcome, CommentOrigin, ProposedComment and NewComment, are no longer exported from @geekity/cms. Tests that build a host import them from the new test-only entry @geekity/cms/testing.
* **cms:** @geekity/cms now exports only the names listed in docs/public-api.md; 1,002 internal exports are gone. A site that imported a removed name should use the documented API (for example the services on the Cms object, or @geekity/cms/plugin for definePlugin and HOST_API_VERSION), or copy the helper into its own code.
* **cms:** AdminStore drops legacySettings, legacyActorKeys, legacyUsers and dropLegacyTable, and the migrate*ToFile(s) functions take (db, dir).
* **cms:** formFor takes the document kind as its first argument.
* **cms:** POST_KIND and PAGE_KIND no longer carry section, basePath or plural; those moved to POST_SCREENS and PAGE_SCREENS.
* **cms:** readCapped is no longer exported and discoverEndpoint takes a HostLookup argument.
* **cms:** Markdown representations add navigation front matter, a theme header and footer, and root-relative .md links in listings, and their front matter author is the display name with author_username beside it.

### Features

* **cms:** add a test-only @geekity/cms/testing entry for building a host ([7e4ff28](https://github.com/geekitycom/cms/commit/7e4ff283e12c43feb4a4c0233c2091675c44c089))
* **cms:** add cms.onSettled for when the content index settles ([646a0ec](https://github.com/geekitycom/cms/commit/646a0ec1f983032c2f615147388fcb14269f17e3))
* **cms:** export a deliberate public API from the package root ([b18d1f4](https://github.com/geekitycom/cms/commit/b18d1f45b8da883049b620bfae20e007ef770f93))
* **cms:** export content helpers from the plugin entry point ([9079ece](https://github.com/geekitycom/cms/commit/9079ece8b5570d6771e8a29a176f0ba8e0f30e5f))
* **cms:** give a page's Markdown its place in the site ([a391eab](https://github.com/geekitycom/cms/commit/a391eabd83d1ff5c1f192300a63331ebc9f20eb6))
* **cms:** let a page have no title ([d80c1bf](https://github.com/geekitycom/cms/commit/d80c1bf9587e1eddbeeaee78f28702f57a61421d))
* **cms:** list every published post and page in llms.txt ([a597c9b](https://github.com/geekitycom/cms/commit/a597c9b7314cb863fcb8423ec7e3dcc68aa5e9e4))
* **cms:** signals for the watcher debounce, the drain and the plugin supervisor ([cf477e3](https://github.com/geekitycom/cms/commit/cf477e3bced3a8f394950d22610213e876ae995a))
* **cms:** tell templates about dev mode and a signed-in reader ([296c2a9](https://github.com/geekitycom/cms/commit/296c2a919c9754e6b906559f1a1b49812bd6e60b))


### Bug Fixes

* **cms:** keep the site base path in email and reset links ([c27443c](https://github.com/geekitycom/cms/commit/c27443cdc2343537ba6c93ea57255ecc3b8059d1))
* **cms:** let the theme decide the bio on a static homepage's Markdown ([b6daf43](https://github.com/geekitycom/cms/commit/b6daf43e1ca8b292b2346f8ec9f1ed5d849f468c))
* **cms:** name GEEKITY_BASE_URL when its value is not a URL ([5692a4b](https://github.com/geekitycom/cms/commit/5692a4bba098048e65ed7e6146a477de4870ee1c))
* **cms:** read the public URL grammar once ([ab8ab58](https://github.com/geekitycom/cms/commit/ab8ab58a14bdc9d8bb65ddce17192a0117085298))
* **cms:** send webmention fetches through the public-address guard ([c32f012](https://github.com/geekitycom/cms/commit/c32f012dac9673f8266b4a600a49acc577b26706))
* **cms:** serve the homepage at / in its Markdown and JSON too ([3bbce98](https://github.com/geekitycom/cms/commit/3bbce98b30c9c3e2c74e2f03881b21fc12c041bc))
* **cms:** write each small helper once ([a54e074](https://github.com/geekitycom/cms/commit/a54e074f274371568a69a54af4ba030cf8e565e7))


### Code Refactoring

* **cms:** describe each post field once ([27bc5a2](https://github.com/geekitycom/cms/commit/27bc5a21c4b2e47857c3e0dc74fc585397a0fdad))
* **cms:** move the document write path from admin to content ([9c6a907](https://github.com/geekitycom/cms/commit/9c6a9072754b5d04072fcbcf470459448e9e8d2f))
* **cms:** split the admin store by domain ([8c6694c](https://github.com/geekitycom/cms/commit/8c6694c6bb98bf5f2aa93d3cf82d0d29334d4944))

## [0.30.0](https://github.com/geekitycom/cms/compare/v0.29.0...v0.30.0) (2026-10-11)


### ⚠ BREAKING CHANGES

* **cms:** comment ids, anchors, /comment/ and /replies/ URLs are 16-hex keys, re-keyed at boot; openAdminStore no longer takes baseUrl, and ConversationReader.replyNamed returns the entry rather than its id.

### Features

* **cms:** fold an imported like or boost with the same actor's later one by actor id ([c539ce1](https://github.com/geekitycom/cms/commit/c539ce18861870f9e812d67fd12f3d50265d0feb))
* **cms:** give every comment and repliable item one 16-hex key ([047b78f](https://github.com/geekitycom/cms/commit/047b78f6dab1e9dcb020164f73ac8a5d94d31a61))
* **cms:** keep migrated comments out of every feed and reply count ([784792a](https://github.com/geekitycom/cms/commit/784792a493065c6c116dbb756e27b50fdf179a43))
* **cms:** let plugins rename comments and key them by the site's rule ([9b979f6](https://github.com/geekitycom/cms/commit/9b979f6c0c95e0c54e5496ca03b517351f2a212e))
* **cms:** name the site user who wrote a comment and show it as theirs ([28e006e](https://github.com/geekitycom/cms/commit/28e006ea931e214fa706e7eb26a9e305529ff7af))
* **cms:** show a redelivered or backfilled copy of an imported fediverse comment once ([7d58df2](https://github.com/geekitycom/cms/commit/7d58df2d225adbac5020dca4eba3e55f78e51d1a))


### Bug Fixes

* **cms:** keep likes, boosts and reposts out of the comments and replies feeds ([223abe7](https://github.com/geekitycom/cms/commit/223abe745051fa107cfc455771869df923928e4f))
* **cms:** match term archive paths case-insensitively and fall through for unused terms ([50e23c4](https://github.com/geekitycom/cms/commit/50e23c43169eaba2e28db9e9db5adbba6c2fd83a))
* **cms:** name an imported fediverse comment by the handle its actor id implies ([1eb5f94](https://github.com/geekitycom/cms/commit/1eb5f94cbaafc51417d30fba96d7d763102654b1))

## [0.29.0](https://github.com/geekitycom/cms/compare/v0.28.0...v0.29.0) (2026-10-10)


### ⚠ BREAKING CHANGES

* **cms:** SubmitCommentOptions.author, the SignedInAuthor type and the intake's 'moderator' CommentOrigin are removed. A signed-in reply is written with writeReplyPost or submitReplyPost as a reply post.
* **cms:** FeedItemComments.count moved to FeedItemComments.replies.count, and the post feeds' source:comments now counts direct replies and points at /replies/{key}/, omitted when zero.
* **cms:** the front page context no longer carries recentPosts, and recentPosts, RECENT_POSTS, startOfMonth and RecentPostsSource are no longer exported. A site theme's front-page.njk calls newestPosts(count) instead, for example {% set posts = newestPosts(5) %}.

### Features

* **cms:** backfill fediverse replies to replies from their replies collections ([b109215](https://github.com/geekitycom/cms/commit/b109215b5a2672845dbe75b379c7219f2f14aeb0))
* **cms:** count a backlink through the homepage and the site's redirects ([2c27148](https://github.com/geekitycom/cms/commit/2c271487e254ad64b73042342a7e9400c49a3a48))
* **cms:** give a page that takes comments a comments feed and advertise it ([98a47a0](https://github.com/geekitycom/cms/commit/98a47a01a21dfb1463bcbac9ffcc078049332822))
* **cms:** give each native comment a page of its own at /comment/{id}/ ([37c1408](https://github.com/geekitycom/cms/commit/37c14080cc7d629ecc1aaa5f0017b89cb0f6b4bd))
* **cms:** label fetched and delivered replies on the federation screen ([68e2fac](https://github.com/geekitycom/cms/commit/68e2faca2b5ec297f3123677c47cc8fdc564d59d))
* **cms:** list the site's own posts that link to a post or page as backlinks ([57bf892](https://github.com/geekitycom/cms/commit/57bf8926ea78b805ca4dc034a428d7b69d9b27de))
* **cms:** look up /replies/ keys in an index and 404 them where the conversation is hidden ([5e87217](https://github.com/geekitycom/cms/commit/5e87217e7522d8e67f574b36031a3627243a94e2))
* **cms:** make a signed-in reply in a comment thread a reply post shown in the thread ([5998a53](https://github.com/geekitycom/cms/commit/5998a539d5e483400826ce78271ded893c4c3414))
* **cms:** make every signed-in reply a reply post and send its notice once ([adfc27c](https://github.com/geekitycom/cms/commit/adfc27c1d1c8b0243077059ac93a18957afb670e))
* **cms:** make the comments feeds a walkable tree in the source namespace ([cae63ca](https://github.com/geekitycom/cms/commit/cae63cabb85cc8213dcbb9336978a455248a2dc7))
* **cms:** name the publication a post was first published on ([46f3658](https://github.com/geekitycom/cms/commit/46f3658b8b82f5acca6f5aff6d3512920fa9176f))
* **cms:** send and receive salmentions so replies to replies reach the thread ([f8c8963](https://github.com/geekitycom/cms/commit/f8c8963eca9084c933ba5ab358a6d9513bd3ccd5))
* **cms:** show only the page on a static front page and offer newestPosts(count) ([7fc0d10](https://github.com/geekitycom/cms/commit/7fc0d103d1cc080e55262f6d97f0ddde9c5ea83b))
* **cms:** thread a received webmention under the reply it answers ([0f9307e](https://github.com/geekitycom/cms/commit/0f9307e5715651c785cd4cf9424c04a641d6bc3b))


### Bug Fixes

* **cms:** keep a moved page's replies feed and a moved draft's comments and sends ([68d69f2](https://github.com/geekitycom/cms/commit/68d69f239d6c658c45cdf234494913c3e7ebb404))
* **cms:** let the Eleventy example build the default theme and its overrides ([432f76c](https://github.com/geekitycom/cms/commit/432f76c6deca0c3fed4fb08c7ff3000738d772d9))
* **cms:** show a reply under a hidden comment in its thread under a placeholder ([6f437f2](https://github.com/geekitycom/cms/commit/6f437f2325ac71dd0b71b4391ce32481b302d0e8))
* **cms:** take a moved post's comments along when its slug changes ([14624dd](https://github.com/geekitycom/cms/commit/14624dd0af9714a0b90ba7ee685e8f647f4f6fa4))
* **cms:** tell a reply post's commenter when their pending comment is approved ([64f5d9c](https://github.com/geekitycom/cms/commit/64f5d9ceca7d725c1957b38f508ce51347abb055))
* **cms:** watch the content tree with one recursive watch so no new file is missed ([a97641b](https://github.com/geekitycom/cms/commit/a97641bc326ab0a7aa0bf7eef64efc6b225b69e4))


### Code Refactoring

* **cms:** remove the signed-in native comment path and restating comments ([8ed8897](https://github.com/geekitycom/cms/commit/8ed889760a68c8d3bd78131c96ed4300c26e9b4c))

## [0.28.0](https://github.com/geekitycom/cms/compare/v0.27.0...v0.28.0) (2026-10-09)


### Features

* **cms:** give plugins the content directory on PluginSite ([10eb2c5](https://github.com/geekitycom/cms/commit/10eb2c5c9dc3e437376774aef9a52f371a2af0b2))
* **cms:** hold every outbound side effect in dev mode until the site goes live ([3b973e5](https://github.com/geekitycom/cms/commit/3b973e504f8d4cd801ef2c677f4e5044d27d6161))
* **cms:** let a plugin check a file against the site's upload rules ([3eb3456](https://github.com/geekitycom/cms/commit/3eb345651c0477e6dfdd778d21fdf9eda615bf7d))
* **cms:** let a plugin read and write a post's comments ([b7e0d42](https://github.com/geekitycom/cms/commit/b7e0d42645b20e2eef850cb3d77bdaf5f6262ec6))
* **cms:** let a post name the canonical url it was first published at ([a50e2ab](https://github.com/geekitycom/cms/commit/a50e2abe0c5305cc9d0c45778ef6f7bec39bcbe2))
* **cms:** let a post set the guid its feeds publish apart from its activitypub id ([a9ddfc5](https://github.com/geekitycom/cms/commit/a9ddfc59d6257e0fc03c75946bfc973d91f95f83))
* **cms:** let a site theme add markup to every page through head-end and body-end partials ([e172ff7](https://github.com/geekitycom/cms/commit/e172ff75a645353e67900367d1218891e41c8d5a))
* **cms:** let an editor action offer title choices and a note with nothing to accept ([cc16b8c](https://github.com/geekitycom/cms/commit/cc16b8c2ed83fc35cfd3aa8c14136a90e7231e1e))
* **cms:** never announce a post that was public before it reached the site ([0d9fe2d](https://github.com/geekitycom/cms/commit/0d9fe2db726edaff0bc7239f819086f3a7b623f7))
* **cms:** play a youtube or vimeo url on a line of its own as the video ([b3d9854](https://github.com/geekitycom/cms/commit/b3d98542ec727c242c3364321b228b94123871ae))
* **cms:** read redirects from every file in _data/redirects/, as a list or a from-to map ([b8bb60c](https://github.com/geekitycom/cms/commit/b8bb60c4de034afc1d8a94a43fcb72c50eeeafa3))
* **cms:** reload the site by itself when the plugins folder changes ([e4ee555](https://github.com/geekitycom/cms/commit/e4ee5550f34b827052eb81040dba018e716e74e0))
* **plugin-wordpress:** import a wordpress export into the content directory ([811425d](https://github.com/geekitycom/cms/commit/811425dbb01a1738ca82424f84d6a3249ec588fc))
* **plugin-wordpress:** import wordpress media to /uploads/ and redirect old media urls ([1e8b033](https://github.com/geekitycom/cms/commit/1e8b0338c2de377699111ea1cd18ed5706b6a43f))


### Bug Fixes

* **cms:** index a document written into a directory created under a running watch ([398e7b3](https://github.com/geekitycom/cms/commit/398e7b34e19aa3a41c4b51fccf87c9019899a028))
* **cms:** let a post whose slug is not ascii hold comments, and encode the reply link's id ([9e29772](https://github.com/geekitycom/cms/commit/9e297728e7db8850d721969a786556569de64778))
* **cms:** skip cited-page revisions for posts with no account to send them ([4eef52f](https://github.com/geekitycom/cms/commit/4eef52f496d4dbd8e35876ab6396a52fd894490a))
* **cms:** stop serving a draft, scheduled or non-public post at its stored activitypub id ([9249f0b](https://github.com/geekitycom/cms/commit/9249f0b3fefa69f15dc7c7099437610fb62d1545))
* **cms:** stop stamping posts as announced on a site with no accounts ([3e1ea2e](https://github.com/geekitycom/cms/commit/3e1ea2e02d18057f8fd943d44d6d6e8b2a5116d8))

## [0.27.0](https://github.com/geekitycom/cms/compare/v0.26.0...v0.27.0) (2026-10-09)


### Features

* **cms:** add, update and remove plugins from the Plugins screen ([e655ce6](https://github.com/geekitycom/cms/commit/e655ce664a9838b2c37c67b1e0a9b3cbb4519427))
* **cms:** match tags without regard to case ([40782b3](https://github.com/geekitycom/cms/commit/40782b3c3ace206015a0602302249790ba4e6943))
* **cms:** require a plugin to be disabled before it is removed ([0e06a3b](https://github.com/geekitycom/cms/commit/0e06a3bf2df8b02f40524c602365927cf6af7cac))
* **cms:** upgrade every folder plugin to its newest compatible version ([f190a8f](https://github.com/geekitycom/cms/commit/f190a8f0e0d5ff0e58b5269489fc2271464e1c75))


### Bug Fixes

* **cms:** refuse a plugin that targets an older host API ([358ba67](https://github.com/geekitycom/cms/commit/358ba67cf4eb4b741ecde16ab999edecfffd781d))
* **release:** publish plugin peer ranges as &gt;=built-against &lt;1.0.0 ([d2f7c65](https://github.com/geekitycom/cms/commit/d2f7c653401f68b67607b54c8bfe6a2d15af26fc))

## [0.26.0](https://github.com/geekitycom/cms/compare/v0.25.0...v0.26.0) (2026-10-09)


### Features

* **cms:** give editor actions the site's recent titles and grouped choices ([cd01ac7](https://github.com/geekitycom/cms/commit/cd01ac7e41ad35a671ec6347390b221f6b4af988))

## [0.25.0](https://github.com/geekitycom/cms/compare/v0.24.0...v0.25.0) (2026-10-08)


### ⚠ BREAKING CHANGES

* **cms:** the wordpressActivityPub setting, User.wordpressActorId, `geekity import wordpress-actor`, setUserWordPressActor and the WordPress federation exports are removed from @geekity/cms. Install and enable @geekity/plugin-wordpress instead; setUserActorId replaces setUserWordPressActor.

### Features

* **cms:** head a document's markdown with its title ([0e923bf](https://github.com/geekitycom/cms/commit/0e923bf2b699a1d5eba22df63da999b764884573))
* **cms:** install plugin packages into the plugins folder with geekity plugin add ([696399c](https://github.com/geekitycom/cms/commit/696399c1e659780c0cc331fa122631fe4a6a0fd3))
* **cms:** let plugins add editor actions beside the title, description and tags fields ([f2d7b82](https://github.com/geekitycom/cms/commit/f2d7b8270af7f1d2b64ed9e6449c4cddaa84ce62))
* **cms:** let plugins declare settings and secrets, drawn as a form on their screen ([4df98a5](https://github.com/geekitycom/cms/commit/4df98a573a744454619dcf9c3e857564d626d748))
* **cms:** let plugins fetch public URLs and offer tag choices in the editor ([2e71602](https://github.com/geekitycom/cms/commit/2e71602c2547d6fc8c2e867e80d799578fbb89cf))
* **cms:** let plugins provide and use services, typed by a map the provider extends ([d2cfc8a](https://github.com/geekitycom/cms/commit/d2cfc8ac90bf19ed7be14ae55fd65876144527b2))
* **cms:** move the WordPress ActivityPub compatibility out of core ([7dad017](https://github.com/geekitycom/cms/commit/7dad017741033c3ed261964fac7666d820eb2de0))
* **cms:** register plugins with dependencies and enable them from a plugins screen ([8a5dfd0](https://github.com/geekitycom/cms/commit/8a5dfd0cfc3f7aa27401b1f923b8b3b60fd7adb2))
* **cms:** supervise geekity serve and reload it without dropping requests ([a2176cd](https://github.com/geekitycom/cms/commit/a2176cd65a49a998b9ea0ce891025b34a62e58b1))


### Bug Fixes

* **cms:** keep a flash queued on a draining worker and make plugin route order irrelevant ([459aa01](https://github.com/geekitycom/cms/commit/459aa01693c43b93c840be86dd99d1bd4f6cdded))
* **cms:** redirect the short .md and .json spelling to index ([43c2261](https://github.com/geekitycom/cms/commit/43c2261f08ecf1ad0e5ae526c4527e63819b35da))

## [0.24.0](https://github.com/geekitycom/cms/compare/v0.23.0...v0.24.0) (2026-10-07)


### Features

* **cms:** render the home listing as markdown instead of serving llms.txt ([ea6f2d4](https://github.com/geekitycom/cms/commit/ea6f2d449c0008ecc29973f35ebf902866ba25e3))
* **cms:** serve markdown and text/plain for listings and the front page ([ad47e99](https://github.com/geekitycom/cms/commit/ad47e9914a69daacb94eb1deebf3f537be4e6c6e))

## [0.23.0](https://github.com/geekitycom/cms/compare/v0.22.0...v0.23.0) (2026-10-06)


### Features

* **cms:** answer 410 gone at deleted posts' urls ([6f3de6c](https://github.com/geekitycom/cms/commit/6f3de6c4e593a37f970926a14af40366f88ed670))
* **cms:** autolink bare URLs and fediverse handles in posts ([47e0631](https://github.com/geekitycom/cms/commit/47e0631391a23d947ee3990740edffa3044d160a))
* **cms:** create events over micropub ([286bfbd](https://github.com/geekitycom/cms/commit/286bfbdcbe409963e989b587397c7bf22d59d4e1))
* **cms:** describe cited pages from activitypub, json-ld and their authors' photos ([1ef7d26](https://github.com/geekitycom/cms/commit/1ef7d2696a7da6d538c78bc7a97d9b9e5182d49e))
* **cms:** publish and receive RSVP posts ([e3a43e4](https://github.com/geekitycom/cms/commit/e3a43e40d23a1a8a8d1134d4b6cc89ad72ba8f65))
* **cms:** publish events and group the RSVPs they receive ([baf8c73](https://github.com/geekitycom/cms/commit/baf8c730c5584c7a74dc6bb2b45c6109d6e60952))
* **cms:** reach a trashed post from the trash list when a live post shares its slug ([3a32e43](https://github.com/geekitycom/cms/commit/3a32e4373d2a06effdc54eaa97de037874665e9c))
* **cms:** receive pingbacks as mentions ([1d6e583](https://github.com/geekitycom/cms/commit/1d6e583ef0573a500ca8737ef1ec1487009e0c37))
* **cms:** reply to the original of a silo copy and take responses to syndicated copies ([2b41d28](https://github.com/geekitycom/cms/commit/2b41d2817b1c2ff49b3f8df6153f24cc1c9d22d0))
* **cms:** show the conversation and comment form on pages that take comments ([5a4b2c2](https://github.com/geekitycom/cms/commit/5a4b2c2bfee8eef657bbde7c16a0687a870f5e5e))


### Bug Fixes

* **cms:** end a cited page's fetch on one deadline signal ([586a9f9](https://github.com/geekitycom/cms/commit/586a9f9a531bdf01b857445b8034d3eb716d2d3c))

## [0.22.0](https://github.com/geekitycom/cms/compare/v0.21.0...v0.22.0) (2026-10-05)


### Features

* **cms:** add the DaisyUI admin's component macros and class checks ([881c9c5](https://github.com/geekitycom/cms/commit/881c9c5542716e2f53daa6f4fa7720a668c1e56c))
* **cms:** draw list tables on a card and put the row actions under the title ([a11366b](https://github.com/geekitycom/cms/commit/a11366bd245fedf049762433d77bcb030dcfc4e5))
* **cms:** draw the admin bar from one shadow-rooted template, light or dark ([537de26](https://github.com/geekitycom/cms/commit/537de26656b36534a0559d894116c67a583f793c))
* **cms:** draw the admin shell, flash and account screens with DaisyUI ([ec5389b](https://github.com/geekitycom/cms/commit/ec5389b818edec3a9ba864811037d3ae53064efb))
* **cms:** draw the admin's form fields with DaisyUI ([230d2ca](https://github.com/geekitycom/cms/commit/230d2ca7a2bf617d9e12d27f63c74054c909ee7a))
* **cms:** draw the admin's list screens on the DaisyUI table, tabs and badges ([5f92a4f](https://github.com/geekitycom/cms/commit/5f92a4f3b452a2ff914315b706c404cb67660b42))
* **cms:** draw the dashboard's counts as DaisyUI stats and recent posts as a card ([6812498](https://github.com/geekitycom/cms/commit/6812498a79c3c3b11600cb9f0cffb67386f53d62))
* **cms:** draw the editor and the conflict screen with DaisyUI ([aae0373](https://github.com/geekitycom/cms/commit/aae03730e578e21850d0a023a7a7cce78613a480))
* **cms:** draw the remaining admin screens with DaisyUI ([712e145](https://github.com/geekitycom/cms/commit/712e14509cfc09f1950dcbbb5cb208977e0d4206))
* **cms:** flip the admin to DaisyUI ([65057cc](https://github.com/geekitycom/cms/commit/65057cc57e3da44ae5315573d05e3f7d1fdc03d8))
* **cms:** let each user pick the admin's theme or follow the system ([0784667](https://github.com/geekitycom/cms/commit/0784667ae5cfc8097831b0659cb5ae8e0c9ccab0))
* **cms:** name an untitled photo post by its first photo's alt text ([d9d8e6c](https://github.com/geekitycom/cms/commit/d9d8e6c1b5cfc6cd48df3257c4dd94a4321e035d))
* **cms:** stack list rows below lg with a toggle that opens the other columns ([fd609a0](https://github.com/geekitycom/cms/commit/fd609a0d282b94d2f1e882929fcd08e2a58ff5c2))


### Bug Fixes

* **cms:** mint one CSP nonce for the dashboard ([027f687](https://github.com/geekitycom/cms/commit/027f687d42f6762cecb3f9457a4258a46d0871f5))
* **cms:** outline a plain badge so Published reads on a card ([a485e3f](https://github.com/geekitycom/cms/commit/a485e3f102a55943c09ddc65fd24a5991ac562ae))

## [0.21.0](https://github.com/geekitycom/cms/compare/v0.20.0...v0.21.0) (2026-10-04)


### Features

* **cms:** name the cited page in a like, repost or bookmark's federated note ([4b5e163](https://github.com/geekitycom/cms/commit/4b5e1637f77dd64ae4ebbfcab96e7881e90dc51b))
* **cms:** send an update when a cited page's context arrives after the create ([f24d243](https://github.com/geekitycom/cms/commit/f24d2433b283a2e7d959a53094d123e7e22aa098))


### Bug Fixes

* **cms:** label an untitled like, repost, bookmark, reply or photo by what it is ([32c6a72](https://github.com/geekitycom/cms/commit/32c6a7241ff05f90cc2672e0ae61576d24f01501))

## [0.20.0](https://github.com/geekitycom/cms/compare/v0.19.0...v0.20.0) (2026-10-04)


### Features

* **cms:** fill a post's location from the browser in the editor ([a2c664c](https://github.com/geekitycom/cms/commit/a2c664c0e4d00bc5642735bd81fa533a16ff3cc0))
* **cms:** lead the public admin bar's title home, with a view admin link ([19df2c1](https://github.com/geekitycom/cms/commit/19df2c13466045e6129f853a5ff7add05e766235))
* **cms:** name an untitled like, repost, bookmark or reply after the page it cites ([c3f8580](https://github.com/geekitycom/cms/commit/c3f8580fa3484da6b0975749d7698041f0edd51d))
* **cms:** show a cited image url as the image, credited to its host ([c48c91c](https://github.com/geekitycom/cms/commit/c48c91ca4d565505470badedbef2727baa6189a3))
* **cms:** show a cited page's picture in its citation, with a per-post remove control ([c65c4fe](https://github.com/geekitycom/cms/commit/c65c4feb61858acc9f689efabe568a7d5aa1a7a7))


### Bug Fixes

* **cms:** ask a known oembed provider before reading its page, and add giphy ([fe479ae](https://github.com/geekitycom/cms/commit/fe479ae5e7441f10d5f6de01f05319b47ffacced))
* **cms:** ask a known provider's oembed endpoint when its page names none ([0e2ecd5](https://github.com/geekitycom/cms/commit/0e2ecd557b7168efd879ff646c2430f53ca760d9))
* **cms:** clean the micropub body as it is stored ([cf9027d](https://github.com/geekitycom/cms/commit/cf9027d61bf7529c000be07087b53af75d020040))
* **cms:** convert micropub html content to clean markdown ([d63a0a1](https://github.com/geekitycom/cms/commit/d63a0a11bf0e192e93f45095686ede2b1b36f7ad))
* **cms:** escape feed excerpts and keep feeds serving past a bad url ([59b88e6](https://github.com/geekitycom/cms/commit/59b88e65c635ceabddb8503df26431c631ff3ca1))
* **cms:** head a titled post that has no body with its title ([424a3fb](https://github.com/geekitycom/cms/commit/424a3fb038542417219e5bbaeb280fe52ea04202))
* **cms:** keep a word whole across an apostrophe in a slug ([b105959](https://github.com/geekitycom/cms/commit/b105959daa3cb51c6895d97814adbaa18a2ace90))

## [0.19.0](https://github.com/geekitycom/cms/compare/v0.18.0...v0.19.0) (2026-10-03)


### Features

* **cms:** accept more micropub clients and requests ([6b67cf0](https://github.com/geekitycom/cms/commit/6b67cf02d51e150d799c7b4f5a09123067798f73))
* **cms:** fold the post editor's unused blocks and group its side column ([33be4a4](https://github.com/geekitycom/cms/commit/33be4a483ae6687f5431328274c31cefe08ffce6))
* **cms:** fold the post editor's unused blocks and group its side column ([8205685](https://github.com/geekitycom/cms/commit/8205685d44dc1382baaacba9bfe861d9499dd5f0))
* **cms:** keep micropub properties the site does not understand, privately ([ae62dd8](https://github.com/geekitycom/cms/commit/ae62dd808b67e3f20889b216a22a16f8aaac4509))
* **cms:** map a micropub checkin onto the post's location ([baa2e64](https://github.com/geekitycom/cms/commit/baa2e6415bbb6c7bf8b594f7e250f54502e8f180))
* **cms:** name an untitled like, repost, bookmark, reply or photo after what it is ([b5035f2](https://github.com/geekitycom/cms/commit/b5035f292713287e717f971672a530fb00478619))
* **cms:** name cited pages, show drafts to their author, reach replied-to authors ([2efffc1](https://github.com/geekitycom/cms/commit/2efffc16d9de6be3e0fd725196cee83d33da1867))
* **cms:** name what a like, repost or bookmark cites, reading oembed where offered ([ee923cb](https://github.com/geekitycom/cms/commit/ee923cb6e6d1b5551f7ea2bd0127261add34b925))
* **cms:** serve a hidden post's page to a signed-in user at its permalink ([a045812](https://github.com/geekitycom/cms/commit/a0458121f81aca816d1b02995e56cd43e724c1d3))


### Bug Fixes

* **cms:** accept a create token at the micropub media endpoint ([37e5752](https://github.com/geekitycom/cms/commit/37e57523dbcc439e6ae115a696413b30328f9581))
* **cms:** accept a micropub visibility value in any case ([7b8cb7c](https://github.com/geekitycom/cms/commit/7b8cb7cf2597794157c495768ebf166500732b9a))
* **cms:** answer insufficient_scope with 401 on the micropub and media endpoints ([ab76d72](https://github.com/geekitycom/cms/commit/ab76d72d4edf542c475f5b2d2d059a7d668388ee))
* **cms:** federate a reply to the author of the status it answers ([d49f5b5](https://github.com/geekitycom/cms/commit/d49f5b50e9307256e2116763b22b9702b736c78c))
* **cms:** put a titled post's citation after its title ([12cf713](https://github.com/geekitycom/cms/commit/12cf71304c05b12a1e22c7c8548e665814181a7a))
* **cms:** read a cited page's title and oembed link from the head of a page over the size limit ([fcdd2d9](https://github.com/geekitycom/cms/commit/fcdd2d9765989e48497804cd6d9de2267e2b8c6a))
* **cms:** strip direction controls from cited names and name a title's author once ([18cc11a](https://github.com/geekitycom/cms/commit/18cc11a2b1682446fa0430690b313cbf987643ea))

## [0.18.0](https://github.com/geekitycom/cms/compare/v0.17.0...v0.18.0) (2026-10-03)


### ⚠ BREAKING CHANGES

* **cms:** the isPublicDocument export is removed; use isServed for whether a document has a public URL and isListed for whether the site lists it.

### Features

* **cms:** accept a post's location and add settings &gt; privacy to decide what is shared ([a186370](https://github.com/geekitycom/cms/commit/a1863706408098be23104a16101b051bb89329aa))
* **cms:** accept everything quill's note, article and media flows send ([4186943](https://github.com/geekitycom/cms/commit/4186943a895da03f409e520686a052868b2a2fd5))
* **cms:** create an access token from connected apps ([f6340c1](https://github.com/geekitycom/cms/commit/f6340c1618dfe7140d4db2f33c71af973caf7496))
* **cms:** let listed apps sign in without pkce ([d38685b](https://github.com/geekitycom/cms/commit/d38685b37cb1908490e9a6e471ec8149c8d2a9ae))
* **cms:** list each post type's properties in micropub q=config ([732058f](https://github.com/geekitycom/cms/commit/732058f2792ff894d1c7cbb581bec4f14a91379d))
* **cms:** post-type property lists in q=config and access tokens from connected apps ([5c9b28d](https://github.com/geekitycom/cms/commit/5c9b28d93157196f14e77bf7901decee45e78ec1))
* **cms:** read posts with read-of and read-status from micropub and the editor ([e29f524](https://github.com/geekitycom/cms/commit/e29f5245624221b316420ff66b8fc97fd8a1f312))
* **cms:** strip upload metadata, photos in feeds, and location with a privacy page ([2afd371](https://github.com/geekitycom/cms/commit/2afd3718e789586bf90540110e1d2ebf811a9113))
* **cms:** support quill and let listed apps sign in without pkce ([4015b55](https://github.com/geekitycom/cms/commit/4015b558fa33306e09af957b8cd663324dbb1299))
* **cms:** unlisted posts, served at their url and left out of every list ([51cdb1b](https://github.com/geekitycom/cms/commit/51cdb1b8df99169a75dc8b92f315c1e2b3ca6f9f))


### Bug Fixes

* **cms:** answer 400 when a token-less form body cannot be read ([5c47c39](https://github.com/geekitycom/cms/commit/5c47c39f974e87eef148405a1c93a5ce98de124a))
* **cms:** answer 404 for a post object on a site with no accounts ([c41f2d2](https://github.com/geekitycom/cms/commit/c41f2d27bed4c009e8b7e234ea37f188fdd6a213))
* **cms:** carry a post's photos in the rss, atom and json feeds ([ac08e46](https://github.com/geekitycom/cms/commit/ac08e463995c1b68a709d89f3b93fa652d5b9c6d))
* **cms:** harden how micropub reads a request body ([f417f5c](https://github.com/geekitycom/cms/commit/f417f5cdd548c27e974d1684237026321e8bb2ca))
* **cms:** keep a read post's line, summary and webmention in step with the read ([d17198d](https://github.com/geekitycom/cms/commit/d17198d9bbad5efbd3359ca342f8eb0b7845195d))
* **cms:** leave unlisted posts out of eleventy collections ([cb5802e](https://github.com/geekitycom/cms/commit/cb5802eae0fb983ccdf01b8726d49a1154245e4a))
* **cms:** print relative body urls absolute in feeds ([22f2185](https://github.com/geekitycom/cms/commit/22f21856f0a34bf2c725015e0aa0cf4cb4200cf6))
* **cms:** print relative body urls absolute in feeds ([fd3a333](https://github.com/geekitycom/cms/commit/fd3a333fdf63896bed759f1a43dc4764bc9ef60f))
* **cms:** refuse an oversized micropub create before reading its body ([9896756](https://github.com/geekitycom/cms/commit/9896756ef05ffbbbc85b8c46ee7a276f4befc0c1))
* **cms:** strip location and camera metadata from uploads ([0b0d68b](https://github.com/geekitycom/cms/commit/0b0d68b9b3249d1ac2953a142f3da46b4caa8399))
* **cms:** unlisted posts in eleventy, a 404 for objects with no accounts, and read post gaps ([1aefd24](https://github.com/geekitycom/cms/commit/1aefd24deb46e68e2f4edf02d0081f8103c6f5d2))

## [0.17.0](https://github.com/geekitycom/cms/compare/v0.16.0...v0.17.0) (2026-10-02)


### Features

* **cms:** advertise authorization and token endpoint rels on identity urls ([e1f8596](https://github.com/geekitycom/cms/commit/e1f859634942f95209d21cd4a87d7b017266873d))
* **cms:** advertise legacy indieauth rels and log app activity in the admin ([60ad59e](https://github.com/geekitycom/cms/commit/60ad59e74a01ec5167708bbeaf2a37c4d679e675))
* **cms:** log indieauth and micropub requests for the admin ([6438fdf](https://github.com/geekitycom/cms/commit/6438fdf082107fc158746cd6a78f5d010711bc39))


### Bug Fixes

* **cms:** accept the same access token in the header and the body ([8bbbd68](https://github.com/geekitycom/cms/commit/8bbbd683e9bac58b2566d05175c32b1ed3a0010d))
* **cms:** accept the same access token in the header and the body ([7458e7f](https://github.com/geekitycom/cms/commit/7458e7f49aa9232d17ee69ce5d306cca3f118fe4))

## [0.16.0](https://github.com/geekitycom/cms/compare/v0.15.0...v0.16.0) (2026-10-02)


### ⚠ BREAKING CHANGES

* **cms:** the default theme no longer links posts tagged indienews to IndieNews on its own; declare an IndieNews target with tag "indienews" in content/_data/syndicationTargets.json.

### Features

* **cms:** accept micropub media uploads into the media library ([bf5c88b](https://github.com/geekitycom/cms/commit/bf5c88b356ca7bd38e747835d2cdacd16c70464a))
* **cms:** create posts over micropub ([fac52dd](https://github.com/geekitycom/cms/commit/fac52ddffaa9c08a8a4d58fd49e01fdde036dcaa))
* **cms:** like, repost and bookmark posts over micropub, the editor and federation ([bae3499](https://github.com/geekitycom/cms/commit/bae349904f2c79d92250a95f675740c902e81c64))
* **cms:** manage syndication targets from the admin ([f73bc6c](https://github.com/geekitycom/cms/commit/f73bc6c1746813ed7141c231a6ee3381cd2f4e9c))
* **cms:** offer and select syndication targets over micropub ([fa955f8](https://github.com/geekitycom/cms/commit/fa955f877ad1302e5e6215bfd31039d93eaf93cc))
* **cms:** post photos over micropub and render and federate them ([3ed1b6a](https://github.com/geekitycom/cms/commit/3ed1b6a009ad330093fa7c4afa04693a6457624e))
* **cms:** send posts to per-language syndication targets ([72a176a](https://github.com/geekitycom/cms/commit/72a176abebacc3d3f869c9d2a7cef30218e03e21))
* **cms:** serve micropub discovery and configuration queries ([556f88c](https://github.com/geekitycom/cms/commit/556f88cba0d0d30a657011dd5e33464fb0076ab9))
* **cms:** syndicate posts to declared targets such as indienews and bridgy ([75b1a6a](https://github.com/geekitycom/cms/commit/75b1a6a3d2714a83bcdfb27f97f7940d96b90125))
* **cms:** update, delete and undelete posts and answer q=source over micropub ([ac74b19](https://github.com/geekitycom/cms/commit/ac74b19663754836455708f9094c409907e7fb0d))


### Bug Fixes

* **cms:** refuse an access token sent in both the header and the body ([c9add8f](https://github.com/geekitycom/cms/commit/c9add8f18b5547f6c2c3c69b5bdf71969b8c19a3))

## [0.15.0](https://github.com/geekitycom/cms/compare/v0.14.0...v0.15.0) (2026-10-02)


### Features

* **cms:** accept audio, video and caption uploads ([e6946fa](https://github.com/geekitycom/cms/commit/e6946fab2e5a16474ca5601c1542206a7aeda900))
* **cms:** add a content license setting ([52ba2e1](https://github.com/geekitycom/cms/commit/52ba2e19f839ca8580788d6a5007a0651370e643))
* **cms:** add a site icon setting to settings &gt; general ([fd02378](https://github.com/geekitycom/cms/commit/fd02378554a238b07b301161522679a654dad1f8))
* **cms:** attach a recording to a post in the editor ([321ea08](https://github.com/geekitycom/cms/commit/321ea08381ed116676816688fd17a5f77f8b29b6))
* **cms:** attach an audio or video recording to any post ([b028d46](https://github.com/geekitycom/cms/commit/b028d46861bb860cf9a2c235b5880259ee161ce2))
* **cms:** carry a post's recording in rss, atom and json feed ([a6e59ab](https://github.com/geekitycom/cms/commit/a6e59ab2e253e60b96d344966b8fa20338a2660c))
* **cms:** federate a post's recording as an audio or video attachment ([0813ab5](https://github.com/geekitycom/cms/commit/0813ab57892cb8b5134baf09fdd98b2ae84d8ff7))
* **cms:** play a post's recording in the default theme ([be6636c](https://github.com/geekitycom/cms/commit/be6636cfd7ebeddd4d50192720e12158741c283e))


### Bug Fixes

* **cms:** fall back to the author's photo, then the site icon, for the share image ([f58fba9](https://github.com/geekitycom/cms/commit/f58fba9480592f2fd080865d83724589331fab95))
* **cms:** keep a hand-written recording the editor cannot use ([b66ca22](https://github.com/geekitycom/cms/commit/b66ca226b99110ca556f1d87bbf561dd36a394ee))

## [0.14.0](https://github.com/geekitycom/cms/compare/v0.13.0...v0.14.0) (2026-10-02)


### ⚠ BREAKING CHANGES

* **cms:** site.json author holds a username and soloAuthor is gone; an author that names no user now makes a several-authors site whose footer and feeds show the site title.

### Features

* **cms:** add opensearch, an oembed provider and pinned posts ([eadcf0a](https://github.com/geekitycom/cms/commit/eadcf0a33b2555f6f4c9a4d3b8a3121b7f577ee8))
* **cms:** give untitled posts a json-ld headline and a fallback image ([25c9c67](https://github.com/geekitycom/cms/commit/25c9c67fbcb2c00cd71558c8f04e516c96371dc4))
* **cms:** make the site author one select of a user or several authors ([566d5a2](https://github.com/geekitycom/cms/commit/566d5a2e0970b2687880ece41a231cf4c67e2d78))
* **cms:** pin posts to the actor's featured collection ([5bb40d0](https://github.com/geekitycom/cms/commit/5bb40d06fb212438e33bbc720a2251f0b2a8b448))
* **cms:** print a fediverse:creator meta tag naming the author's own actor ([893a80d](https://github.com/geekitycom/cms/commit/893a80dfc0ea2a21cebe9f36e4a4023611b015a3))
* **cms:** publish attributionDomains on every actor ([f4cbbd2](https://github.com/geekitycom/cms/commit/f4cbbd2ddf11be00a08fb141a8a94b60f944b4b3))
* **cms:** publish attributionDomains on every actor ([bb3a0c3](https://github.com/geekitycom/cms/commit/bb3a0c358e7fe2d4fe9073a7a1bd015c09a3ee6f))
* **cms:** serve an embed view so wordpress can frame posts ([dd12b8c](https://github.com/geekitycom/cms/commit/dd12b8cd3e53f1de767b4b15afd19cb134f493f5))
* **cms:** serve an oembed provider for posts and pages ([10e1761](https://github.com/geekitycom/cms/commit/10e17617c8540c2f71ee133524f52429a91c3e41))
* **cms:** serve an opensearch description and link it from every page ([1e3ab45](https://github.com/geekitycom/cms/commit/1e3ab4596fa8b3d15d7d6510995b4a2fac1f5bc7))


### Bug Fixes

* **cms:** make the solo-author homepage h-card the site's representative h-card ([f36f6cf](https://github.com/geekitycom/cms/commit/f36f6cfed6d232533bb675790d15fe0ecc7ec80c))
* **cms:** wait for image derivation before close returns ([84e5f44](https://github.com/geekitycom/cms/commit/84e5f442c0d24b0ee21898c8d0ad5af1ffc49ac5))

## [0.13.0](https://github.com/geekitycom/cms/compare/v0.12.0...v0.13.0) (2026-10-01)


### ⚠ BREAKING CHANGES

* **cms:** the setting is off by default, and when off a static front page's bio card no longer carries rel="me", so a Mastodon profile field that points at the homepage stops verifying until the owner turns it on.
* **cms:** the date filter now formats dates with the conventions of the site's language, so a site whose language is not bare en sees different date text without a config change.

### Features

* **cms:** add a connected apps screen to review and revoke indieauth tokens ([563f27e](https://github.com/geekitycom/cms/commit/563f27ed660fd0f7f65a9e876cbbdc30cfda2e72))
* **cms:** add a solo author setting so the homepage speaks for the author ([ce3e447](https://github.com/geekitycom/cms/commit/ce3e447abfcc4015b76b03c1a95ffefada60f0ef))
* **cms:** add breadcrumbs and breadcrumblist json-ld to the default theme ([cebdf93](https://github.com/geekitycom/cms/commit/cebdf9315dd6691e51fb8dd6a76f0582a44fa5d1))
* **cms:** add the indieauth authorization endpoint and consent screen ([03dec3f](https://github.com/geekitycom/cms/commit/03dec3f87c5d932b87d96fa5f96f5fc346ccd95d))
* **cms:** authenticate api routes with indieauth bearer tokens ([8cc6e2b](https://github.com/geekitycom/cms/commit/8cc6e2b900831e4b704363fe39c7691054269917))
* **cms:** close the m24 and m25 follow-up gaps ([8209b1c](https://github.com/geekitycom/cms/commit/8209b1cadc7168bd41f14f9f4b7df36e23a20401))
* **cms:** configure robots.txt with ai-crawler rules and content signals ([f88cdf6](https://github.com/geekitycom/cms/commit/f88cdf63151468700917ad0147abef941e5f7cbc))
* **cms:** declare an update cadence in rss feeds ([9de255a](https://github.com/geekitycom/cms/commit/9de255ab7d93669e57967603f99368b991451af3))
* **cms:** declare theme colours and richer open graph in the head ([5e4c20d](https://github.com/geekitycom/cms/commit/5e4c20d38a0b0d8f617eeef46e9af6cbe88fff0a))
* **cms:** issue indieauth access tokens at the token endpoint ([763e934](https://github.com/geekitycom/cms/commit/763e934d1f2b783c25f6abb0b4ea723339c51703))
* **cms:** let a post or page name its own language ([bd33580](https://github.com/geekitycom/cms/commit/bd33580036429fc2950b4061f7fdd70aa12ba1f9))
* **cms:** milestone M23 discovery and machine-readable surface ([b932497](https://github.com/geekitycom/cms/commit/b9324977cfff68ab8927bfe365f73e52666000ae))
* **cms:** publish indieauth server metadata and advertise it from identity urls ([3da41e2](https://github.com/geekitycom/cms/commit/3da41e2000e420da0758ba0ec637cd4a59b4645a))
* **cms:** redeem indieauth codes for the profile at the authorization endpoint ([510736d](https://github.com/geekitycom/cms/commit/510736deffbad43fd4f86e0471886fa2b877da70))
* **cms:** serve a favicon, a maskable icon and a web app manifest ([44bb016](https://github.com/geekitycom/cms/commit/44bb016932c9d00fc6c4d670dab79dc9dc230c61))
* **cms:** serve a generated /llms.txt advertised from the home page ([f75ff9c](https://github.com/geekitycom/cms/commit/f75ff9c2e629ef171fc52eb4f892fde8451061a7))
* **cms:** show an indieauth client's logo on the consent screen ([7b9aef8](https://github.com/geekitycom/cms/commit/7b9aef8cb7c83182cabf8c1d80a5a3f719329ff0))
* **cms:** submit changed urls to indexnow from a reading setting ([794d75a](https://github.com/geekitycom/cms/commit/794d75afe68614736c110721f7e6958547c0b30c))
* **cms:** write dates and plurals in the site's locale ([bef1d76](https://github.com/geekitycom/cms/commit/bef1d7609740c5b91df54dfe8fd108e8f02fe307))
* **cms:** write dates inside an article in the post's language ([3329c0d](https://github.com/geekitycom/cms/commit/3329c0d62e20cf0132ce6d12b4565a2842764635))


### Bug Fixes

* **cms:** block meta's ai search and user-fetch crawlers under block-all ([a85dd45](https://github.com/geekitycom/cms/commit/a85dd45f5c85648908a16ea9aa3445800e6d5e68))
* **cms:** read an indieauth client's redirect uris from its link header ([bc80255](https://github.com/geekitycom/cms/commit/bc802554d6260bc616b933db072fedddbeffa805))

## [0.12.0](https://github.com/geekitycom/cms/compare/v0.11.0...v0.12.0) (2026-10-01)


### Features

* **cms:** restyle the default theme as paper on a compiled tailwind stylesheet ([7f97d47](https://github.com/geekitycom/cms/commit/7f97d4739c79d59e335b4519b6848f412774a964))
* **cms:** restyle the default theme as paper on a compiled tailwind stylesheet ([3288d82](https://github.com/geekitycom/cms/commit/3288d829c32142617d54b3cf26cedf1453d14eb8))

## [0.11.0](https://github.com/geekitycom/cms/compare/v0.10.0...v0.11.0) (2026-09-30)


### Features

* **cms:** add a skip link, visible focus rings and table captions to the admin ([550118e](https://github.com/geekitycom/cms/commit/550118e87410a14f46803f9bfc2fff0e0a49814d))
* **cms:** make the default theme hold up under forced colours, touch and right-to-left ([73ce796](https://github.com/geekitycom/cms/commit/73ce7968bdc50f768412d33fb65f6e80f35df0f9))
* **cms:** milestone M22 accessible by default ([16995d2](https://github.com/geekitycom/cms/commit/16995d2026ef6df9a5ef6e7822b5da7f60573db1))
* **cms:** store alt text in the media library and check it before publishing ([ec2750b](https://github.com/geekitycom/cms/commit/ec2750b9880b5d62ca05c2afb628623c71159ece))
* **cms:** tie form errors to their fields for assistive technology ([a8702d2](https://github.com/geekitycom/cms/commit/a8702d204369c16d106cea1dae9635aecc9aeffe))


### Bug Fixes

* **cms:** give untitled notes and replies an h1 on their page ([37a0039](https://github.com/geekitycom/cms/commit/37a0039f8756a111deb6a95d9ac8372832e33603))

## [0.10.0](https://github.com/geekitycom/cms/compare/v0.9.0...v0.10.0) (2026-09-30)


### ⚠ BREAKING CHANGES

* **cms:** createDeliveryService and createRelayService require an actorProfiles option, and FederationContextData carries actorProfiles.
* **cms:** CommentRecords requires dataDir, readComments takes the records instead of a content directory, and comment files no longer carry author.email or notify.

### Features

* **cms:** compress text responses with brotli and gzip ([ee3041e](https://github.com/geekitycom/cms/commit/ee3041ef38a6e5224220a1131c07c821ed44a832))
* **cms:** keep commenter emails out of content files ([a1f5e0a](https://github.com/geekitycom/cms/commit/a1f5e0a1754bd01e90c5f6531972311cc251f126))
* **cms:** milestone M21 fast by default ([b3b18f9](https://github.com/geekitycom/cms/commit/b3b18f9265b83912c6a18df0c798888f97599923))
* **cms:** prefetch same-origin pages and cross-fade between them ([943ec58](https://github.com/geekitycom/cms/commit/943ec58666e44a0a9c6e5ceb58648972c70f04b3))
* **cms:** serve fingerprinted theme assets with immutable caching ([2544e40](https://github.com/geekitycom/cms/commit/2544e4088aa3b7f2056cc4fe618ed87a4bbe357f))
* **cms:** show the admin bar on the public site for signed-in users ([9e66b64](https://github.com/geekitycom/cms/commit/9e66b644462c0e4e53ab2be1c4892f4df603d37c))
* **cms:** show the admin bar on the public site for signed-in users ([cc111de](https://github.com/geekitycom/cms/commit/cc111deb03c1fea7fb4ddcb0708c8796aa623a27))


### Bug Fixes

* **cms:** fetch the first image on a page eagerly at high priority ([20b0398](https://github.com/geekitycom/cms/commit/20b0398d9992546a822d30fe8c4f258038dfb43b))
* **cms:** name and picture every fediverse actor, not only followers ([53cfb38](https://github.com/geekitycom/cms/commit/53cfb384a21ca2c0d01084a6e0bc7891145386b7))
* **cms:** name the original's bytes in image variant URLs ([4dc920c](https://github.com/geekitycom/cms/commit/4dc920c692d89005470a570190446790f1de8f69))
* **cms:** pin the admin bar to the window edges whatever the theme pads ([8c30b2d](https://github.com/geekitycom/cms/commit/8c30b2d40ced3d06904625d1ca7a8f64d1316738))
* **cms:** validate post pages by the page they render ([b6f0271](https://github.com/geekitycom/cms/commit/b6f0271d91ed48e321d2b71b0c4bed2fb8e068c4))

## [0.9.0](https://github.com/geekitycom/cms/compare/v0.8.0...v0.9.0) (2026-09-29)


### ⚠ BREAKING CHANGES

* **cms:** under https the session cookie is renamed to __Host-geekity_session, so every signed-in user is signed out once after upgrading, with a notice on the login form.
* **cms:** ConversationContext now requires contentDir, so a direct caller of createConversation must pass the site's content directory.

### Features

* **cms:** harden the admin session cookie, cross-site checks and logout ([de7255f](https://github.com/geekitycom/cms/commit/de7255fda94b2d83ccdf3e3c3a92f9cc07cc1fc0))
* **cms:** remove commenter and contact data past retention, erase on request ([c35b3c4](https://github.com/geekitycom/cms/commit/c35b3c401442627fe947091a738ddadda5043bd4))
* **cms:** scaffold a starter privacy page linked from the footer ([ad7f05f](https://github.com/geekitycom/cms/commit/ad7f05fc0b97a04181a9ad1850b4c40d05ef8121))
* **cms:** send public security headers that do not constrain themes ([a5f9e66](https://github.com/geekitycom/cms/commit/a5f9e6609dd374d3f9b63f7f83525088aec5569d))
* **cms:** serve remote avatars from the site to keep readers private ([8916062](https://github.com/geekitycom/cms/commit/89160624f2954a9b2fdbf28e80b9528033df779a))
* **cms:** serve security.txt and change-password well-known urls ([4119d5f](https://github.com/geekitycom/cms/commit/4119d5f5ef86378b150d89ae7c075f7f2af9d274))
* **cms:** show approved fediverse quotes of a post as mentions ([685703b](https://github.com/geekitycom/cms/commit/685703b4d2ae576c1f8b2f48733c9c0a75d4d93f))

## [0.8.0](https://github.com/geekitycom/cms/compare/v0.7.0...v0.8.0) (2026-09-29)


### Features

* **cms:** add a maintenance mode that answers 503 with retry-after ([64c3a6c](https://github.com/geekitycom/cms/commit/64c3a6c301ffdf47ac8b3e985fc42d82dc591d14))
* **cms:** let mastodon users quote a post and approve the quote ([e216354](https://github.com/geekitycom/cms/commit/e21635433ce61baf2ec4aee2c95fb2c8a27b0721))
* **cms:** let mastodon users quote a post and approve the quote ([7276d4e](https://github.com/geekitycom/cms/commit/7276d4e41e94b81513547d81f66120d3ad6e31ed))
* **cms:** milestone M19 stable urls and graceful failure ([3f4fde9](https://github.com/geekitycom/cms/commit/3f4fde9db5682518978855ba6cd031772a05d6ea))
* **cms:** redirect a post or page's old URL when its slug or permalink changes ([a80da3e](https://github.com/geekitycom/cms/commit/a80da3e2fe285f725fc0918be3650fd1c0ff5542))
* **cms:** replace the admin bar's sign-in line with a hoopla account menu ([821eea4](https://github.com/geekitycom/cms/commit/821eea42f53e9e27f7ee1f05bf758ae1fe895870))
* **cms:** replace the admin bar's sign-in line with a hoopla account menu ([384ba2d](https://github.com/geekitycom/cms/commit/384ba2d491136b31b9b101ef971910b9259ef5c1))
* **cms:** serve a site's declared redirects and name the cms in x-redirect-by ([743b0a6](https://github.com/geekitycom/cms/commit/743b0a60961333b0ec08382fa9fecbef71b5665b))
* **cms:** serve a themed 500 page when a request fails ([9974aa5](https://github.com/geekitycom/cms/commit/9974aa535f076362b74e866958309d2bec87620e))


### Bug Fixes

* **cms:** give every post editor field the same width, height and look ([f4bd981](https://github.com/geekitycom/cms/commit/f4bd981e89fcbc94be857e382e19b4cfc737a346))
* **cms:** give every post editor field the same width, height and look ([5ac3430](https://github.com/geekitycom/cms/commit/5ac3430aae0323fad0da7bafb472feb0745199ee))

## [0.7.0](https://github.com/geekitycom/cms/compare/v0.6.0...v0.7.0) (2026-09-23)


### ⚠ BREAKING CHANGES

* **cms:** PostType gains 'reply', and themes should head a post with the new `named` context key instead of `postType != "note"`. in-reply-to leaves the loose front matter on the theme context and becomes inReplyTo.
* **cms:** the exported postArticle is renamed postObject and returns Article | Note.

### Features

* **cms:** a post federates as a note or an article by its discovered type ([6a800ac](https://github.com/geekitycom/cms/commit/6a800ace954215f0316eafb6bafd7ecad7a91fd6))
* **cms:** a post with no title is a note, on the page and in the feeds ([e0dbd54](https://github.com/geekitycom/cms/commit/e0dbd54f205e3af39e613ce075479fa4590da633))
* **cms:** a reply shows a preview of the post it answers ([825ec88](https://github.com/geekitycom/cms/commit/825ec886ddd81f70f1131b93794402d72bbbcd47))
* **cms:** an in-reply-to post is a reply on the page, in the fediverse and by webmention ([86aaaba](https://github.com/geekitycom/cms/commit/86aaabad13a3e48a7cb102d6c5ddb43830b0647b))
* **cms:** name a reply's target in atom and json feeds ([927b953](https://github.com/geekitycom/cms/commit/927b95383838df4d5c6377f4a9762e56341659b8))


### Bug Fixes

* **cms:** give federated posts a summary so mastodon shows more than a title ([d37005f](https://github.com/geekitycom/cms/commit/d37005f40fae02479efb441727dd07e1263e03e1))

## [0.6.0](https://github.com/geekitycom/cms/compare/v0.5.0...v0.6.0) (2026-09-20)


### ⚠ BREAKING CHANGES

* **cms:** a menu item stores `rel` in place of `me: true`, and a theme reads `item.rel` where it read `item.me` — a stored `me: true` is still read and rewritten as `rel` on the next save, so no site loses a flag. The package no longer exports `MENU_ITEM_FLAGS` or `MenuItemFlag`.

### Features

* **cms:** one command that publishes the tagged version to npm ([7a66eb7](https://github.com/geekitycom/cms/commit/7a66eb72f92d73686ee2799dba4ffff10d6c2258))
* **cms:** one link line everywhere, whose trailing words are rel values ([d866ac1](https://github.com/geekitycom/cms/commit/d866ac1fd176c48d6a6c4ba4ef0279206b3d09ac))


### Bug Fixes

* **cms:** check a profile link the way a menu line is checked ([20e7bed](https://github.com/geekitycom/cms/commit/20e7beda566a22f214ed2f17fdf23d83c5f00a61))
* **cms:** draw the At a glance counts on one line ([8ec000f](https://github.com/geekitycom/cms/commit/8ec000f2d6dbbfb730d048ddfd3bfc09dac82fbb))
* **cms:** read every nav as links at the page's size ([b8dec11](https://github.com/geekitycom/cms/commit/b8dec114896b723aba94d30111d717352d11714b))
* **cms:** start the dashboard's two panels at the same height ([faee9e2](https://github.com/geekitycom/cms/commit/faee9e2e05d335e61a06ed2d6b79e0bf06342671))

## [0.5.0](https://github.com/geekitycom/cms/compare/v0.4.0...v0.5.0) (2026-09-20)


### ⚠ BREAKING CHANGES

* **cms:** `ADMIN_TEMPLATES.settingsFederation` is now `ADMIN_TEMPLATES.federationSettings`, `SETTINGS_PAGES` no longer holds the Federation page (`ALL_SETTINGS_PAGES` does), and `/admin/settings/federation` is a 301 to `/admin/federation/settings` rather than a screen.
* **cms:** `SiteSettings.navigation` is replaced by `SiteSettings.menus`, `SettingsField` no longer includes `navigation`, `SETTINGS_FIELDS.navigation` is gone, and `settingsFromForm`'s second parameter is a `CarriedSettings` object rather than an array of taxonomy redirects. No stored file changes shape.
* **cms:** a site theme that relied on the packaged shell sees three changes. The footer no longer prints RSS or the site author's profile links, so a site that wants them types them into its footer menu — the starter site and the demo both do. `bioProfile` is gone: the bio prints the note and the links wherever it appears. `bioAuthor` is no longer a contract between a layout and base.njk, so an overriding layout can no longer lose the menu.
* **cms:** a site's menu moves from the `navigation` array in content/_data/site.json to a `menus` object keyed by name, and the old key is no longer read: what was `navigation` is now `menus.primary`. Templates read `menus`, keyed by name, in place of `menu`, and an Eleventy build reads `collections.menus` in place of `collections.menu`. A theme declares the menu areas it renders in its theme.json, so `Theme` carries a required `areas`.
* **cms:** the site menu is the navigation setting alone. A page's `navigation: true` and `navigationOrder` front matter no longer put it in the menu, and the page editor's Show in navigation checkbox and Menu order box are gone; type a `Label | URL` line into Settings > Reading instead, and `Home | /` for a page served as the front page. The keys are not stripped from existing files — they become ordinary unmodelled keys and round-trip untouched. The package no longer exports navigationPages, navigationOrder, NAVIGATION_KEY or NAVIGATION_ORDER_KEY, and navigationMenu no longer takes `pages`.

### Features

* **cms:** comment as yourself when you are signed in ([737a886](https://github.com/geekitycom/cms/commit/737a88616d3de315ba4132dca8e8a03937895fc9))
* **cms:** give every menu a screen of its own ([f20148e](https://github.com/geekitycom/cms/commit/f20148eab4e82d9082179f61d7e324372d7cd61b))
* **cms:** log one line per request ([2ff7944](https://github.com/geekitycom/cms/commit/2ff7944608589a29f987ab90b9c3068fece7ec19))
* **cms:** make a menu a named thing the theme asks for ([120190a](https://github.com/geekitycom/cms/commit/120190a428ef7838bb87a29c20dcfcfdad394603))
* **cms:** make the navigation setting the only source of the menu ([d7f5a3a](https://github.com/geekitycom/cms/commit/d7f5a3a76be9d0ace273be79a756662a1c95ee9d))
* **cms:** move federation's settings under Federation ([f79ae75](https://github.com/geekitycom/cms/commit/f79ae75ec502b78fbc14210d8f8eb49a0f7925e2))
* **cms:** put the menu in the header and the site's own links in the footer ([9639d4c](https://github.com/geekitycom/cms/commit/9639d4cc094ea24dfcc857ac63f70e369ce23171))
* **cms:** rebuild the content index from the admin ([a06633e](https://github.com/geekitycom/cms/commit/a06633ee31edd5a2b57b7e29471595bca66b2bbc))


### Bug Fixes

* **cms:** give the users listing the shape every other listing has ([4d4968a](https://github.com/geekitycom/cms/commit/4d4968a736f049720daac401a4858fd6cb7b9718))
* **cms:** put search in the starter menu and say how the menu works ([4711b1c](https://github.com/geekitycom/cms/commit/4711b1c5a447c19fd68e77f906a29cd4927854a7))
* **cms:** resolve the webfinger spellings a peer actually sends ([fec6981](https://github.com/geekitycom/cms/commit/fec69810575220912ef58f6b7745cf46f08b5cab))

## [0.4.0](https://github.com/geekitycom/cms/compare/v0.3.0...v0.4.0) (2026-09-20)


### ⚠ BREAKING CHANGES

* **cms:** ADMIN_TEMPLATES, which @geekity/cms exports, now names every template under pages/, layouts/ or components/, and its `users` and `user` keys are `usersList`, `usersNew` and `usersEdit`.
* **cms:** themeDir and GEEKITY_THEME_DIR are gone; a site's theme/ becomes themes/<name>/ with a theme.json, chosen by the theme setting in content/_data/site.json.
* **cms:** the site actor is gone and /ap/ is unregistered. The actorHandle, actorType and avatar settings and the site avatar upload are removed, followers move to content/_data/federation/{username}/followers.json, and the site actor's keys and followers are retired rather than migrated: a site that federated as the site actor starts again as its users. Follower, InboxActivity, the AdminStore follower methods, deliveryTargets, followersPage and delivery.updateActor changed signature; siteActor and ACTOR_CLASSES are replaced by userActor.
* **cms:** the template context's author is a profile object rather than the front-matter string, so a theme printing {{ author }} must move to {{ author.name }}. author and inbox are reserved top-level paths, so a site using either as a taxonomy base or permalink prefix must move. createRenderer takes a users resolver.
* **cms:** home.njk's title block and body slot change, Renderer gains frontPageSlugs and renderFrontPage, navigationPages takes a second argument, and /page/N/ under a static homepage redirects to the posts page instead of serving the listing.
* **cms:** /admin/settings no longer accepts the whole-settings form; each page posts its own fields to its own URL. The settings admin template is replaced by six under admin/layouts/settings/, and mountSettings, the AVATAR_, AKISMET_ and MAIL_ names and the panels are exported from their page modules.
* **cms:** AdminSection gains children and the top-level order changed; TAG_KIND.section and CATEGORY_KIND.section are now 'posts'; adding a user moved from POST /admin/users to POST /admin/users/new.
* **cms:** RSS subscribers of a post born on this CMS see it once more as new. Its guid was the old {baseUrl}/ap/posts/{slug} object id and is now the permalink, marked isPermaLink="true"; a post carrying an activitypub.id keeps that guid, marked isPermaLink="false". Atom's entry id and JSON Feed's item id print the same object id rather than the permalink, which moves only a post carrying a stored id. All three formats now list categories as well as tags, and all three summarise with the description if there is one and an excerpt of the body if there is not.
* **cms:** a post's ActivityStreams id is now its permalink, and the /ap/posts/{slug} route is gone. A post announced under the old id, and with no activitypub.id in its file, is a new object to its followers; its RSS guid moves with it. A post whose file names an activitypub.id keeps it. postObjectId, postObjectPath, POST_OBJECT_PATH and federatedObject left the public exports.
* **cms:** postConversation, postComments, siteComments, commentCounts, commentInteractions, interactionOf and the Comment and CommentContext types are no longer exported. Use createConversation, its thread, counts and latest members, spokenIn and feedComments.
* **cms:** Conversation gained a mentions group and counts.mentions, InteractionKind gained mention and repost, CommentAuthor gained a required avatar and CommentRecord a required url. Themes or embedders that construct these types or switch exhaustively on kind must change.
* **cms:** DeliveryService.redeliver(activityId) is replaced by resend(slug); REDELIVER_PATH, redeliveryMessage, OutboundActivity, NewOutboundActivity and the AdminStore outbound-activity methods are removed; NewDelivery requires activityType, objectId and slug; the admin route moves from /admin/federation/redeliver to /admin/federation/resend; the ap_outbound table is dropped.
* **cms:** AdminStore.countUsers, listUsers, getUser, getUserById, createUser, verifyPassword, setPassword and deleteUser are removed in favour of file-backed functions exported from the admin module; User, StoredUser, CreateUserInput and DuplicateUsernameError move with them; the users table no longer exists.
* **cms:** loadActorKeyPairs takes the data directory instead of the admin store; AdminStore.listActorKeys and putActorKey and the ActorKey and NewActorKey types are removed; ACTOR_KEY_ALGORITHMS and ActorKeyAlgorithm move to the federation module; the actor_keys table no longer exists.
* **cms:** seedSiteSettings, writeSiteSettings, storeSiteSettings, settingsSiteData and the SiteSettingsSource renderer option are removed; readSiteSettings takes the content directory instead of the admin store, and the settings table no longer exists.
* **cms:** the theme `date` filter's `readable`, `html` and `year` formats render in the site's timezone instead of UTC; `iso` is unchanged.
* **cms:** `/feed.xml` and `/feed.json` are gone without redirects; `FEED_FILES` is replaced by `FEED_SEGMENTS`, `FeedFormat` gains `rss`, and `feedHref` takes a taxonomy term instead of a tag.
* **cms:** `TAG_SEGMENT` and `CATEGORY_SEGMENT` are replaced by `DEFAULT_TAXONOMY_BASES`; `termHref`, `tagHref`, `categoryHref` and `feedHref` take the bases as a required trailing argument, and `partials/tags.njk` must be imported `with context`.

### Features

* **cms:** a shipped front page with recent posts, and archive pages by month ([6d7fa55](https://github.com/geekitycom/cms/commit/6d7fa55582212ae1324dbb5b7b63c3ee60bf0288))
* **cms:** accept native comments with moderation, per-post switch and auto-close ([9b917d7](https://github.com/geekitycom/cms/commit/9b917d7ec08f856845eed72f2b030e60d9fccebf))
* **cms:** add a /healthz health check that answers 503 when the site cannot serve ([67c3447](https://github.com/geekitycom/cms/commit/67c34476488566137ce40d266a61e2e1cea1ad1b))
* **cms:** add a media screen that lists, uploads and deletes files under content/uploads ([3302381](https://github.com/geekitycom/cms/commit/3302381ea18e38482c3900ba5501e226d052c60d))
* **cms:** add categories as a second taxonomy alongside tags ([7b87811](https://github.com/geekitycom/cms/commit/7b87811ced65249444a97507abb96aef72a1dc18))
* **cms:** advertise an rssCloud/WebSub notify server and ping it on publish ([1580240](https://github.com/geekitycom/cms/commit/1580240a0e592eafaffc937c5c7cf5aa93dd844e))
* **cms:** appearance screen that lists the site's themes and activates one ([dac3d83](https://github.com/geekitycom/cms/commit/dac3d835a7bc4117c217d35ef3afe7a6e5f69c64))
* **cms:** batch pending-comment notices into an hourly or daily digest ([8da199f](https://github.com/geekitycom/cms/commit/8da199fc69e1961f6228a2d28ffd6e82f56bf9c9))
* **cms:** check native comments and webmentions with Akismet when a key is set ([a172e70](https://github.com/geekitycom/cms/commit/a172e70d6468d6daf9efed220895b4e4438f0a30))
* **cms:** choose what the homepage displays, with an optional posts page ([f87ebab](https://github.com/geekitycom/cms/commit/f87ebabe419ad7f835fbd2af47f24355be95553b))
* **cms:** derive image variants with sharp and render uploads as responsive pictures ([744823b](https://github.com/geekitycom/cms/commit/744823b91a6ace572278c3cc0d238cc28baa75f1))
* **cms:** email moderators about pending comments and commenters about replies ([a29dac0](https://github.com/geekitycom/cms/commit/a29dac0f01f09bf1db8e7e75b423787d0bfecdfd))
* **cms:** federate posts under their permalink ([323b704](https://github.com/geekitycom/cms/commit/323b7047cc9bdcc48c3ede95deb91599ded85dc6))
* **cms:** full-text search over posts and pages ([4238216](https://github.com/geekitycom/cms/commit/42382165b813f5260e6797ac58269eaa418b115b))
* **cms:** full-text search over posts and pages ([c440807](https://github.com/geekitycom/cms/commit/c44080780296cbfcf9c24b2bd42b8a587fe9086c))
* **cms:** give each user an edit page of their own ([baee3d8](https://github.com/geekitycom/cms/commit/baee3d8c017b3bf61a7fbaa9021b14118a7be823))
* **cms:** give every admin section children and mark the landing child ([c837c14](https://github.com/geekitycom/cms/commit/c837c14b361b9505f7475d84605f5759aabe3ff7))
* **cms:** give every user a profile, an archive and feeds at /author/{username}/ ([6033ff3](https://github.com/geekitycom/cms/commit/6033ff3c2d27485e21625bcee465044ae9b5a1d0))
* **cms:** highlight code on the client with a self-hosted highlight.js bundle ([3997746](https://github.com/geekitycom/cms/commit/3997746b6c9108f107a0971911f991695338d916))
* **cms:** hold future-dated posts as scheduled and publish them on time ([aa14180](https://github.com/geekitycom/cms/commit/aa14180e66884bd2a88bf7845329b9b1ef6b9aa3))
* **cms:** honour a user's stored actor id, and serve them under it ([b917173](https://github.com/geekitycom/cms/commit/b917173c8de64bb238555f961c68b5999065e86f))
* **cms:** import a WordPress ActivityPub actor's keys, ids and followers ([ecb8612](https://github.com/geekitycom/cms/commit/ecb86127c85b03981b7c200ca8124a27998aeaed))
* **cms:** keep the actor's key pairs as JWK files under data/keys ([799192b](https://github.com/geekitycom/cms/commit/799192bf7eb47b9591ae484fa57c14df6b40feee))
* **cms:** keep users in data/users.json and treat sessions as a cache ([dbf3952](https://github.com/geekitycom/cms/commit/dbf3952a41ffd409d8dbff103185ad66c81def5b))
* **cms:** key every feed by the post's object id, with one set of terms and one summary ([bbd992f](https://github.com/geekitycom/cms/commit/bbd992ff348385040f9d992ea73cd47ea40e9ca3))
* **cms:** listings as an h-feed of feed items with excerpt, date and categories ([c8ffdfc](https://github.com/geekitycom/cms/commit/c8ffdfc1ed52236f4322bc7df3390cd47068eb86))
* **cms:** make content/_data/site.json the source of truth for settings ([6639a82](https://github.com/geekitycom/cms/commit/6639a82af9e44781a23666a7ae3dca17443a7687))
* **cms:** make every user an actor at their author URL ([ba8db33](https://github.com/geekitycom/cms/commit/ba8db330011ea29dd75b4f7e564ddbce946b7e8d))
* **cms:** make tag and category bases settings defaulting to /tag/ and /category/ ([c285ab8](https://github.com/geekitycom/cms/commit/c285ab823ec5d65f7ed39c63963302f7851bbedd))
* **cms:** manage tags and categories with rename, merge and delete ([9bf6cab](https://github.com/geekitycom/cms/commit/9bf6caba92be50082ffc06b24d3430370cbc37bc))
* **cms:** meta tags, icons from the site avatar and a JSON-LD graph in the head ([04eaab4](https://github.com/geekitycom/cms/commit/04eaab4eaac6649c90c5d10d33bc8dbe93b29628))
* **cms:** milestone M15 default theme ([2abb7cb](https://github.com/geekitycom/cms/commit/2abb7cb340f64d0b608f8b8d9f0fd28737995119))
* **cms:** milestone M16 docker distribution ([e35f728](https://github.com/geekitycom/cms/commit/e35f7281db1a575abd8783a6089242c26f09f0e4))
* **cms:** name a site's themes and choose one in site.json ([52fc56b](https://github.com/geekitycom/cms/commit/52fc56b791d476c69a3e189f5e9cd817bb4f0e7b))
* **cms:** page shell and stylesheet in the andrewshell.org design ([e266156](https://github.com/geekitycom/cms/commit/e266156669046c891baeec84c8f6a343a3bdef37))
* **cms:** post and page as the blog-post entry with a bio h-card ([e7f1c33](https://github.com/geekitycom/cms/commit/e7f1c338b1d08a73283d8e2160f6dbf66a1c9ccd))
* **cms:** publish followers and the inbox log as files under content/_data/federation ([0a81e2f](https://github.com/geekitycom/cms/commit/0a81e2f0acbf904fef3102705fe0fe8b55adc980))
* **cms:** put the site author, a summary, neighbours and recent posts on the context ([9ffa962](https://github.com/geekitycom/cms/commit/9ffa9620d820314d0b744fd782c098203eff6955))
* **cms:** reactions as facepiles and comments in the source markup ([9429be8](https://github.com/geekitycom/cms/commit/9429be8db71729a21bda43e2ab65756cc7ca3fe4))
* **cms:** read every conversation through one Conversation module ([67af02c](https://github.com/geekitycom/cms/commit/67af02cf13c016e65893d15a18a2c682a31247b0))
* **cms:** rebuild the database from the files on boot and add geekity rebuild ([b0961a3](https://github.com/geekitycom/cms/commit/b0961a31615ba06e97f5b5f7edcd507f9c84cf4e))
* **cms:** recover a forgotten password by email ([c387b99](https://github.com/geekitycom/cms/commit/c387b990aeeaa53ce0d5bf222b59a0c513ab100d))
* **cms:** remove the quick draft from the dashboard ([1b740e8](https://github.com/geekitycom/cms/commit/1b740e886e85f472f762e09f6ea26754d58d5a34))
* **cms:** render a site menu from a navigation setting and opted-in pages ([8689ec0](https://github.com/geekitycom/cms/commit/8689ec0648243bd0b593a5750cd691306de2a677))
* **cms:** resend the current state of a post instead of replaying a stored activity ([8022695](https://github.com/geekitycom/cms/commit/8022695596c56378b14f8381b3a00964916a51e6))
* **cms:** seed an empty content directory with the starter site on serve when asked to ([86ef55d](https://github.com/geekitycom/cms/commit/86ef55d8614731ba4933d4f3e918e7afe02860bc))
* **cms:** send email through a mail service with Brevo and SMTP providers ([a708da8](https://github.com/geekitycom/cms/commit/a708da800e5052e749d4e0d6cb3f2429780d5354))
* **cms:** send webmentions on publish and receive them into the comment thread ([1ec1e04](https://github.com/geekitycom/cms/commit/1ec1e0452749b3cc081345c43be07d21b250756a))
* **cms:** serve comments feeds built from ActivityPub replies ([411ce38](https://github.com/geekitycom/cms/commit/411ce380b36e85f956901342a2c81ed4e1d0f375))
* **cms:** serve sitemap.xml and robots.txt ([9ff6509](https://github.com/geekitycom/cms/commit/9ff65099c55e7b56370da3444690fe5da54e5a95))
* **cms:** serve the WordPress ActivityPub paths behind a switch ([e4752b5](https://github.com/geekitycom/cms/commit/e4752b54de9c90134de8d4c65ad780bb08116919))
* **cms:** serve WordPress feed URLs with RSS 2.0 at /feed/ ([243d584](https://github.com/geekitycom/cms/commit/243d584f20bbbd1d08f8667b6b53277b177fc32c))
* **cms:** show fediverse replies, likes and boosts under a post ([8bb757d](https://github.com/geekitycom/cms/commit/8bb757d8f835cb18e31d3850b1e466b84d681c9a))
* **cms:** split the settings screen into six pages under Settings ([44156ef](https://github.com/geekitycom/cms/commit/44156ef2bb5dfcca8304c16d38492a3f7c3af1a9))
* **cms:** store dates as UTC instants and render them in the site's timezone ([176ae94](https://github.com/geekitycom/cms/commit/176ae942192dceb864d6661eecddaf05d0dcdbaf))
* **cms:** style the comments and messages screens ([ef48c10](https://github.com/geekitycom/cms/commit/ef48c108e12807374e9163253e570e745c7d9eff))
* **cms:** subscribe to Mastodon-style relays and deliver public activities to them ([9544068](https://github.com/geekitycom/cms/commit/9544068550c5cfbb7d33fd803c5d0b5f7e61898e))
* **cms:** take messages from a contact form on a page ([8505b4d](https://github.com/geekitycom/cms/commit/8505b4d1b6cfbaa7bc693259d2c586c457b2d43b))
* **cms:** throttle admin sign-ins and send security headers ([b264819](https://github.com/geekitycom/cms/commit/b26481935541e5f5532992ab343f0562bc09316d))
* **release:** add a script that builds and pushes the multi-arch docker image to ghcr.io ([6e7f501](https://github.com/geekitycom/cms/commit/6e7f501a6c9b80e0cfab7538aed618956b8a17db))


### Bug Fixes

* **cms:** drop the divider above the first settings heading ([b791b27](https://github.com/geekitycom/cms/commit/b791b275fab81966603d43358be30d1ec7566b91))
* **cms:** head the notice switches with whose they are, and hide them until there is an address ([22fd644](https://github.com/geekitycom/cms/commit/22fd644a7dc43554bc34feebfeb48e6a7a08ea27))
* **cms:** keep the notice switches back until the site can send mail ([6e357d2](https://github.com/geekitycom/cms/commit/6e357d2f253508e643c22902fd1205e833faf65e))
* **cms:** notice a same-size rewrite of site.json inside one clock tick ([dc65434](https://github.com/geekitycom/cms/commit/dc65434f2ab00196cca32f8ea1e9c52913455d12))
* **cms:** notice a site.json rewrite inside one mtime tick ([e09dc81](https://github.com/geekitycom/cms/commit/e09dc815dbe62d7794f84f9d070c0c9199ab8323))
* **cms:** release a scheduled post whose moment passed while it was saved ([368bdf0](https://github.com/geekitycom/cms/commit/368bdf0e43f81ad6ff6ba5a41eadc6eecceebb52))
* **cms:** render each editor preview into a fresh iframe ([daa18d5](https://github.com/geekitycom/cms/commit/daa18d53f07b6f0dc6fffccacef5b16f62020e20))
* **cms:** show only the chosen provider's mail credential fields ([add3f08](https://github.com/geekitycom/cms/commit/add3f086be74d4b8f48bd0a6911db25e48c89ea7))
* **cms:** stop the default theme heading the home page twice ([aa4dfe3](https://github.com/geekitycom/cms/commit/aa4dfe356a796b4c71855b97ed8e1973e10a62f1))
* **cms:** write the admin's form fields out of one macro ([30d3ac5](https://github.com/geekitycom/cms/commit/30d3ac518e749f90382b1a4ec39cc1c4e86f7190))


### Code Refactoring

* **cms:** reorganize the admin templates into pages, layouts and components ([b01c762](https://github.com/geekitycom/cms/commit/b01c76214b53f03923069903d00e8974522dad81))

## [0.3.0](https://github.com/geekitycom/cms/compare/v0.2.0...v0.3.0) (2026-09-03)


### Features

* **cms:** add a site avatar that serves as the actor icon ([bb65c11](https://github.com/geekitycom/cms/commit/bb65c11e15bfaaf1beb1891886267b4f8f6d27bc))
* **cms:** add fedify site actor with key pairs, webfinger, and nodeinfo ([f4870d9](https://github.com/geekitycom/cms/commit/f4870d9ece032a6036f96a80ca3c0ae79f48f73f))
* **cms:** add the admin federation screen with redeliver ([13ee727](https://github.com/geekitycom/cms/commit/13ee72723f963984aac07a19fc33dff51985cbd4))
* **cms:** deliver create, update, and delete for posts to followers ([83310c0](https://github.com/geekitycom/cms/commit/83310c0f068dbcc5c9d06d8ad0f2123a9f2506d4))
* **cms:** handle follows in the inbox and serve followers from sqlite ([e7f4808](https://github.com/geekitycom/cms/commit/e7f4808746b4cf8c4f08ae273acbe15e1dca1fc2))
* **cms:** serve posts as activitystreams articles and page the outbox ([3d0de4b](https://github.com/geekitycom/cms/commit/3d0de4bdef01860fdca2f20a92468781e11b733d))

## [0.2.0](https://github.com/geekitycom/cms/compare/v0.1.1...v0.2.0) (2026-09-03)


### Features

* **cms:** add admin auth with users, sessions, login, setup, and csrf ([7d5a6e3](https://github.com/geekitycom/cms/commit/7d5a6e301baa3c45cd036f0775f450e6412c37ad))
* **cms:** add geekity user add to create an admin from the cli ([4f63116](https://github.com/geekitycom/cms/commit/4f6311616ae08708e9762688c8fc0c4338349e42))
* **cms:** add the admin shell and dashboard ([c9a3d62](https://github.com/geekitycom/cms/commit/c9a3d620d885f4d8358b03a8362822957d6c92fb))
* **cms:** add the pages list and editor ([5bc0ca2](https://github.com/geekitycom/cms/commit/5bc0ca21fdb3f21fba9df19c38a1d1b8cd6911de))
* **cms:** add the posts list and editor with trash and restore ([91453c5](https://github.com/geekitycom/cms/commit/91453c5af0d68912bcda97ff3fb40c99f626949f))
* **cms:** add the settings screen with a site.json mirror ([dc87d24](https://github.com/geekitycom/cms/commit/dc87d2431783e24a2d75e0dbc056383d09b61f5d))
* **cms:** add the users screen with add, change password, and delete ([6789aee](https://github.com/geekitycom/cms/commit/6789aee17f18eed5af0728fc067aaf7fffda9cd8))
* **cms:** enhance the editor with codemirror, preview, and uploads ([de957fc](https://github.com/geekitycom/cms/commit/de957fc6e82fe43f6722d9373148fd5efc3087cd))

## [0.1.1](https://github.com/geekitycom/cms/compare/v0.1.0...v0.1.1) (2026-09-03)


### Bug Fixes

* **cms:** require node 24, move to pnpm 11, and write pnpm settings for new sites ([1de00b3](https://github.com/geekitycom/cms/commit/1de00b31a24b4ab6851cb3e8d6f115b5f8e94ac2))

## 0.1.0 (2026-09-03)


### Features

* **cms:** add public api hooks and geekity init and sync commands ([9fb7c4e](https://github.com/geekitycom/cms/commit/9fb7c4ef0369f97a206e5d8bc5f539c705a8d669))
* **cms:** add sqlite content index with typed query api ([704b99b](https://github.com/geekitycom/cms/commit/704b99b03877f37ad434a16cbcf00806b30c7353))
* **cms:** build the m1 foundation ([cc0bff2](https://github.com/geekitycom/cms/commit/cc0bff24756fc41db35f3868b8cfc532c456eaaf))
* **cms:** negotiate html, markdown, and json for every content url ([a8adc48](https://github.com/geekitycom/cms/commit/a8adc48fd152a21b6f6b8fcdca4b185a9ce7afd0))
* **cms:** parse and write 11ty-compatible markdown documents ([6f65d14](https://github.com/geekitycom/cms/commit/6f65d14635afe1e1181cdccf5e6b0751f8aefdef))
* **cms:** render the public site with a default nunjucks theme ([dabfa06](https://github.com/geekitycom/cms/commit/dabfa065addd28325c6c06ac0174ff9e5a0bbcf6))
* **cms:** serve atom and json feeds for posts ([d7836a8](https://github.com/geekitycom/cms/commit/d7836a870c03a8eabd0dbfe3eb2359ed67fba9cc))
* **cms:** sync the content directory into the index on boot and on change ([400660a](https://github.com/geekitycom/cms/commit/400660aadc455b322a7d3c7c8f558a58b35f71e6))
