---
id: TASK-70
title: >-
  WordPress ActivityPub compatibility: a switch that serves the /wp-json/ inbox
  and collection paths and shows when they were last asked for
status: To Do
assignee: []
created_date: '2026-09-05 13:51'
labels:
  - federation
  - admin
milestone: m-11
dependencies:
  - TASK-69
references:
  - >-
    backlog/decisions/decision-14 -
    Users-are-the-actors-at-their-author-URLs-WordPress-ids-are-honoured-and-its-paths-are-a-switch.md
  - packages/cms/src/admin/settings.ts
  - packages/cms/src/federation/mount.ts
  - packages/cms/src/admin/federation.ts
  - >-
    https://andrewshell.org/.well-known/webfinger?resource=acct:andrew@andrewshell.org
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
type: feature
ordinal: 99400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A follower's server delivers to the inbox URL it cached from the actor document and replaces it only when it next refetches the actor. A site moved from the WordPress ActivityPub plugin therefore keeps receiving at /wp-json/activitypub/1.0/actors/{id}/inbox and /wp-json/activitypub/1.0/inbox for a while, and those are cache, not identity (decision-14): the CMS carries them until the caches have moved on and no longer. Add a site setting, WordPress ActivityPub compatibility, off by default and absent from a new site's site.json. When it is on, the CMS mounts real inbox routes at those two paths, signature-verified exactly as the canonical ones are, with the plugin's numeric actor id mapped to a user through a field on the user record set by the import (TASK-71), plus GET routes for the outbox, followers and following collections at /wp-json/activitypub/1.0/actors/{id}/ that answer with the user's collections. Each route records the instant it was last asked for, per user, in a file under data/ so a rebuilt database does not forget, and the federation screen shows it beside the switch with a note that once every follower's server has refetched the actor the switch can go off. The spike (TASK-66) says how a second inbox path is served under Fedify. Nothing here is mounted for a site with the switch off.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With the switch off, no /wp-json/ path is registered and site.json does not mention the setting until it is turned on
- [ ] #2 With the switch on and a user mapped to WordPress actor id 2, a signed Follow POSTed to /wp-json/activitypub/1.0/actors/2/inbox or to /wp-json/activitypub/1.0/inbox is accepted into that user's followers, an unsigned or badly signed one is refused, and a GET of the outbox, followers and following paths under actors/2 answers with the user's collections
- [ ] #3 Every compatibility route records when it was last asked for, per user, in a file under data/ that survives a restart and geekity rebuild; the federation screen shows the instants, or never, beside the switch with the note
- [ ] #4 Turning the switch off unregisters the routes on the next request without a restart, or the screen says a restart is needed, whichever the implementation chooses, and a test proves the chosen behaviour
- [ ] #5 doc-4 and the package README describe the switch, what it is for and when to turn it off
<!-- AC:END -->
