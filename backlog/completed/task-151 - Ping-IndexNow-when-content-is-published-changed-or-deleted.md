---
id: TASK-151
title: 'Ping IndexNow when content is published, changed or deleted'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-10-01 13:09'
labels:
  - seo
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/seo/indexnow/'
priority: low
type: feature
ordinal: 175800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CMS already pings WebSub and rssCloud when posts change. IndexNow gets the same URLs recrawled by Bing, Yandex, Naver and Seznam within minutes. It needs a key file served at the site root.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A site can turn IndexNow on; a key is generated, stored in the site's files, and served at /{key}.txt
- [x] #2 Publishing, updating or deleting a post or page submits the affected URLs through the existing background-job path, batched and retried
- [x] #3 Nothing is sent for drafts, or when the base URL is not public
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Settings: add indexNow (checkbox, off by default) and indexNowKey (carried like menus, never on a form) to SiteSettings/site.json. Saving Reading with IndexNow on and no key generates a 32-hex key; turning it off keeps the key so a re-enable reuses it. A malformed key in the file reads as none.
2. Route: GET /{key}.txt in mountPublicSite answers the key as text/plain while IndexNow is on; any other .txt path falls through to the permalink routes.
3. Notifier: src/indexnow.ts, createIndexNowNotifier, shaped like notify.ts and the mail queue: subscribed to content.events change, ignores scan-origin changes, collects the permalink of the public version before and after (post or page; drafts, scheduled and trashed are not public), batches over a short window into one POST of {host,key,keyLocation,urlList} to api.indexnow.org, retries network errors, 429 and 5xx with backoff, gives up on other 4xx. Sends nothing when IndexNow is off, there is no key, or the base URL host is private (isPrivateHost).
4. Config: GeekityConfig.indexNow overrides (fetch, endpoint, attempts, backoffMs, batchMs, logger) so tests inject the fetch; Cms exposes indexNow with settled(), close() flushes/clears the timer.
5. Admin: Reading screen gets an IndexNow checkbox with a hint naming the key file; update SETTINGS_PAGE_FORMS.reading, READING in settings-pages.test.ts, settings.test.ts fixture.
6. Docs: README section.
7. TDD each AC; then pnpm build/test/typecheck/lint/format:check and curl /{key}.txt on a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Settings: indexNow (Reading checkbox, off by default; it sends the site's URLs to a third party) and indexNowKey (carried like menus, on no form). settingsFromForm mints a 32-hex key the first time IndexNow is turned on and keeps it when it is turned off. A key outside [A-Za-z0-9-]{8,128} in site.json reads as none.
Key file: src/web/indexnow.ts holds the key helpers; routes.ts matches /{8-128 key chars}.txt and calls next() unless it is exactly the stored key with IndexNow on, so a document permalinked at some other .txt path still resolves.
Sender: src/indexnow.ts, createIndexNowNotifier. There is no generic job runner in the CMS. The background-job path is the in-process queue that notify.ts (WebSub/rssCloud) and the mail service use, and this follows it: a chain that never rejects, subscribed to content.events change. Changes are gathered for batchMs (10 s by default) into one POST of {host,key,keyLocation,urlList} to api.indexnow.org/indexnow, split at 10,000 URLs. Network errors, 429 and 5xx are retried (3 attempts, 10 s then 40 s). Other 4xx are logged once. URLs: the public permalink of the previous and the next version, so moves send both and unpublish, trash and delete send the old one. Nothing for scan-origin changes, drafts, scheduled or trashed documents, IndexNow off, no key, or an isPrivateHost base URL.
Config: GeekityConfig.indexNow { fetch, endpoint, batchMs, attempts, backoffMs, logger } so tests inject the fetch; Cms.indexNow exposes settled() (flush now and wait) and close() (drop the gathered batch, called from Cms.close).
Validation: src/indexnow.test.ts has 11 tests through the admin editor with an injected fetch. Mutation checks: removing the draft filter, the private-host check, the 4xx/5xx retry split, or the scan guard each fails its test. pnpm build, test (2746 + 30 pass), typecheck, lint, format:check all exit 0. curl against a served temp site: /{key}.txt is 200 text/plain with the key as its body; a wrong key is 404.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Sites can turn on IndexNow under Settings → Reading. The first time it is turned on, a key is generated into content/_data/site.json and served at /{key}.txt. Publishing, editing, moving, unpublishing or deleting a post or page queues its public URLs on an in-process queue shaped like the WebSub/rssCloud notifier's. Batches of up to 10 s go to api.indexnow.org as one JSON POST, and network errors, 429 and 5xx are retried. Nothing is sent for drafts, scheduled posts, the boot scan, or a local base URL. Verified with src/indexnow.test.ts (11 tests, injected fetch, mutation-checked), the full pnpm build/test/typecheck/lint/format:check run, and a curl of /{key}.txt on a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
