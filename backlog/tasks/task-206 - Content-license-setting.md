---
id: TASK-206
title: Content license setting
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:13'
updated_date: '2026-10-02 07:42'
labels:
  - settings
  - theme
  - schema-org
dependencies:
  - TASK-192
references:
  - packages/cms/admin/pages/settings/general.njk
  - packages/cms/themes/default/partials/jsonld.njk
  - packages/cms/src/web/feed-rss.ts
priority: low
type: feature
ordinal: 222800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A site cannot say what readers may do with its posts. Add a License setting on Settings > General: none (the default, meaning all rights reserved), one of the Creative Commons licenses (CC BY, BY-SA, BY-NC, BY-NC-SA, BY-ND, BY-NC-ND, CC0) or a custom URL with a name. Show it in the default theme's footer with rel="license", add license to the JSON-LD WebSite and BlogPosting nodes, and declare it in the feeds (Atom link rel=license, RSS creativeCommons:license or a dc:rights line, JSON Feed _license extension or omit). A post may override it with license in front matter.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Settings > General offers no license, the Creative Commons set and a custom URL with name, saved in site.json
- [x] #2 With a license chosen, every page links it with rel="license" and the JSON-LD WebSite and BlogPosting carry license
- [x] #3 The Atom and RSS feeds declare the license
- [x] #4 A post's license front matter overrides the site's on that post, its JSON-LD and its feed item
- [x] #5 With no license chosen nothing is printed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New module packages/cms/src/web/license.ts: one registry CREATIVE_COMMONS_LICENSES (key -> name + URL, CC 4.0 and CC0 1.0), and resolveLicense(site, frontMatter) returning { url, name } or undefined. A value is a known key (case-insensitive), an http(s) URL (name from licenseName, else the registry name for a known CC URL), or none. A post's license overrides the site's; none clears it; an unrecognised value is ignored.
2. site.json shape: license holds a key or a custom URL, licenseName the custom name. Front matter takes the same two keys.
3. Settings > General: SiteSettings gains license ('' | key | custom), licenseUrl, licenseName; the eight wiring points in settings.ts, settings-general.ts fields + licenseChoices panel, testing forms, general.njk select + two text fields after the Site icon block. Custom needs an absolute http(s) URL and a name.
4. render.ts resolves the license once per render from site + the page's front matter and puts it on the context as license; base.njk footer prints <a rel=license>; jsonld.njk adds license to WebSite (site's) and BlogPosting/Article (the page's).
5. Feeds: FeedItem.license from the document's front matter over the site's; Atom link rel=license (RFC 4946) on feed and entries; RSS creativeCommons:license with its namespace on channel and items; JSON Feed omits. Site license goes into the feed fingerprint.
6. Tests first per AC (settings-general, page-shell, feed-formats/feeds, license unit), then code. Docs: root README, packages/cms/README, theme README.
7. Verify: pnpm build/test/typecheck/lint/format:check and curl a scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order: after TASK-192 (and TASK-201 if it has landed). It adds a control to Settings > General, which TASK-192 restructures, and license members to jsonld.njk, which TASK-192 and TASK-201 also edit.

Data shape: one registry, CREATIVE_COMMONS_LICENSES in packages/cms/src/web/license.ts (key -> short name, long title, deed URL; CC 4.0 and CC0 1.0), and resolveLicense(site, page) returning { name, url } or undefined. The renderer resolves it once per render into license (the page's) and siteLicense (the site's); the footer, jsonld.njk and the feed item all read that answer, so no template branches on keys.

Accepted values, in site.json and front matter alike: a CC key in any case (cc-by, cc-by-sa, cc-by-nc, cc-by-nc-sa, cc-by-nd, cc-by-nc-nd, cc0); an http(s) URL, named by licenseName, else by its deed if it is a CC URL, else by itself; or none, which is all rights reserved. Anything else is ignored, so a typo in a post keeps the site's license rather than dropping it. A post's none clears the site's license on that post.

site.json: license holds the key, or a custom license's URL with licenseName beside it; neither key is written with no license. Settings > General models it as three fields (license select '' | key | custom, licenseUrl, licenseName) because SettingsForm is one field per setting; settingsFromSiteJson maps a URL to custom, siteJsonFor writes the URL back under license. Custom needs an http(s) URL and a name. License control sits after the Site icon block.

Feeds: Atom gets RFC 4946 link rel=license (title = name) on the feed and on every entry, since RFC 4946 does not let entries inherit the feed's. RSS gets creativeCommons:license (http://backend.userland.com/creativeCommonsRssModule) on the channel and each item, namespace declared only when a license is printed. Chose it over dc:rights because it names the license by URL, which a reader can act on, and works for non-CC licenses too; dc:rights is free text. JSON Feed omits. The site license goes into the post feed fingerprint only when present, so unlicensed sites keep their ETags (the admin-bar byte-identical test caught an earlier version that moved them). FEED_ITEM_REVISION not bumped: bytes change only when a license is set, and that is fingerprinted (site.json) or in document.hash (front matter).

Known limit: RSS has no 'no license' element, so a license: none post on a licensed site carries no item license while the channel still names the site's. Documented in packages/cms/README.md.

Also exported resolveLicense, CREATIVE_COMMONS_LICENSES, CREATIVE_COMMONS_NAMESPACE and the types from the package index, since FeedItem (public) now carries ContentLicense.

Validation: pnpm build, pnpm test (3144 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Scratch site via geekity init + serve on :3917 with license cc-by-sa and a post overriding with https://example.com/terms + House terms: home and posts footer show rel=license links (override shows House terms), JSON-LD WebSite carries the CC BY-SA URL and the override BlogPosting carries https://example.com/terms; /feed/ has the namespace, channel license and per-item licenses; /feed/atom/ has feed and entry link rel=license with titles; both xmllint well-formed; /feed/json/ has no license. Removing license from site.json: zero license or creativeCommons matches across /, a post, /about/, /feed/, /feed/atom/, /feed/json/. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a License setting on Settings > General (none, the seven Creative Commons licenses, or a custom URL with a name), stored in site.json as license (key or URL) plus licenseName. One registry and resolver in src/web/license.ts turn site.json and a post's license/licenseName front matter (key, URL, or none) into { name, url }, which the default theme's footer prints with rel=license, jsonld.njk prints on WebSite (site's) and BlogPosting/Article (page's), Atom prints as RFC 4946 link rel=license on feed and entries, and RSS prints as creativeCommons:license on channel and items. JSON Feed omits. No license prints nothing anywhere and leaves feed ETags unchanged. Verified with new tests (license.test.ts, settings-general, page-shell, feeds), the full build/test/typecheck/lint/format run, and curl against a scratch site with and without a license and with a post override.
<!-- SECTION:FINAL_SUMMARY:END -->
