# Geekity CMS documentation

Each page covers one topic. The [root README](../README.md) says what the
CMS is and how to start a site.

## Use it

- [Getting started](getting-started.md). Create a site, add the package to a project, and upgrade it.
- [The `geekity` command](cli.md). What each `geekity` command does, and how `geekity serve` reloads.
- [Configuration](configuration.md). Every config field and environment variable, `createCms`, and the access log.
- [The package API](public-api.md). Every export of `@geekity/cms` a site's own code can import.

## Write content

- [Content](content.md). Documents on disk, the two directories, the index, dates, scheduling and unlisted posts.
- [The admin](admin.md). The admin screens, the editor, users, menus, and tags and categories.
- [Site settings](settings.md). The settings pages, `site.json`, and what the front page shows.
- [Media](media.md). The media library, alt text, stripped metadata and image variants.

## Run the site

- [The public site](public-site.md). Routes, redirects, health and maintenance, content negotiation, sitemap, llms.txt, IndexNow and compression.
- [Security](security.md). Login and session hardening, password recovery, security headers and security.txt.
- [Deploying](deploying.md). Run the Docker image behind a proxy, back it up, upgrade it, and hold it in dev mode.
- [Email](email.md). How the site sends mail, through Brevo or SMTP, and what it sends.
- [Personal data](personal-data.md). Every piece of personal data the site keeps, how long, and how to erase it.

## Federate and converse

- [Federation](federation.md). ActivityPub delivery, replies, quotes, relays, profiles, and moving from WordPress.
- [Feeds](feeds.md). RSS, Atom and JSON Feed, comment feeds, podcasts and real-time notification.
- [Comments and the contact form](comments.md). Comments, moderation, notices and Akismet, and the contact form.
- [Webmentions](webmentions.md). Sending and receiving webmentions, and syndication targets.
- [Signing in with your own site](indieweb-sign-in.md). Sign in to IndieAuth apps with your own site, and manage the apps.
- [Micropub](micropub.md). Post, edit and upload from a Micropub app.

## Extend and theme

- [Plugins and hooks](plugins.md). Install, write and bundle plugins, and run code of your own on a change.
- [Themes](themes.md). How themes are chosen and looked up, and how a site theme overrides the default.
- [The default theme](theme/README.md). Its files, templates, context and filters.
- [Building the same content with Eleventy](eleventy.md). The example config, what carries over, and the test that keeps the URLs equal.

## Contribute

- [Developing Geekity CMS](development.md). The workspace, its commands and gates, CI and releasing.
