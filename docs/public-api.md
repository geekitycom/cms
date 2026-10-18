# The package API

`@geekity/cms` has four entry points:

- `@geekity/cms` is for a site's own code: a `server.ts` entry file and its
  tests. This page lists everything it exports.
- `@geekity/cms/config` is for a site's `geekity.config.ts`. It exports
  `defineConfig` and the config types from the root entry without loading the
  rest of the CMS. [Configuration](configuration.md) describes it.
- `@geekity/cms/plugin` is for plugins. [Plugins and hooks](plugins.md#writing-a-plugin)
  describes it.
- `@geekity/cms/testing` is for a plugin's tests. It exports parts of the
  host that a test builds on its own. [Testing a plugin](plugins.md#testing-a-plugin)
  lists them. It is not covered by semantic versioning.

Every name on this page is covered by semantic versioning. Anything the package
does not export is internal and can change in any release. The CLI imports its
modules directly and does not use this list.

A name is exported for one of two reasons. Either a site, the demo app, a
published plugin or a page of these docs imports it, or it is a type that the
signature of such an export uses. For example, `createCms` returns a `Cms`, and
`cms.store` is a `ContentStore`, so both types are exported.

`src/public-api.test.ts` compares the root entry with the tables on this page.
To add an export, add it to `src/exports.ts` and add its row here. Removing a
name is a breaking change.

`src/documented-uses.test.ts` repeats the feed examples in [Feeds](feeds.md)
and calls the image helpers in [Media](media.md), importing them only from the
root entry. It seeds its comment with `addComment` from `@geekity/cms/testing`. When you change one of those examples, change the test with it.

## Creating a site

| Export                 | Kind     | What it is                                                                                                                                                                                    |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createCms`            | function | Build a CMS around a site's config, or around one `resolveConfig` already resolved, which is used as it is.                                                                                   |
| `defineConfig`         | function | Identity helper that gives a `geekity.config.ts` file type checking and completion without the site importing the type by hand.                                                               |
| `resolveConfig`        | function | Merge a site's config with environment overrides and defaults.                                                                                                                                |
| `settleConfig`         | function | Resolve a config and take the base URL from the site's settings when the environment and the config file set none. `geekity` does this; a site that calls `createCms` itself awaits it first. |
| `Cms`                  | type     | A running (or runnable) CMS instance.                                                                                                                                                         |
| `DocumentChangeHook`   | type     | Something a site wants to happen when the index changes.                                                                                                                                      |
| `FederationOverrides`  | type     | The federation stores and guards a site may swap through its config.                                                                                                                          |
| `GeekityConfig`        | type     | What a site writes in `geekity.config.ts`.                                                                                                                                                    |
| `GeekityEnv`           | type     | The Hono environment of `cms.app`: what a route handler reads from `c.var`.                                                                                                                   |
| `IndexNowOverrides`    | type     | The IndexNow pieces a site may swap.                                                                                                                                                          |
| `JobOverrides`         | type     | The admin job queue's transport and record store, which a site may swap through its config, and the jobs it adds.                                                                             |
| `MailOverrides`        | type     | The mail pieces a site may swap.                                                                                                                                                              |
| `ResolveConfigContext` | type     | Ambient inputs `resolveConfig` reads, injectable so the resolution is testable.                                                                                                               |
| `ResolvedConfig`       | type     | A `GeekityConfig` with every field filled in and every path absolute, frozen.                                                                                                                 |
| `ServeContext`         | type     | What `geekity serve` hands the CMS it runs, beyond the site's config.                                                                                                                         |

## Documents

| Export                    | Kind     | What it is                                                                                                    |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `defaultPermalink`        | function | The permalink the admin form proposes for a new document.                                                     |
| `DuplicatePermalinkError` | class    | Thrown when two live files claim the same permalink.                                                          |
| `parseDocument`           | function | Parse the text of a Markdown file into a `Document`.                                                          |
| `renderMarkdown`          | function | Render a Markdown body to the HTML the site and the feeds serve.                                              |
| `serializeDocument`       | function | Turn a Document back into the text of its Markdown file.                                                      |
| `slugify`                 | function | Turn a title into a URL slug: lowercase ASCII letters, digits and hyphens.                                    |
| `ActivityPubMetadata`     | type     | Everything about how a post federates, whether its author wrote it or the CMS wrote it back after a delivery. |
| `ChangeOrigin`            | type     | Where a change came from.                                                                                     |
| `Clock`                   | type     | Where the CMS reads the time from, for every timestamp it stores or sends.                                    |
| `ContentEventListener`    | type     | A listener for one kind of change.                                                                            |
| `ContentEventMap`         | type     | The events a subscriber can listen for, and what each one carries.                                            |
| `ContentEvents`           | type     | Subscription to index changes.                                                                                |
| `ContentStore`            | type     | The derived index over the Markdown files.                                                                    |
| `DefaultPermalinkInput`   | type     | What `defaultPermalink` needs to know about a document.                                                       |
| `Document`                | type     | One Markdown file, parsed.                                                                                    |
| `DocumentChange`          | type     | One change to the index, as the subscriber sees it.                                                           |
| `DocumentChangeType`      | type     | What happened to one document.                                                                                |
| `DocumentContent`         | type     | The part of a `Document` that a file is written from.                                                         |
| `DocumentType`            | type     | Posts are dated and syndicated; pages are standing content.                                                   |
| `ParseDocumentOptions`    | type     | Where the file came from, which is what tells a post from a page.                                             |
| `Scheduler`               | type     | Publishes a document when its date arrives.                                                                   |
| `SearchHit`               | type     | One document a search found, and the passage it was found in.                                                 |
| `SyncResult`              | type     | What a full scan did.                                                                                         |
| `WatchDebounce`           | type     | How the content watcher waits for a changed file to stand still: the `watchDebounce` config option.           |

## Rendering, feeds and conversations

| Export                  | Kind     | What it is                                                                                                                                                                                                             |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atomFeed`              | function | One feed as an Atom 1.0 document.                                                                                                                                                                                      |
| `commentsRssFeed`       | function | One comments feed as an RSS 2.0 document.                                                                                                                                                                              |
| `createConversation`    | function | The reader over one site's two indexes.                                                                                                                                                                                |
| `createRenderer`        | function | Build the renderer that turns documents and listings into pages of the site's theme.                                                                                                                                   |
| `feedComments`          | function | Interactions as a comments feed carries them: newest first, at most `limit`, and every link absolute.                                                                                                                  |
| `frontPageSlugs`        | function | Which page is the front page and which carries the listing, from the site data.                                                                                                                                        |
| `isListed`              | function | Whether the site lists a document: served, and not unlisted.                                                                                                                                                           |
| `isServed`              | function | Whether the public site serves a document: not a draft, its date has arrived, and its visibility is recognised.                                                                                                        |
| `jsonFeed`              | function | One feed as a JSON Feed 1.1 document.                                                                                                                                                                                  |
| `PACKAGED_THEME_DIR`    | constant | The theme that ships inside the package, resolved from this module rather than from the working directory, so it is found whether the CMS is running from `src/` under tsx or from `dist/` as an installed dependency. |
| `rssFeed`               | function | One feed as an RSS 2.0 document.                                                                                                                                                                                       |
| `sanitizeCommentHtml`   | function | A stranger's HTML, reduced to markup this site is willing to republish.                                                                                                                                                |
| `spokenIn`              | function | What a post's comments feed carries, at every depth and in no order.                                                                                                                                                   |
| `AuthorContext`         | type     | What a theme is given as `author`, on a post and on an archive alike.                                                                                                                                                  |
| `CommentFeedSource`     | type     | Everything one comments feed is built from.                                                                                                                                                                            |
| `Conversation`          | type     | Everything under one post.                                                                                                                                                                                             |
| `ConversationContext`   | type     | What reading a conversation needs: both indexes and the site's origin.                                                                                                                                                 |
| `ConversationReader`    | type     | The three questions anything showing a conversation asks.                                                                                                                                                              |
| `ConversationSite`      | type     | The site settings a conversation is read with: the title and author a post with no author is by, and the comment policy.                                                                                               |
| `CreateRendererOptions` | type     | How to build a `Renderer`.                                                                                                                                                                                             |
| `FeedComment`           | type     | One comment, as a feed shows it.                                                                                                                                                                                       |
| `FeedSource`            | type     | Everything one feed is built from, whichever format it ends up in.                                                                                                                                                     |
| `FrontPageSlugs`        | type     | WordPress's Reading choice, as `site.json` spells it.                                                                                                                                                                  |
| `Interaction`           | type     | One thing somebody did to a post: a reply, a like or a boost.                                                                                                                                                          |
| `InteractionAuthor`     | type     | Who wrote something, as much as the site knows.                                                                                                                                                                        |
| `InteractionCounts`     | type     | How many of each a conversation holds.                                                                                                                                                                                 |
| `InteractionKind`       | type     | What an interaction is.                                                                                                                                                                                                |
| `InteractionSource`     | type     | Where an interaction came from.                                                                                                                                                                                        |
| `InteractionStatus`     | type     | Where an interaction stands with the moderator.                                                                                                                                                                        |
| `JsonFeed`              | type     | A JSON Feed 1.1 document.                                                                                                                                                                                              |
| `JsonFeedAttachment`    | type     | A file that goes with an item, as JSON Feed 1.1 models one.                                                                                                                                                            |
| `JsonFeedAuthor`        | type     | An author, as JSON Feed 1.1 models one.                                                                                                                                                                                |
| `JsonFeedGeekity`       | type     | The `_geekity` extension on a `JsonFeedItem`.                                                                                                                                                                          |
| `JsonFeedHub`           | type     | A real-time endpoint, as JSON Feed 1.1 models one.                                                                                                                                                                     |
| `JsonFeedItem`          | type     | One entry of a `JsonFeed`.                                                                                                                                                                                             |
| `Listing`               | type     | A listing of documents, ready to render.                                                                                                                                                                               |
| `NavigationItem`        | type     | One entry of a menu, as `site.json` and the settings screen spell it.                                                                                                                                                  |
| `NavigationMenus`       | type     | Every menu one site stores, by name.                                                                                                                                                                                   |
| `Pagination`            | type     | Where one listing page sits in the sequence.                                                                                                                                                                           |
| `Placed`                | type     | Something said in a conversation, with the reply it sits under: what the comments feeds name as what it answers.                                                                                                       |
| `PublishedProfileLink`  | type     | One of a profile's links as a theme prints it.                                                                                                                                                                         |
| `Renderer`              | type     | The HTML side of the public site: everything that turns a document or a listing into a page of the theme.                                                                                                              |
| `RepliesOf`             | type     | What one `/replies/` feed is about, and what is in it.                                                                                                                                                                 |
| `SearchPage`            | type     | One page of search results, ready to render.                                                                                                                                                                           |
| `SiteData`              | type     | Site-wide data, from `content/_data/site.json` when the site has one.                                                                                                                                                  |
| `SiteInteraction`       | type     | One interaction with the post it is about, which a site-wide list needs.                                                                                                                                               |
| `StaticAsset`           | type     | A file on disk, located and described, ready to be served.                                                                                                                                                             |
| `Taxonomy`              | type     | Which taxonomy an archive is over.                                                                                                                                                                                     |
| `TaxonomyBases`         | type     | The URL segment each taxonomy's archives live under.                                                                                                                                                                   |
| `TaxonomyRedirect`      | type     | One term that was renamed, and what it was renamed to.                                                                                                                                                                 |

## Images

| Export                  | Kind     | What it is                                                                                                            |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `describeImage`         | function | What is known about one upload's variants, or `undefined` when nothing is.                                            |
| `findImageVariant`      | function | Find one derived file by its request path, generating it if it is not there.                                          |
| `generateImageVariants` | function | Derive every variant of one upload and record what was derived.                                                       |
| `removeImageVariants`   | function | Take one upload's derived files away.                                                                                 |
| `responsiveImages`      | function | Rewrite every uploaded image in a fragment of HTML as a `<picture>`.                                                  |
| `siteIcons`             | function | The icons the head of a site whose icon setting is this links, or none at all.                                        |
| `siteImageMarkup`       | function | The same rewrite, over one site's own derived images.                                                                 |
| `DescribedImage`        | type     | A record as a page renders it: what was derived, and the hash of the original's bytes that every derived URL carries. |
| `DescribeImage`         | type     | What the markup asks about an upload.                                                                                 |
| `ImageConfig`           | type     | The part of the config the derived images are derived according to.                                                   |
| `ImageLoading`          | type     | How a fragment's images are fetched.                                                                                  |
| `ImageRecord`           | type     | What was derived from one upload, and the intrinsic size of the upload itself.                                        |
| `ImageVariant`          | type     | One derived copy of an upload.                                                                                        |
| `SiteIcon`              | type     | One icon as the head links it.                                                                                        |

## Users, settings and comments

| Export               | Kind     | What it is                                                                                                  |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `CONTACT_FIELDS`     | constant | The fields the contact form submits.                                                                        |
| `CONTACT_POST_PATH`  | constant | Where the contact form posts, under the CMS's own prefix.                                                   |
| `createUser`         | function | Hash the password and add the user to the file.                                                             |
| `listUsers`          | function | Every user, by name, without password hashes.                                                               |
| `SITE`               | constant | The `site` settings namespace, for `cms.settings.values(SITE)` and `cms.settings.get(SITE.title)`.          |
| `setUserProfile`     | function | Write a user's profile, replacing whatever was there.                                                       |
| `CommentAuthor`      | type     | Who wrote a comment, as much as the site knows.                                                             |
| `CommentChecker`     | type     | A third-party opinion on comments: the one seam anything like Akismet plugs into.                           |
| `CommentContent`     | type     | What a comment says, in both the forms the site keeps.                                                      |
| `CommentFormContext` | type     | The comment form as a template receives it.                                                                 |
| `CommentKind`        | type     | One of `COMMENT_KINDS`.                                                                                     |
| `CommentNotices`     | type     | Whoever is told about a comment that has just been written.                                                 |
| `CommentProblems`    | type     | What a form got wrong, one message per field.                                                               |
| `CommentRecord`      | type     | One comment, as its post's file under `content/_data/comments/` holds it.                                   |
| `CommentRecords`     | type     | What every writer here needs: the files it owns, and the index over them.                                   |
| `CommentReport`      | type     | What a stored comment's later reclassification tells the checker.                                           |
| `CommentSource`      | type     | One of `COMMENT_SOURCES`.                                                                                   |
| `CommentStatus`      | type     | One of `COMMENT_STATUSES`.                                                                                  |
| `CommentSubmission`  | type     | Everything a checker is told about a comment on its way in.                                                 |
| `CommentVerdict`     | type     | What a checker can say.                                                                                     |
| `CommentViewer`      | type     | Who the site knows is commenting, when a valid session says so.                                             |
| `ContactFormContext` | type     | The contact form as a template receives it.                                                                 |
| `ContactProblems`    | type     | What a form got wrong, one message per field.                                                               |
| `CreateUserInput`    | type     | What `createUser` is given.                                                                                 |
| `Delivery`           | type     | How one attempt to deliver one activity to one recipient ended, and what the activity was.                  |
| `DeliveryStatus`     | type     | One of `DELIVERY_STATUSES`.                                                                                 |
| `PostComment`        | type     | A `CommentRecord` with the post it is on.                                                                   |
| `ProfileLink`        | type     | One thing a profile points at: somewhere else this person is.                                               |
| `Relay`              | type     | The site's subscription to one relay.                                                                       |
| `RelayState`         | type     | One of `RELAY_STATES`.                                                                                      |
| `Session`            | type     | A login, or the anonymous session that carries a CSRF token to a visitor who has not logged in yet.         |
| `SiteLicense`        | type     | The `license` setting: a Creative Commons key, or a custom license's URL and name.                          |
| `SiteSettings`       | type     | The `site` namespace's values, one snake_case key per setting, as `cms.settings.values(SITE)` returns them. |
| `SubmissionType`     | type     | What a checker is told a submission is.                                                                     |
| `User`               | type     | An admin user.                                                                                              |
| `UserProfile`        | type     | The public face of a user: what their archive is headed with and what their actor will carry.               |

## Mail

| Export                     | Kind     | What it is                                                                                                     |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `createMemoryMailProvider` | function | Build a mail provider that keeps every message in memory, for tests.                                           |
| `CommentDigest`            | type     | Sends the batched notices.                                                                                     |
| `CommentNotifier`          | type     | Tells people about comments.                                                                                   |
| `MailAddress`              | type     | Somebody a message is from, to, or answered to.                                                                |
| `MailDelivery`             | type     | What a provider says about a message it accepted.                                                              |
| `MailLogger`               | type     | Where the service says what it did and what it could not do.                                                   |
| `MailProvider`             | type     | Something that carries a message.                                                                              |
| `MailProviderName`         | type     | Which of the ways of sending a site has chosen.                                                                |
| `MailRecipient`            | type     | Anything that can be addressed: an address, or one with a name on it.                                          |
| `MailResult`               | type     | What became of one message.                                                                                    |
| `MailService`              | type     | Sends a site's email, or explains in the log why it did not.                                                   |
| `MemoryMailProvider`       | type     | A provider that remembers, and can be told to fail.                                                            |
| `OutgoingMail`             | type     | One message, as a provider receives it: addresses settled, templates already rendered, nothing left to decide. |
| `RawMail`                  | type     | What `MailService.sendRaw` takes: a message the caller built itself.                                           |
| `TemplateMail`             | type     | What `MailService.send` takes: a template, and who to send it to.                                              |

## Services on a running site

| Export                  | Kind | What it is                                                                                                                        |
| ----------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| `AvatarAnswer`          | type | What a request for an avatar is answered with.                                                                                    |
| `AvatarService`         | type | Fetches, shrinks, keeps and serves the avatars the site shows.                                                                    |
| `DeliveryReport`        | type | What one activity's delivery came to, recipient by recipient.                                                                     |
| `DeliveryService`       | type | Sends a site's posts to its followers and its relays, and remembers how that went.                                                |
| `Enqueued`              | type | What `JobQueue.enqueueUnlessActive` did: the id it queued, or the job already active.                                             |
| `FederationContextData` | type | What every Fedify dispatcher in the CMS is handed.                                                                                |
| `FeedNotifier`          | type | Tells the site's notify server which feeds have changed.                                                                          |
| `HostLookup`            | type | The addresses a host name resolves to.                                                                                            |
| `IndexNowNotifier`      | type | Tells the IndexNow engines which URLs changed.                                                                                    |
| `JobContext`            | type | What a job's handler is handed: the stop signal, the attempt and `progress()`.                                                    |
| `JobDefinition`         | type | One kind of admin job: a name, a payload parser and a handler.                                                                    |
| `JobName`               | type | A job's name, typed with its payload and result. Every `JobDefinition` is one.                                                    |
| `JobQueue`              | type | `cms.jobs`: queues admin jobs, runs them out of the request and reports their status.                                             |
| `JobRecords`            | type | Where job status lives. Every transition is a compare-and-set on state and attempt.                                               |
| `JobState`              | type | A job's state: queued, running, finished, failed or interrupted, with what goes with each.                                        |
| `JobStateName`          | type | The name of a `JobState`.                                                                                                         |
| `JobStatus`             | type | One job's record: its id, name, payload and state.                                                                                |
| `Json`                  | type | A JSON value, as a job's payload and result are.                                                                                  |
| `MessageTransport`      | type | What carries a job's id to a worker. Any Fedify `MessageQueue` is one.                                                            |
| `NotifyPing`            | type | What one ping came to.                                                                                                            |
| `NotifyReport`          | type | What a round of pings came to, one entry per feed.                                                                                |
| `Progress`              | type | How far a running job has got.                                                                                                    |
| `RelayService`          | type | The site's half of the Mastodon relay protocol (FEP-ae0c).                                                                        |
| `RelaySyncReport`       | type | What one call to `RelayService.sync` did.                                                                                         |
| `ReplyContext`          | type | What a reply shows of the post it answers.                                                                                        |
| `ReplyContextService`   | type | Keeps the stored contexts in step with the posts that cite: a reply's `in-reply-to`, and a like's, repost's or bookmark's target. |
| `RetentionReport`       | type | What one sweep changed.                                                                                                           |
| `RetentionService`      | type | The sweep, on a timer once the site serves.                                                                                       |
| `SiteFederation`        | type | A CMS federation object, with the context data its dispatchers expect.                                                            |

## Data files

| Export                | Kind     | What it is                                                                                                                                                          |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classifyFiles`       | function | Every regular file under a folder, sorted, each with the declaration `dataFileFor` gives it, or `undefined` when none covers it.                                    |
| `ClassifiedFile`      | type     | One file `classifyFiles` found: its path relative to the folder, its absolute path and its declaration.                                                             |
| `dataFileFor`         | function | The declaration in a list, such as `cms.dataFiles()`, that covers a path under `data/`: a scratch one if any covers it, else the first. `undefined` when none does. |
| `DataClass`           | type     | What a file under `data/` is to the site, and so what an export does with it: kept, credential, rebuildable, pending or scratch.                                    |
| `DataFileDeclaration` | type     | A pattern under `data/`, its class, and what is lost if its files are lost. `cms.dataFiles()` returns every one in effect for the site.                             |

## Plugins

| Export                       | Kind | What it is                                                                                                                  |
| ---------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| `JsonLdDocument`             | type | A JSON-LD document as plain data.                                                                                           |
| `Plugin`                     | type | A plugin, as a site config or a bundle's default export hands it over.                                                      |
| `PluginActorKey`             | type | One of a user's key files.                                                                                                  |
| `PluginCollection`           | type | A collection the site's federation publishes, paged by offset cursors.                                                      |
| `PluginCollectionPage`       | type | One page of a collection the site's federation publishes.                                                                   |
| `PluginCommand`              | type | A command on the `geekity` command line.                                                                                    |
| `PluginCommandContext`       | type | What a command's run is handed.                                                                                             |
| `PluginCommandOption`        | type | One option a command takes.                                                                                                 |
| `PluginDataClass`            | type | The class of a file a plugin keeps in its folder: `kept`, `rebuildable` or `credential`.                                    |
| `PluginDataFolder`           | type | The plugin's private folder, `data/plugins/<package name>/`, holding the files its `data` declares.                         |
| `PluginFederationContext`    | type | What a federation middleware is handed for one request.                                                                     |
| `PluginFederationMiddleware` | type | Answers a request in the federation mount, or hands it on with `next`, which resolves to what the rest of the site answers. |
| `PluginFollower`             | type | A follower, as a user's `followers.json` holds one.                                                                         |
| `PluginHost`                 | type | A plugin's only door into the CMS, handed to `Plugin.register`.                                                             |
| `PluginKeyAlgorithm`         | type | The algorithms an actor holds a key pair for.                                                                               |
| `PluginRecipient`            | type | A follower as a delivery reaches them.                                                                                      |
| `PluginRequestContext`       | type | What a plugin's route handler is handed.                                                                                    |
| `PluginRequirements`         | type | The plugins this one depends on: package name to the semver range it needs, the same pairs as its peer dependencies.        |
| `PluginRouteHandler`         | type | Answers one request to a plugin's route.                                                                                    |
| `PluginScreen`               | type | A screen under Plugins in the admin, listed in the menu while the plugin is active.                                         |
| `PluginScreenBlock`          | type | One block of a plugin screen's card.                                                                                        |
| `PluginScreenCard`           | type | One card on a plugin screen.                                                                                                |
| `PluginScreenCell`           | type | A table cell: text, or an instant drawn as a date, `null` for never.                                                        |
| `PluginScreenContext`        | type | What a plugin screen's render and its actions are handed.                                                                   |
| `PluginScreenText`           | type | Text on a plugin screen: plain, or set as code.                                                                             |
| `PluginSite`                 | type | The site's accounts, keys, followers and content, as a plugin may read and change them.                                     |
| `PluginUser`                 | type | One account on the site.                                                                                                    |
