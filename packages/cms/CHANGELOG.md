# Changelog

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
