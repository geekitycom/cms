---
id: TASK-286
title: Tag suggestions ranked by tags.pub followers
status: To Do
assignee: []
created_date: '2026-10-06 12:09'
labels:
  - plugins
  - llm
  - federation
milestone: m-30
dependencies:
  - TASK-285
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - 'https://tags.pub'
  - 'https://github.com/social-web-foundation/tags.pub'
priority: medium
type: feature
ordinal: 242800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). A `tag-suggest` plugin that requires llm. On a click beside Tags, the server asks llm for candidate hashtags for the draft, passing the tags the site already uses so it prefers them, then looks up each candidate on tags.pub: the actor at https://tags.pub/user/<tag> and its followers collection totalItems. tags.pub returns an actor for any string, so zero followers means nobody follows the tag. The editor shows candidates ranked by followers, marks the ones the site already uses, and adds the chosen ones to the Tags field. Core gains a host fetch that refuses private addresses unless the site allows them (the same rule as federation) and a plugin cache file in data/plugins/<name>/ with expiry.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Candidates are normalised (lower case, no #, the site tag slug rules) and deduplicated before lookup
- [ ] #2 Each candidate shows its tags.pub follower count; candidates are ranked by it, with tags the site already uses marked
- [ ] #3 Counts are cached for a day in the plugin data folder; a second suggestion for the same tags makes no request to tags.pub
- [ ] #4 Lookups send a descriptive User-Agent with the site URL, run at most four at a time, and time out; a tags.pub failure still shows the candidates without counts
- [ ] #5 The host fetch refuses a private or loopback address unless the site allows private addresses, tested with a planted redirect to 127.0.0.1
- [ ] #6 Choosing a suggestion adds it to the Tags field without duplicating an existing tag and without saving
- [ ] #7 Verified in a real browser against fake llm and tags.pub servers
<!-- AC:END -->
