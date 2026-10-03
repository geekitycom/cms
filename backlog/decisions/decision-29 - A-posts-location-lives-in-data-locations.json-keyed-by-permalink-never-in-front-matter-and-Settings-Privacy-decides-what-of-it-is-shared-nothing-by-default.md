---
id: decision-29
title: >-
  A post's location lives in data/locations.json keyed by permalink, never in
  front matter, and Settings > Privacy decides what of it is shared, nothing by
  default
date: '2026-10-03 01:09'
status: accepted
---
## Context

TASK-223 lets a post carry where it was written. Quill sends it as a `geo:` URI with an accuracy, other Micropub clients as an h-geo, an h-adr or an h-card, and the site refused all of them (decision-27 refuses what it cannot map). A location is personal data of the sharpest kind: exact coordinates on a note say where the author lives or is standing right now. The owner wants to accept it because Quill offers it, and wants a choice that collects it and publishes none of it, as the default.

Where a kept location lives is the whole question. Three places were considered.

- **Front matter.** Where every other Micropub property goes, readable by any mf2 tool, and what an Eleventy build of the same `content/` would print. It cannot keep a secret. `content/` is what the site publishes, it is meant for git (decision-9, the README's two-directories table), and a site's repository may be public. A location written there is public whatever Settings > Privacy says, and once committed it stays in the history after it is removed from the file. The 'collect, publish nothing' choice would then be a lie told by the renderers.
- **The index.** Lost with the database, which decision-9 lets a site delete at any time. A location cannot be rebuilt from anything.
- **A private file under `dataDir`.** `data/` is the half that is never in git and is backed up (decision-9). Mode 0600 like `users.json` and the IndieAuth tokens. Keyed by the post, as decision-26 keys syndication copies.

The fourth option, keeping it in front matter and filtering it out of every renderer when sharing is off, was rejected on the same grounds: the file itself is a public surface the renderers do not control, and a design that depends on every renderer remembering to filter leaks the day one forgets.

## Decision

- A post's location lives in `data/locations.json`, mode 0600, never under `content/`. One JSON object keyed by the post's permalink, each value the location as the site read it: `{ geo?: { latitude, longitude, altitude?, accuracy? }, name?, locality?, region?, country? }`. Permalink rather than path, because a permalink is a post's identity (decision-13, decision-20) and what every other per-post file is keyed by (decision-26). The file is written atomically under the per-file lock, and only when something changed.
- The editor's write path owns the entry (decision-27): a save writes the location the form carries under the saved permalink, a save with the fields cleared removes it, and a save that moves the post's permalink moves the entry with it in the same write. Trash and restore change the path and not the permalink, so the entry stays through both. A file deleted by hand leaves its entry behind; it is private, costs nothing, and the next post at that permalink would be the author's own again.
- Micropub stores the parsed location the same way, through the same form. `q=source` returns it to the token's own user whatever the setting, because the setting is about readers and that user already has it. A `geo:` URI when only coordinates are stored, an h-adr or an h-card (named) otherwise, with the coordinates and their accuracy under a nested `geo`.
- `content/_data/site.json` holds `locationSharing`, one of `none`, `place`, `exact`, chosen on **Settings > Privacy**, a new settings page and the home of every later privacy choice. `none` is the default: the location is kept and nothing of it reaches any public surface. `place` publishes the words only: the place name, locality, region and country, never a coordinate. `exact` publishes the coordinates as well.
- Renderers never see the stored location. `shareLocation(stored, setting)` reduces it to a `SharedLocation`, a union whose `exact` variant alone carries coordinates, and whose `place` variant cannot. With `none` it returns nothing. The theme's context, the ActivityStreams object and anything added later take the reduced value, so printing a coordinate under `place` is a type error rather than a forgotten branch.
- The theme prints the shared part inside the h-entry as `p-location`: an h-geo when only coordinates are shared, an h-adr when words are, an h-card when a place name is. Federation carries it as an ActivityStreams `Place` on the object's `location`, named by the words, with `latitude`, `longitude`, `accuracy` and `units` only under `exact`. Feeds, the JSON and Markdown representations, the JSON-LD, oEmbed, search and `llms.txt` carry no location at any level: the first three read the file, which has none, and the others gain nothing from it.
- The setting is read on each request, so changing it changes every post's page and object on the next request with no file rewritten.

## Consequences

- A site whose `content/` is a public repository can take Quill's location on every note and publish nothing, and the author can turn sharing on or off later without rewriting a post or its history.
- `data/locations.json` joins `data/users.json` and `data/keys/` in the backup. Losing it loses every location; nothing else does.
- An Eleventy build reads `content/` only, so it prints no location whatever the setting. A site that wants one in a static build has to put it into front matter by hand, in the open.
- Two things that used to be one are two: the post's file and the post's location. A post copied to another site by copying its file goes without its location, and a `q=source` is the only way a client gets it back.
- A Micropub update that does not name `location` leaves the stored one as it is, as the editor's form does when its fields are left as they were loaded.
- `locationSharing` is public in `site.json`, which suits a policy: a reader can see what the site chooses to share.
