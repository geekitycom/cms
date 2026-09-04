---
id: decision-11
title: >-
  Dates are stored as UTC instants; the timezone setting only decides how they
  are shown
date: '2026-09-04 12:24'
status: accepted
---
## Context



## Decision



## Consequences


## Context

The CMS keeps a post's `date` exactly as the file spells it, offset and all, and normalises it only inside the SQLite index for sorting and scheduling. The public theme's `date` filter prints every value in UTC, the admin's date field is free text whose offset-less input JavaScript reads as the server's local time, and the `/YYYY/MM/` permalink is cut from the literal string. The `timezone` setting is consulted in one place, the editor's "Scheduled for" note. So a site whose author writes in one zone, runs the server in another, and sets the setting to a third shows three different readings of the same post, and the setting does not mean what it says.

## Decision

Every date the CMS writes into a file (`date`, `updated`, `activitypub.published`) is a UTC ISO 8601 instant ending in `Z`. The `timezone` setting decides only how an instant is shown and how offset-less input is read: the editor shows and accepts wall-clock time in that zone, the theme's `date` filter renders in that zone, and a new post's filename day and `/YYYY/MM/` permalink take the calendar day in that zone at the moment it is saved. Files written by hand with an offset are still read (Eleventy reads them too) and are rewritten as UTC the next time the CMS saves them. Feeds, the sitemap and ActivityStreams objects keep emitting instants.

## Consequences

- Changing the timezone setting changes what every page shows without touching a file, which is the point: the instant is the truth and the zone is a lens.
- Changing the setting must not move an existing post's URL, so the permalink is fixed when the post is first saved rather than re-derived from the instant on every parse.
- An Eleventy build of the same content must apply the same lens itself; the documented recipe is Luxon with `zone` read from `site.json`.
- The theme `date` filter's `readable`, `html` and `year` outputs become zone-dependent; `iso` stays the instant. Themes relying on UTC output see a change, which is a breaking change for the filter contract at 0.x.
