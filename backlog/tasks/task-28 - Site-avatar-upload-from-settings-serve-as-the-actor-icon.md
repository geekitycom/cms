---
id: TASK-28
title: 'Site avatar: upload from settings, serve as the actor icon'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-03 22:38'
updated_date: '2026-09-03 22:57'
labels:
  - admin
  - federation
milestone: m-2
dependencies:
  - TASK-14
  - TASK-16
  - TASK-20
references:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 21500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site actor has no picture. doc-4 says the actor icon is an uploaded avatar, and TASK-16 left the seam for it: `siteActor()` sets `icon` from a raw `avatar` settings key (`AVATAR_SETTING` in `src/federation/actor.ts`) that no screen writes, so every follower sees a blank profile. Promote the avatar to a real setting: the settings screen accepts an image upload, stores it with the other uploads under `content/uploads`, keeps its public URL as `SiteSettings.avatar`, mirrors it into `content/_data/site.json`, and the actor document carries it as `icon`. Once it exists, `src/federation/actor.ts` should read the typed setting and drop the raw key.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The settings screen shows the current avatar (or a placeholder), accepts a PNG, JPEG, WebP or GIF upload within the configured upload limits, and has a control to remove it
- [x] #2 The uploaded image is stored under content/uploads and served at its public URL; SiteSettings.avatar holds that URL and site.json mirrors it
- [x] #3 GET on the actor URL with an ActivityStreams Accept returns icon pointing at the avatar's absolute URL, and no icon when none is set
- [x] #4 Saving or removing the avatar delivers Update of the actor to every follower so cached profiles refresh
- [x] #5 /admin/federation shows the avatar next to the actor summary
- [x] #6 A rejected upload (wrong type or too large) leaves the existing avatar in place and explains why
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Promote the avatar to a real setting: SiteSettings.avatar (the public path the upload endpoint hands back), DEFAULT_SITE_SETTINGS, readSiteSettings/writeSiteSettings, the site.json mirror (siteJsonFor) and the theme's site global (settingsSiteData), and seedSiteSettings so an old site.json without the key still seeds. The main urlencoded form does not carry it, so SETTINGS_FIELDS/SettingsForm cover every setting but the avatar and settingsFromForm carries the stored one through.
2. Refactor uploads.ts so the validate-and-write half is a helper (storeUpload) both /admin/uploads and the avatar route use, rather than duplicating the extension, declared-type, size and signature checks.
3. Add POST /admin/settings/avatar: multipart upload of an image plus an action=remove, behind refuseOversizedUpload and the admin guard. A refusal is a flash and a redirect, so the stored avatar is untouched and the screen says why.
4. Settings screen: an Avatar panel showing the current avatar or a placeholder, the upload form (enctype multipart/form-data) and the Remove button, with the CSS for it.
5. actor.ts reads settings.avatar and resolves it against the base URL in effect (new avatarUrl helper); AVATAR_SETTING and the raw-key read in createSiteFederation go.
6. delivery.ts gains updateActor(): an Update whose object is the site actor, id {actorId}#update/{instant}, recorded in ap_outbound with objectId = the actor id and slug null, fanned out like a post. It is a no-op when nobody follows the site. The settings POST calls it when a profile field changed, and the avatar route calls it after a save or a removal.
7. Federation screen: ActorSummary.avatarUrl and the image next to the actor summary; a test that an actor Update leaves no bogus post row in the delivery table.
8. README (settings, site.json keys, the admin route table, the federation screen) and the docs; then pnpm build, test, typecheck, lint, format:check and fed:smoke.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Promoted the avatar to a real setting. SiteSettings.avatar holds the public path the upload endpoint hands back ('/uploads/{yyyy}/{mm}/{name}') or an absolute URL; it round-trips through readSiteSettings/writeSiteSettings, is mirrored into content/_data/site.json by siteJsonFor, reaches the theme through settingsSiteData, and is seeded from an existing site.json when the key is there (its absence is still fine, so no template changed).

The settings form does not carry it: SettingsField is Exclude<keyof SiteSettings, 'avatar'>, so SETTINGS_FIELDS/SettingsForm/SettingsProblems cover every other setting and settingsFromForm(form, avatar) carries the stored one through. The avatar has its own endpoint, POST /admin/settings/avatar: a multipart form uploads an image and a plain one posts action=remove. Both are behind the admin guard and refuseOversizedUpload.

uploads.ts was refactored so the validate-and-write half is storeUpload(file, config, { imagesOnly }), returning either a StoredUpload or an UploadRefusal; /admin/uploads renders that as JSON and the avatar route as a flash. imagesOnly is the one extra rule the avatar adds, so a PDF the site accepts as an upload is refused as a profile picture, before anything is written.

actor.ts now reads settings.avatar and resolves it against the base URL in effect (new avatarUrl helper, exported); AVATAR_SETTING and the raw-key read in createSiteFederation are gone. siteActor takes { settings, baseUrl } and builds both the profile url and the icon on that base URL.

delivery.ts gained updateActor(): an Update whose object is the site actor, id {actorId}#update/{ISO instant}, recorded in ap_outbound with objectId = the actor id and slug null, fanned out through the same groupByInbox/sendActivity path as a post so every follower gets a per-follower row in ap_deliveries. It is a no-op returning undefined when nobody follows the site (which also avoids generating key pairs on a settings save), and it never rejects: a failure is logged so a save is not lost. The settings POST calls it when profileChanged() says a profile field moved (title, tagline, handle, type, avatar — not the base URL, which is settled at boot, nor the time zone or page size); the avatar route calls it after a save or a removal. Because the row has a null slug and an objectId that is not a post, deliveryRows already skips it, so the federation screen's per-post table is unaffected — there is a test for that.

The federation screen shows the avatar beside the actor summary (ActorSummary.avatarUrl), and the settings screen shows it or a placeholder with the upload and Remove forms. CSS for both in admin/static/admin.css.

Verified: pnpm build, pnpm test (586 + 10 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check and pnpm fed:smoke all pass from the repo root, plus pnpm test:11ty.

Evidence per AC, all through app.request:
- AC1/AC2: src/admin/settings.test.ts 'is a placeholder until one is uploaded, then the stored image' (placeholder, multipart upload, the setting, the bytes under content/uploads, the file served at its public URL, site.json's avatar key, the img on the screen) and 'is taken down again by the Remove button'.
- AC3: src/federation/federation.test.ts 'carries no icon until an avatar is set, and the avatar once it is (AC #3)' plus 'leaves an avatar that is already an absolute URL alone'.
- AC4: src/federation/delivery.test.ts 'delivers an Update of the actor when the avatar is saved', '... when the avatar is removed' and '... when a profile field is saved, and nothing when none was' — a real follower, a stubbed remote host, and assertions on the delivered JSON-LD, the ap_outbound row and the ap_deliveries statuses.
- AC5: src/admin/federation.test.ts 'shows the site's avatar beside it, and a placeholder without one', plus 'an actor update in the delivery log is not shown as a post'.
- AC6: src/admin/settings.test.ts 'keeps the avatar it has when an upload is refused, and says why' — four refusals (unknown extension, a PDF, wrong magic bytes, over uploadMaxBytes), each leaving the stored avatar and its img in place and putting the reason on the screen.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the site avatar a real setting. SiteSettings.avatar holds the public path of an image uploaded on /admin/settings through a new POST /admin/settings/avatar (multipart upload plus an action=remove), stored with the other uploads under content/uploads and mirrored into content/_data/site.json. The ActivityPub actor builds its icon from that setting, resolved to an absolute URL against the base URL in effect, so AVATAR_SETTING and the raw-key read are gone; saving or removing it — or changing the title, tagline, handle or actor type — sends an Update of the actor to every follower through the new DeliveryService.updateActor(), recorded in ap_outbound with the actor's id and no slug so it stays out of the per-post delivery table. The federation screen shows the avatar beside the actor summary, and a refused upload leaves the stored avatar alone and says why. The editor's upload endpoint and the avatar share one storeUpload() helper, with the avatar adding an images-only rule. Verified with new tests in settings.test.ts, federation.test.ts, delivery.test.ts and admin/federation.test.ts, and with build, test, typecheck, lint, format:check and fed:smoke.
<!-- SECTION:FINAL_SUMMARY:END -->
