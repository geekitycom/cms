---
id: TASK-194
title: Autolink bare URLs and @-names in posts
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:01'
updated_date: '2026-10-06 02:10'
labels:
  - indieweb
  - markdown
  - federation
milestone: m-28
dependencies: []
references:
  - packages/cms/src/content/markdown.ts
  - packages/cms/src/federation/article.ts
priority: medium
type: feature
ordinal: 210800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 2 aggregation asks for autolinked URLs and @-names. markdown-it runs with html: true and no linkify (src/content/markdown.ts:13), so a bare https://example.com in a post renders as text, and @user@instance.example is plain text in HTML and is not a Mention in the ActivityPub object. Turn on linkify for bare URLs (fuzzy linking off, so plain words such as file.md are not linked) and add a fediverse handle rule: @user@host links to the account's profile URL resolved by WebFinger at publish time, with a Mention tag in the federated object so the person is notified. A handle that does not resolve stays plain text. Links created this way get webmentions like any other link.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A bare http(s) URL in a post renders as a link; text like file.md or example.com without a scheme does not
- [x] #2 @user@host resolves through WebFinger and renders as a link to the profile with class u-category h-card (or the site's mention markup)
- [x] #3 The federated Note/Article carries a Mention tag for each resolved handle and the mentioned account is in cc
- [x] #4 An unresolvable handle stays plain text and publishing does not fail
- [x] #5 Autolinked URLs are sent webmentions like any other link in the post
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Bare URLs: turn on markdown-it linkify with fuzzyLink and fuzzyEmail off and only the http:/https: schemas kept, so a scheme URL links and file.md, example.com, //host and mailto: do not.
2. A handle directory: content/_data/handles.json, keyed by user@host, each entry the profile page, the actor id and its inboxes. A cached reader (bytes compared, like syndicationTargetsReader) and an atomic writer.
3. A markdown inline rule for @user@host, outside links and code: a handle the directory knows renders as <a class="u-category h-card" href=profile>@user@host</a>; any other stays text. The same rule lists the handles a body names. renderMarkdown/parseDocument take the directory; sync, save and the preview pass it.
4. Resolution at publish time: writeDocument resolves the handles the body names that the directory lacks, through Fedify lookupObject (WebFinger, then the actor), in parallel with a timeout, and stores what resolved before the file is written. A failure is logged and the save goes on.
5. Federation: postObject adds a Mention (href = actor id, name = @user@host) and the actor in cc for each resolved handle the body names; delivery adds each mentioned actor's inbox as one more target.
6. Webmentions: the autolinked URLs and the profile links are in document.html, so externalLinks sends to them; a test proves it.
7. Tests first for each AC; regenerate the anonymous-pages golden file if the HTML changes; run build, test, typecheck, lint, format:check; curl a running site for a bare URL and a known handle.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: resolved handles live in content/_data/handles.json, keyed by user@host in lower case, each entry the profile page, actor id, inbox and shared inbox (content/handles.ts). Resolution happens in writeDocument before the file is written (federation/handles.ts handleLearner: Fedify lookupObject of @user@host, signed as the first account, 5 s timeout, failures logged and skipped). The markdown handle rule reads the directory at parse time, so sync, saveDocument, a trash move and the preview pass it to parseDocument. postObject adds a Mention (href = actor id) and puts the actor in cc; delivery adds each mentioned account's inbox as a target, grouped per inbox with the reply author's.

Limits: a handle is only resolved by an editor or Micropub save. A file edited on disk links only handles the directory already holds, and a post indexed before a handle resolved keeps it as text until the post is next saved, because the index skips a file whose hash has not changed. An unresolved handle is asked again at each save.

linkify keeps only http: and https: (ftp:, // and mailto: removed), with fuzzyLink, fuzzyEmail and fuzzyIP off. The anonymous-pages golden file did not change: the demo content has no bare URLs or handles.

Validation: pnpm build, test (4666 + 30 pass), typecheck, lint and format:check all pass. Live run: a scratch script booted createCms on temp dirs, published through the editor a body with https://example.com/a-post, file.md, example.com, @hongminhee@fosstodon.org and @nobody-here-194@fosstodon.org. WebFinger resolved the first handle into handles.json and the second was logged and left out; the save answered 303. curl of the page showed the URL linked, file.md and example.com as text, the handle as <a class="u-category h-card" href="https://fosstodon.org/@hongminhee">, and the unknown handle as text. curl with Accept: application/activity+json showed the Mention tag and the actor in cc. mastodon.social and other servers in authorized-fetch mode cannot be resolved from localhost, because they cannot fetch a localhost key to check the signed request. That needs a deployed site to check. The server was stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Bare http(s) URLs in posts now link: markdown-it linkify is on, with fuzzy matching off and only the http and https schemes kept. @user@host handles are resolved through WebFinger when a post is saved, stored in content/_data/handles.json, and rendered as <a class="u-category h-card"> links to the profile. The federated Note or Article carries a Mention for each resolved handle and puts that actor in cc, and delivery posts to the mentioned account's inbox. A handle that does not resolve stays plain text, and the save still succeeds. Autolinked URLs and profile links are sent webmentions like any other link. Verified with new tests in markdown.test.ts, handles.test.ts, delivery.test.ts (TASK-194 block) and send.test.ts, with the full gates, and with a live publish against fosstodon.org whose page and ActivityStreams object were curled.
<!-- SECTION:FINAL_SUMMARY:END -->
