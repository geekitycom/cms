---
id: decision-3
title: Content files follow Eleventy conventions
date: '2026-09-02 13:21'
status: accepted
---
## Context

Inventing a content format would force a migration path for anyone who wants to leave, and would not be better than an existing well-documented one. Eleventy's conventions (YAML front matter, `permalink`, `tags`, `date`, directory data files, underscore-prefixed ignored directories) already cover what a posts-and-pages CMS needs.

## Decision

Content files use only Eleventy-meaningful front matter keys plus a namespaced `activitypub` block and `updated`/`author` keys that Eleventy ignores. `permalink` is always written explicitly. Directory data files (`posts.json`, `pages.json`) supply layout and the `post` tag. Trash is `content/_trash/`, which Eleventy skips. Site settings are mirrored into `content/_data/site.json`.

## Consequences

- A test builds the fixtures directory with Eleventy in CI to prove compatibility does not regress.
- URLs must match between the two systems, hence explicit `permalink` and trailing-slash canonicalisation.
- Drafts rely on the `draft` key, which needs a small preprocessor in an Eleventy config; we ship an example `eleventy.config.js` in the docs directory.
- The CMS must preserve unknown front-matter keys on round trip so hand-added data survives admin edits.
