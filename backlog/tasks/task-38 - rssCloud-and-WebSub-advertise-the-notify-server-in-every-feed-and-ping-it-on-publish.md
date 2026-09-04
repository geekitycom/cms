---
id: TASK-38
title: >-
  rssCloud and WebSub: advertise the notify server in every feed and ping it on
  publish
status: To Do
assignee: []
created_date: '2026-09-04 00:38'
labels:
  - web
  - federation
milestone: m-5
dependencies:
  - TASK-37
  - TASK-19
references:
  - 'https://rpc.rsscloud.io/docs/quick-start'
  - 'https://rpc.rsscloud.io/docs'
  - 'https://www.jsonfeed.org/version/1.1/'
  - 'https://www.w3.org/TR/websub/'
type: feature
ordinal: 27500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The user operates https://rpc.rsscloud.io/, which speaks both rssCloud and WebSub, so real-time notification is advertising that server from every feed and telling it when a feed changes. Add one setting, `notifyServer`, an https URL defaulting to `https://rpc.rsscloud.io` and empty to turn the feature off, on the settings screen and mirrored to `site.json`. From it derive everything the quick-start asks for.

Advertising. RSS 2.0 (`/feed/` and every taxonomy RSS feed) carries all three in `<channel>`: the legacy `<cloud domain="rpc.rsscloud.io" port="80" path="/pleaseNotify" registerProcedure="" protocol="http-post"/>` (host from the setting, port 80 and http-post as the quick-start prescribes for the legacy element), `<source:cloud>https://rpc.rsscloud.io/pleaseNotify</source:cloud>` under `xmlns:source="https://source.scripting.com/"`, and `<atom:link rel="hub" href="https://rpc.rsscloud.io/websub"/>` next to the existing `rel="self"`. Atom feeds carry `<source:cloud>` (it is namespaced) and the `rel="hub"` link but no `<cloud>`. JSON Feed carries `"hubs": [{ "type": "WebSub", "url": "https://rpc.rsscloud.io/websub" }]` per JSON Feed 1.1. Every feed response, all formats and all taxonomy variants, sends the WebSub discovery header `Link: <https://rpc.rsscloud.io/websub>; rel="hub", <absolute feed url>; rel="self"`.

Pinging. The server notifies nobody until it hears the feed changed, so after a post is published, updated or withdrawn (the same index changes that drive ActivityPub delivery, and never for a full scan) the CMS POSTs `https://rpc.rsscloud.io/ping` with `url=<feed url>` for every feed whose contents changed: the three site feeds and the three feeds of each tag and category the post carries, before and after the change. Pings are best effort, serialised, logged on failure, and never block the request or the save; they run through a hook a site can also call. See "rssCloud over REST" in the docs for the response shape and "WebSub → Publishing" for the equivalent; either reaches every subscriber.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With the default setting, /feed/ contains the cloud element with port 80 and http-post, the source:cloud element and the hub link, alongside rel=self
- [ ] #2 Atom feeds contain source:cloud and the hub link and no cloud element; JSON feeds contain a hubs array with the WebSub hub
- [ ] #3 Every feed response in every format, site-wide and per taxonomy, carries a Link header with rel=hub and rel=self, self being the feed's absolute URL
- [ ] #4 Publishing, editing or unpublishing a post pings the notify server once per affected feed URL, proved by a test that stubs the server and records the ping bodies; a full scan pings nothing
- [ ] #5 An empty notifyServer removes every element, header and ping; a different URL moves all of them
- [ ] #6 A failed ping is logged and the publish still succeeds
<!-- AC:END -->
