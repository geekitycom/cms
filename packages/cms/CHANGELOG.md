# Changelog

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
