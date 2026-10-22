---
id: decision-60
title: >-
  A site serves gemtext over gemini:// and as .gmi over HTTP, made from the same
  data as its Markdown, with a self-signed TOFU certificate and theme templates
  that fall back to converted Markdown
date: '2026-10-22 12:06'
status: accepted
---
## Context

Every public page already has a Markdown representation (doc-3, TASK-346, M45). It is built from the stored Markdown body plus navigation, menus and bylines passed to the theme as label-and-URL data. The `.md` suffix is added only when a link is written, through one resolver (`markdownHrefFor` and `representationHref`), so the same data could feed another format. Gemini (gemtext, `text/gemini`) was planned as that next format once andrewshell.org moved to the CMS.

Gemtext has no inline links, no emphasis, no tables and only three heading levels, so Markdown has to be converted. The usual converter, the Python md2gemini, was archived in 2023 and is LGPL-3.0. Gemini runs its own protocol over TLS on port 1965. Clients trust a server's certificate the first time they see it (TOFU), so the certificate must stay stable for years. An HTTP reverse proxy cannot forward Gemini, but a layer-4 proxy can: Caddy with `caddy-l4`, or nginx `stream` with `ssl_preread`. Such a proxy can route by SNI, so several sites on one host can share 1965.

## Decision

**Conversion is its own package.** `@geekity/md2gemini` is a standalone TypeScript library in this workspace, published like the plugins. It parses with markdown-it, which core already uses. It takes md2gemini's options and behaviour as a spec, not its code, so the LGPL does not reach it. Its link modes are `paragraph` (the default), `at-end`, `copy`, `newline` and `off`. A list whose every item is a single link, optionally with a date or a short note, becomes plain `=>` lines with no numbered markers. Archives, tag pages, menus and link lists therefore read as Gemini link lists rather than footnoted prose.

**Gemtext is a representation.** `gemini` joins the representations, with a `.gmi` suffix (`/x/index.gmi`) and the `text/gemini; charset=utf-8` media type over HTTP. It is built from the same data as the Markdown: the stored body converted by md2gemini, and links to the site's own pages pointed at their `.gmi` by the same resolver that gives `.md`. Front matter is not written. The title, date, home, previous and next become heading and link lines instead. Listings are written as gemfeed lines (`=> url YYYY-MM-DD title`), so Gemini feed readers can subscribe to any listing.

**Themes may write Gemini, and otherwise get their Markdown converted.** Each Gemini slot (header, footer, the 404, 410, 500 and 503 pages) is looked up in four places, and the first match is used:

1. the chosen theme's `.gmi.njk`
2. the chosen theme's `.md.njk`, rendered and converted
3. the default theme's `.gmi.njk`
4. the default theme's `.md.njk`, rendered and converted

So a site theme that customises its Markdown gets the same customisation in Gemini without writing anything new. A `geminiUrl` filter does for Gemini templates what `markdownUrl` does for Markdown templates.

**gemini:// is a listener in the CMS process.** It is a TLS server next to the HTTP one, started and closed with it and kept through a supervised reload. It answers only for the site's own host. It maps the site's redirects and statuses onto Gemini codes and serves uploads as binary responses. Search asks for its query with status 10. It is off until a setting enables it.

**The certificate is generated and kept.** On first start with Gemini enabled, the site creates a long-lived self-signed certificate for its host and stores it under `data/` as a secret. It is backed up and exported with the site. Config can point to the operator's own certificate and key instead. The CLI and the admin show the certificate's fingerprint.

**Deployment goes through a layer-4 proxy or direct.** The compose file binds the Gemini port to loopback, as it does for HTTP. The docs cover SNI passthrough with `caddy-l4`, including how to get a Caddy build that has it, and with nginx `stream`, plus publishing the port directly on a single-site host. Passthrough keeps TLS in Geekity, so the certificate clients pin is the site's own. When the site trusts its proxy, it reads PROXY protocol v2 so throttling and the access log see the visitor's address.

## Consequences

- A theme author can ignore Gemini and still get a sensible capsule. Writing `.gmi.njk` templates is an option, not a requirement.
- Every Markdown change now has a Gemini consequence. A new page kind or chrome block needs a Gemini check as well as an HTML and a Markdown one.
- `@geekity/md2gemini` is a new published package that `@geekity/cms` depends on. It needs its own release-please entry, commitlint scope and Dockerfile manifest line.
- The `data/` file classes gain a secret certificate and key, which must survive an export and import, or every Gemini client sees a new identity and warns.
- Stock Caddy cannot forward Gemini. An operator who wants several Gemini sites on one host needs a Caddy build with `caddy-l4`, or nginx `stream`.
- Writing over Gemini, such as comments or Titan uploads, is not covered. The capsule is read-only.
