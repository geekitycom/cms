---
id: TASK-366
title: 'A layer map for every top-level directory, enforced by a check'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 11:31'
updated_date: '2026-10-12 13:08'
labels: []
milestone: m-36
dependencies:
  - TASK-365
priority: medium
type: chore
ordinal: 325800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After content/ is clean, the rest of packages/cms/src still forms cycles: site/ and web/ import each other (22 and 18 imports), admin/ imports web/ 33 times, web/ imports admin/ 17 times, and config.ts and env.ts are imported by and import from feature directories. Write down an ordered layer map (for example util and files at the bottom, then content and site, then features such as comments, webmention, federation and micropub, then web and admin delivery, then cms/ as the composition root) and make every directory follow it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docs/ (or a decision record) states the layer order and what each layer may import
- [x] #2 A check that runs in pnpm test or pnpm lint enforces the map for every top-level directory under packages/cms/src and names the offending import and the rule it breaks
- [x] #3 No cycles remain between top-level directories in non-test code, or each remaining one is listed as an explicit, documented exception
- [x] #4 Public exports from the package index and @geekity/cms/plugin keep their names
- [x] #5 Existing tests pass unchanged in behaviour
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Measure the graph of top-level units (each directory and root-level file); capture the TypeScript export list of src/index.ts and src/plugin.ts.
2. Turn src/layer-boundary.test.ts into the layer map: LAYERS bottom first, a unit imports only lower layers; EXCEPTIONS name file, unit, removing task and reason; fail on unplaced units, wrong-way imports and stale exceptions. See it fail.
3. Break the cycles with tests first where a moved contract had no direct test: admin store -> store/; pure policy out of web/ into content/, site/ and a new theme/; config's port types down to forms/, mail/ and config.ts, the templated mail service up into notifications/; conversation types into comments/; env.ts, session and throttle into web/; Hono handlers out of indieauth/, avatars/, contact/, notifications/, plugins/ into web/ and admin/; the admin bar into admin/ and the app's error handler into cms/; site/ inverted from indieauth and notifications (deleteUser into admin/, preferences into site/).
4. Leave the TASK-368 route files as named exceptions.
5. Migrate callers by codemod (no shims), compare the export list, document the map in docs/development.md.
6. Verify: pnpm build, test, typecheck, lint, format:check from the repo root.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured first: 38 mutually importing pairs of top-level units, and one strongly connected component holding 29 of the 41 units (every directory except util/files/forms-level ones and the entry points).

Check: src/layer-boundary.test.ts now holds LAYERS (bottom first, every top-level directory and root-level file in exactly one layer; a unit may import only lower layers, never a peer) and EXCEPTIONS ({file, mayImport, until, because}). Three tests: every unit is placed once; every import points down (message: 'site/ (site) must not import from web/ (public site, a higher layer): site/users.ts:1'); no exception is stale. Red first: 176 offences on the measured tree. Proved again at the end by adding a web/ import to site/users.ts (fails naming the line) and by pointing an exception at the wrong unit (fails).

Layer order: utilities (util, types, init.ts) < files < caches (cache.ts, dev-mode.ts) < content < operational state (store/, maintenance.ts) < ports (forms/, mail/, plugin.ts) < config.ts < theme/ < images < site < comments < notifications < contact < privacy < webmention < federation < services (avatars, media, indieauth) < plugins < supervisor < public site (web/, incl. web/env.ts) < admin < endpoints and middleware (micropub, access-log.ts, drain.ts) < publish pings (notify.ts, indexnow.ts) < cms/ < public API (exports.ts, config-loader.ts) < index.ts < cli.ts.

Exceptions left (all until TASK-368, route files in feature dirs): comments/routes.ts -> web/ and admin/ (documentSite), comments/viewer.ts -> web/, webmention/routes.ts -> web/, webmention/pingback.ts -> web/, federation/mount.ts -> web/. After them the only mutual pairs are admin<->comments, comments<->web, federation<->web, web<->webmention, each through those files.

Moves (old -> new, git mv, callers rewritten by a codemod, no re-export shims; barrels point at new homes):
- moved webmentionKey, isKey web/feed-source -> content/guids (tests added content/guids.test.ts)
- moved SiteData & readers (SITE_DATA_FILE, createSiteDataSource, postsPerPage, themeName, siteTimezone, siteLocale, frontPageSlugs, taxonomyBases, termRedirects) web/context -> theme/site-data; web/site-data.test.ts -> theme/site-data.test.ts
- images/alt-text.ts -> content/alt-text.ts (git mv); imagesIn, ShownImage, uploadPath, IMG_TAG, parseAttributes from images/markup.ts -> content/image-tags.ts; VARIANT_ASSET_PREFIX images/paths.ts -> content/uploads.ts (variants.ts re-export removed; images/index.ts barrel points at new home)
- CONTRACT: DocumentSite.config narrowed from ResolvedConfig to WriteConfig {contentDir,dataDir,baseUrl,requireAltText} (ResolvedConfig still assignable). Covered by content/write.test.ts (requireAltText, baseUrl ids, dataDir locations/kept properties), admin/posts.test.ts, micropub tests.
- forms/checker.ts: CommentChecker, CommentVerdict, CommentSubmission, CommentReport, SubmissionType out of comments/submission.ts (signatures unchanged; covered by comments/akismet.test.ts, comments/site.test.ts, contact/site.test.ts, webmention/receive.test.ts)
- CSRF_FIELD admin/session.ts -> forms/protection.ts (value unchanged; admin/*.test.ts, comments/signed-in.test.ts)
- AccessLogWriter access-log.ts -> config.ts (type only)
- MailLogger mail/service.ts -> mail/provider.ts; mail/service.ts -> notifications/mail-service.ts, mail/templates.ts -> notifications/mail-templates.ts (git mv with tests); exports moved from mail/index.ts to notifications/index.ts
- AUTHOR_BASE, INBOX_BASE, AuthorRequest, authorHref, parseAuthorPath (web/authors) + accountOf (federation/paths, now computed from new URL().host, same as federationOrigin().handleHost) -> content/authors.ts; tests moved to content/authors.test.ts, accountOf tests added
- web/authors.ts (profile contexts) -> site/authors.ts; authorFeedHref -> web/feed-source.ts with new web/feed-source.test.ts
- web/navigation.ts -> site/navigation.ts; web/sanitize -> content/sanitize; web/documents -> content/permalinks; web/locale -> content/locale; web/taxonomy -> content/taxonomy; web/license -> content/license; web/themes -> theme/themes; web/assets -> theme/assets; webmention/public-address -> util/public-address
- admin/store.ts -> store/admin-store.ts, admin/store/* -> store/*, federation/replies.ts -> store/inbox-replies.ts
- web/templates -> theme/templates; site/feed-settings.ts (DEFAULT_NOTIFY_SERVER, UPDATE_PERIODS, UpdatePeriod, isUpdatePeriod, FeedCadence, DEFAULT_FEED_CADENCE out of web/feed-source); web/indexnow -> site/indexnow-key (new test); robots policy (AI_CRAWLER_POLICIES.., RobotsPolicy, DEFAULT_ROBOTS_POLICY, robotsRuleProblem, robotsRuleLines, parseRobotsLine) -> site/robots.ts (new test), robotsTxt/robotsResponse stay web/robots.ts (web/robots.test.ts)
- site/admin-paths.ts: ADMIN_PREFIX (admin/session), ADMIN_ASSET_PREFIX (admin/assets), LOGIN_PATH (admin/routes), USERS_PATH + editUserPath (admin/users); values unchanged
- notifications/preferences -> site/notification-preferences; privacy/policy -> site/retention-policy; indieauth/client-id -> util/client-id; DEFAULT_COMMENTS_CLOSE_AFTER_DAYS comments/policy -> site/settings
- CONTRACT: deleteUser moved site/users -> admin/users (same signature and behaviour: removes the record then revokes IndieAuth tokens); site/users keeps removeUser (record only). Covered by site/users.test.ts (removes once), indieauth/tokens.test.ts (deleteUser revokes tokens), admin/users.test.ts (delete screen).
- conversation types (Interaction*, ThreadReply, Conversation, ConversationReader, Upstream, RepliesOf, HeldAt, CommentThread, Placed, SiteInteraction, RsvpGroup, WithheldReply) and pure helpers (commentNames, heldComment, commentAnchor, commentKeyAt, visibleReply, isWithheld) web/conversation -> comments/conversation.ts; createConversation stays in web
- feedExcerpt, excerptFromHtml, EXCERPT_WORDS web/feed-item -> content/excerpt.ts (new test); isFederatedDocument federation/article -> content/served.ts (test added)
- CONTRACT: supervisor/worker.ts serving(cms) typed by local SupervisedCms {drain,resume,close} instead of Pick<Cms,...> from index.ts (same shape). Covered by src/supervisor/primary.test.ts, src/drain.test.ts, src/cli-reload.test.ts, src/cli-serve.test.ts.
- Hono handlers moved out of features: avatars/routes -> web/avatar-routes, contact/routes -> web/contact-routes, notifications/routes -> web/notification-routes, plugins/mount -> web/plugin-routes, plugins/federation -> web/plugin-federation, indieauth/{activity-log,bearer,discovery,token} -> web/indieauth-*, indieauth/{app-activity,connected-apps} -> admin/, indieauth/consent -> admin/indieauth-consent; SCOPES indieauth/discovery -> indieauth/request; env.ts -> web/env.ts; admin/session -> web/session, admin/throttle -> web/throttle; mountAvatars/mountContact/mountNotificationLinks now exported by web/index.ts barrel
- web/errors.ts -> cms/server-error.ts (serverError, the whole app's 500 handler, admin page or theme page); representationOf -> web/negotiate.ts
- web/admin-bar.ts -> admin/admin-bar.ts; golden web/__testing__/anonymous-pages.golden.json -> admin/__testing__/
- CONTRACT: publicAdminBar is registered by cms/app.ts right before mountPublicSite (same position as before: after mountAdmin and mountPluginRoutes) instead of inside mountPublicSite. Through createCms nothing changes; mountPublicSite called on its own no longer adds the bar. Covered by admin/admin-bar.test.ts (golden byte-identical anonymous pages, signed-in bar on 404/500), web/server-error.test.ts.
- docs/development.md: new 'Source layers' section (layer table, rule, the check, exceptions); stale path mentions in comments and docs/media.md, docs/comments.md updated.

Public API: TypeScript export list of src/index.ts and src/plugin.ts (1275 names with value/type kind) identical before and after.
Validation from repo root: pnpm build (clean dist), pnpm typecheck, pnpm lint, pnpm format:check exit 0; pnpm test exit 0 (cms 5725 pass, demo 32, plugin-llm 48, plugin-post-summary 22, plugin-tag-suggest 31, plugin-wordpress 106, no failures).
No decision record: backlog decision create takes only a title, and the body cannot be written without editing the file by hand; the docs section is the record.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every top-level unit under packages/cms/src (directories and root-level files) now sits in one layer of an ordered map, and src/layer-boundary.test.ts (in pnpm test) enforces it: an import must point at a lower layer, a failure names the unit, layer, target and file:line, unplaced units and stale exceptions fail too. It failed on 176 imports before and passes now. Cycles were broken by moving shared rules down (URL, excerpt, sanitizer, image-tag, site-data, robots, feed and admin-path rules into content/, theme/ and site/; the admin's SQLite store into store/; config's port types into forms/, mail/ and config.ts), by moving HTTP handlers out of feature directories into web/ and admin/ (env.ts, session and throttle into web/), and by small inversions (deleteUser composes removeUser and token revocation in admin/; the admin bar is registered by cms/). The only exceptions are the five route files TASK-368 moves. Public export names of the package index and @geekity/cms/plugin are identical (1275 names). Documented in docs/development.md 'Source layers'. Verified with pnpm build, test (cms 5725, demo 32, plugins 48/22/31/106, all pass), typecheck, lint and format:check from the repo root.
<!-- SECTION:FINAL_SUMMARY:END -->
