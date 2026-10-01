---
id: decision-25
title: >-
  site.json author holds the site author's username, and no author means several
  authors
date: '2026-10-01 21:22'
status: accepted
---
## Context

Settings > General had a free-text Author field and, from TASK-180, a separate Solo author blog checkbox. Nothing tied them together. The switch only took effect when the free text happened to equal a user's username or display name, so a site could be saved as a solo author blog with no visible effect: no bio, no `rel="me"`, and a root that was nobody's IndieAuth identity. The feeds printed the free text, and a post's `author`, which holds a username since decision-14, was printed raw, so a JSON Feed item could be credited to a login such as `a`.

## Decision

**One setting says who the site is.** `author` in `content/_data/site.json` holds one user's username, and that makes the site that user's: a solo author site. A site with no `author` key has several authors. There is no `soloAuthor` key. The General page edits it with one select, Site author, whose options are each user by display name and Several authors, and it writes only a username or no key at all.

**Names are resolved where they are printed.** Every reader that prints a name resolves the stored string to a user with `userForAuthor` and prints the display name, else the username. The site author's name is `siteAuthorName` in `src/web/authors.ts`: the user's display name, else the site title. A document's author is `authorName`: the user's display name, else the stored string as it is. The footer, the Atom feed author, the JSON Feed authors, RSS `dc:creator` and the share image's alt text all print through these.

**A file written before the select is read, not rewritten.** `userForAuthor` already reads a display name that exactly one user has as that user, so an old `author` holding a display name keeps naming its user, and the General page selects that user and writes the username at its next save. An old `author` that names nobody makes a site with several authors. `soloAuthor` is ignored when read and dropped at the next save of any settings page.

**The theme follows the same choice.** `soloAuthor` on the template context is the site author's profile, on every page, and absent on a site with several authors. The default theme's JSON-LD has the `WebSite` published by and about that user's Person on every page. On a site with several authors the `WebSite` and every entry are published by an `Organization` named for the site, at `{baseUrl}/#organization`, and the `WebSite` has no `about`. The Eleventy example reads the same user out of `data/users.json` and exposes it as the `soloAuthor` global, so a static build prints the same name.

## Consequences

- Breaking: a site whose `author` was free text that no user answers to becomes a site with several authors. Its footer and its feeds print the site title instead of the old name, and its homepage carries no bio.
- The feeds' item revision moved to 6, so every post feed's validator changes once at the upgrade. A change to a user's display name changes the validator of every feed that prints it.
- Choosing a user on the General page makes the root their IndieAuth identity (decision-23). Choosing Several authors takes it away.
- A new site starts with several authors: the starter `site.json` names nobody, because no user exists until the first one signs up.
