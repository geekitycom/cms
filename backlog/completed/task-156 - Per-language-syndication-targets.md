---
id: TASK-156
title: Per-language syndication targets
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:32'
updated_date: '2026-10-02 17:03'
labels:
  - i18n
  - webmention
  - indieweb
milestone: m-25
dependencies:
  - TASK-155
  - TASK-154
references:
  - 'https://news.indieweb.org/how-to-submit-a-post'
priority: low
type: enhancement
ordinal: 180800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Some syndication targets are per language: IndieNews has a feed and a webmention endpoint per language (news.indieweb.org/en, /de, /fr and so on). Once posts carry a language (TASK-154) and syndication targets exist (TASK-155), a target's URL should be able to follow the post's language instead of the site declaring one target per language.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A target URL may contain a {lang} placeholder that is filled from the post's language, falling back to the site language
- [x] #2 A target can restrict itself to a set of languages, and a post in a language it does not list does not link to or notify it
- [x] #3 A German post tagged for IndieNews links to and notifies news.indieweb.org/de; an English one, /en
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Target shape: SyndicationTarget gains optional `languages` (canonical BCP 47 tags, non-empty list) and its `url` may hold a `{lang}` placeholder; targetOf() validates the URL with the placeholder filled and keeps the template.
2. selectedTargets(document, targets, siteLanguage) resolves each selected target for the post: the post's language is documentLanguage() else the site language else en. A target with `languages` is selected only when the post's language is one of them or a subtag of one (de-AT matches de), and `{lang}` takes the listed tag it matched; without `languages` it takes the post's tag. The returned target carries the filled URL, so the theme link, the sender's target list, the stored-copy key and the federation screen all see the same URL.
3. Pass the site language at the three callers: the renderer in index.ts, targetsOf in webmention/service.ts, and the federation screen.
4. Micropub q=config / q=syndicate-to and mp-syndicate-to keep listing and validating ids; no change needed there, covered by existing tests.
5. Tests first: parse tests for the placeholder and languages (incl. bad values), selection tests per AC, and a sender/render test showing a German post links to and notifies news.indieweb.org/de and an English one /en.
6. Docs: README Syndication targets section and backlog doc-7.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Moved from M24 to M26 on 2026-10-01: it depends on TASK-155, which is in M26, so it cannot be built in M24.

Shape: a target may carry `languages` (non-empty list of BCP 47 tags, kept canonical) and its `url` may hold `{lang}`. targetOf() validates the URL with `en` filled in and keeps the template as written, since URL parsing would escape the braces.

selectedTargets(document, targets, siteLanguage) is the one place the URL is decided. Post language = documentLanguage() else the site language else en. With `languages`, a post is taken when its tag equals a listed tag or is a regional form of one (de-AT -> de), and `{lang}` takes the listed tag; without `languages` it takes the post's own tag. Returned targets carry the filled URL, so the theme link, the sender's target list, the stored-copy key and the federation screen agree.

Sender: keepCopies() used to treat every declared target URL as a target; with templates the declared URL no longer equals what was sent. It now takes the versions it sent about and treats the URLs those versions select as targets, so a post that changes language tells the old page, which drops its copy, and keeps the new one.

Micropub q=config / q=syndicate-to still list {uid, name} and mp-syndicate-to validates ids; target ids are unchanged, so nothing changed there (src/micropub/syndicate.test.ts passes).

Validation: pnpm build && pnpm test (3403 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass. Unit tests in src/webmention/syndication.test.ts (parse, AC1, AC2, AC3); end-to-end in src/webmention/send.test.ts: a German post tagged for a {lang} target notifies /de, links it in the h-entry and keeps its copy under /de; an English one /en; a French one neither links nor notifies; switching de to en tells both and keeps only the /en copy. Served a scratch site (webmentionsSend off) with IndieNews declared as https://news.indieweb.org/{lang} languages [en, de, fr] and curled the posts: de -> news.indieweb.org/de, site-language post -> /en, es -> no link, de-AT -> /de. Server stopped.

Docs: packages/cms/README.md Syndication targets section; doc-7 Webmentions sending step.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Syndication targets can follow a post's language. A target's url may hold {lang}, filled from the post's lang or the site's language, and a target may list the languages it takes; a post in another language neither links to it nor notifies it. selectedTargets() resolves the URL once for the theme, the sender, the stored copies and the federation screen; the sender's copy bookkeeping now keys on the URLs each version selected. Verified with unit and end-to-end tests (German post to /de, English to /en, French skipped, language change re-notifies) and by curling a served site; full build, test, typecheck, lint and format checks pass.
<!-- SECTION:FINAL_SUMMARY:END -->
