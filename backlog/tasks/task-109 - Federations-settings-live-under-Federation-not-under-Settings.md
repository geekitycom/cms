---
id: TASK-109
title: 'Federation''s settings live under Federation, not under Settings'
status: To Do
assignee: []
created_date: '2026-09-20 12:36'
updated_date: '2026-09-20 12:36'
labels:
  - admin
  - federation
milestone: m-16
dependencies: []
references:
  - packages/cms/src/admin/settings-federation.ts
  - packages/cms/src/admin/menu.ts
  - packages/cms/src/admin/settings-page.ts
  - packages/cms/src/admin/settings-pages.ts
  - packages/cms/admin/pages/settings/federation.njk
  - packages/cms/src/admin/federation.ts
type: task
ordinal: 134800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin has two menu entries called Federation. One is the top-level section, holding Followers. The other is a child of Settings, holding the relays a site follows and the WordPress ActivityPub compatibility switch. Neither says the other exists, and a person looking for relays has no reason to prefer one over the other.

Move the settings page under the section it belongs to, so Federation holds everything about federation: its followers, its relays and its compatibility switch.

The move is mostly a path and a menu entry. `SettingsPage.path` is a free string and `settingsPagePath()` is only a helper for the Settings children, so the page can live under `/admin/federation/` and keep the whole settings-page abstraction — its fields, its save, its endpoints and its refusals — without a rewrite. The template moves with it, into `pages/federation/` beside the followers screen (TASK-99's tree).

Decide and write down which child the section lands on, because a menu heading goes to its first child: Followers is what somebody opens the section to look at, and the settings are what they open it to change.

The old URL should redirect rather than 404: it is in the README, and it is where a bookmark points.

Worth checking while in there: whether any other Settings child is really a section's own screen wearing the Settings label. Discussion and Email are site-wide; Reading is about to lose its Navigation box to TASK-108, which is the same shape of problem — a screen filed where the fixed menu had room rather than where its subject lives.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Federation's relays and the WordPress compatibility switch are reached from the Federation section, and Settings no longer lists Federation, proven by a test
- [ ] #2 The page keeps the settings-page machinery: its fields save, its refusals stand, and its panels work, proven by the existing settings-federation tests passing with only their paths changed
- [ ] #3 The section's first child is a deliberate choice, named in the implementation notes with the reason
- [ ] #4 The old /admin/settings/federation redirects to the new URL rather than answering 404, proven by a test
- [ ] #5 The README, the admin doc and any other prose naming the old path are updated
- [ ] #6 Any other Settings child that is really a section's own screen is named in the implementation notes, moved or with a reason not to
<!-- AC:END -->
