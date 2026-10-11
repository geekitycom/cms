# Themes

## Choosing a theme

A site's themes live one directory per theme under `themesDir` (`themes/` by
default), each with a `theme.json` naming it:

```json
{
  "name": "Midnight",
  "kind": "site",
  "description": "Dark, quiet, mostly type."
}
```

`name` is what a person reads, `kind` is `site` — the only kind there is, and
the field is in the file so another can be added later without the format
changing — and `description` is optional. The directory name is the theme's id.

One setting in `content/_data/site.json`, `theme`, says which one the site is
wearing, and that id is what it holds:

```json
{ "theme": "midnight" }
```

**Appearance > Themes** in the admin is where the choice is made. It lists the
theme inside this package and every folder under `themesDir` with its name and
description, marks the one in use, and Activate on another writes the setting —
or, on the packaged theme, takes the key out of `site.json` again, which is why
a site wearing it has no `theme` key rather than an empty one. A folder whose
`theme.json` is missing, unparseable or names another kind is listed under
"Not themes" with the reason, so a typo is something you can see on the screen
that would otherwise have shown the theme. Activating takes effect on the next
request, with no restart. Editing the setting by hand does exactly the same
thing. Nothing scaffolds `themes/`: a site has one once it writes a
theme.

A template is then looked up in that theme first and in the theme that ships
inside this package second, file by file. Sites override one template at a time
and keep receiving updates to the rest. Files under `/theme/` resolve the same
way, so `themes/midnight/static/style.css` replaces the packaged stylesheet,
and the [email messages](email.md#messages) under `mail/` resolve the same way too.

A layout links a theme file with `{{ "style.css" | asset }}`, which writes a
URL with a hash of the file's bytes in it; that URL is cached for a year as
`immutable`, and the plain `/theme/style.css` for an hour. Image variants and
icons under `/uploads/_/` work the same way: the page links them with a hash of
the original upload's bytes as `v`, so a picture deleted and replaced under the
same name gets new URLs. A matching `v` is cached for a year as `immutable`;
no `v`, or a stale one, still gets the file, for a day.

Neither the setting nor `themesDir` need exist. A site that names no theme
serves every page, the 404 and the stylesheet out of the packaged theme, and an
unchosen theme sitting in `themes/` changes nothing. A `theme` naming a
directory that is not there, or one whose manifest will not read, falls back to
the packaged theme with a warning in the log rather than a broken site.

A theme that ships only

```
themes/midnight/layouts/post.njk
```

replaces the post layout; the base layout, the archive, the tag pages and the
404 all still come from the package. Templates are Nunjucks, and an override
can extend a packaged one by name:

```njk
{% extends "layouts/base.njk" %}

{% block content %}
<h1>{{ title }}</h1>
{{ content | safe }}
{% endblock %}
```

The admin is not themed (decision-4, decision-15). Its templates and its static files live in a tree of
their own with a loader of their own, deliberately off this search path, so no
theme can shadow the login form or the CSRF field inside it.

Analytics and other markup that goes on every page need no layout at all. The
packaged `layouts/base.njk` includes `partials/head-end.njk` last in `<head>`
and `partials/body-end.njk` last in `<body>`, both empty in the package, so a
theme of `theme.json` and `partials/head-end.njk` holding the Umami or Google
Analytics snippet adds it to every public HTML page and keeps every other
packaged template. Neither is printed in a feed, a Markdown, text or JSON
representation, mail, the admin or the editor's preview. [Adding to every page](theme/adding-to-every-page.md) has the
Umami and GA4 example, the Docker volume, and what a Content-Security-Policy
has to allow for them.

## The packaged theme

Templates are Nunjucks (decision-4). The default theme lives in
`packages/cms/themes/default` and ships inside the package: `layouts/` for the
base layout, home, post, page, tag archive and 404; `partials/` for the post
list, the pager, the bio and the tag macros; `static/style.css`, served at
`/theme/style.css`. That stylesheet is compiled from `src/style.css` with
Tailwind v4 by `pnpm build` (decision-22): a build product, gitignored and
shipped in the package, and one plain CSS file to a reader, with no script,
web font or CDN behind it. `pnpm --filter @geekity/cms build:theme` recompiles
it alone, and the package's `pretest` does so before its suites read it.

The packaged theme is the Paper design (doc-9) on the andrewshell.org shell
(decision-16). A site theme's own `static/style.css` replaces its stylesheet
wholesale and needs no Tailwind. Every colour is a `--color-*` custom property a site can override.
`base.njk` is its shell: a skip link, a `.global-wrapper` carrying `data-is-root-path="true"`
at `/` only, a header that is the site title and tagline on the front page and a
small link home on every other — with `menus.primary` inside it on every page
— `<main id="main">`, and a footer with the copyright year, the site author's
display name (the site title on a site with several authors), the colophon and
`menus.footer`. The footer reads nothing off an account: it
used to print an RSS link and one `rel="me"` link per link on the site author's
profile, and a site that wants either types it into its footer menu. Nothing
particular to one site is in it — webrings and badges belong in a site theme's
`footer` block. Its head
carries a description, Open Graph and Twitter card tags, icons derived from the
site's avatar, and one JSON-LD `@graph` from `partials/jsonld.njk`: that partial
is all the structured data the theme emits, there is no Microdata anywhere, and
a site that wants a different graph replaces the one file. The stylesheet
is a serif body and sans headings at an 18px root, one column at 42rem, warm
paper with a rust primary and a blue secondary, and a second scheme under
`prefers-color-scheme: dark` that redefines the same `--color-*` tokens on dark
paper. `packages/cms/src/web/theme-colors.test.ts` reads the `--color-*`
custom properties out of the compiled stylesheet and proves every run of text
in both schemes meets 7:1 and every border a reader relies on meets 3:1, so a
colour change that breaks one fails the build.

Its kicker above every entry names the entry's kind, so an article is the only
thing with a headline and a note or a reply is its words. The bio under an
entry carries the person it is by and nothing else.

## Template context

The context mirrors what an Eleventy layout receives — `title`, `date`, `tags`,
`categories`, `content`, `page.url`, and every front matter key the file
carried — plus `site`, which is `content/_data/site.json`, so a layout can move
between an Eleventy build and the CMS with few edits. The context, the blocks
and the filter set (`date`, `url`, `absoluteUrl`, `asset`) are part of the
semver contract.
The one key that is not the front matter's own string is `author`: it is the
person the file names, resolved against the site's users, with `author.name` to
print and `author.url` — their archive at `/author/{username}/` — to link to
when the name is one of them. `siteAuthor` is the same object answering a
different question — who the page in front of the reader is by, which is the
entry's author on a document, the archive's person on an author archive and the
profile behind the site's `author` setting everywhere else — so the bio, the
`rel="me"` links and any structured data a theme emits all read one profile.
The full table of context keys, blocks and
filters is in [The default theme](theme/README.md).

## Rendering without a request

Rendering is also callable without a request:

```ts
import { createRenderer, resolveConfig } from '@geekity/cms';

const renderer = createRenderer({
  config: resolveConfig({ baseUrl: 'https://example.com' }),
});
renderer.renderDocument(document); // the HTML the site would serve
renderer.site(); // content/_data/site.json, defaults filled in
```

Handlers reach the same renderer as `c.var.renderer`, alongside `c.var.store`
and `c.var.config`.

## The demo theme

`apps/demo/themes/demo/` is the worked example. The demo ships wearing the
packaged theme, so `pnpm dev` shows what a new site gets, and the demo theme is
one Appearance screen away. Beside its `theme.json` it holds two files:
`layouts/post.njk`, which extends the packaged base layout and adds a byline of
its own and a reading time, and `static/style.css`, which replaces the packaged
stylesheet at `/theme/style.css`. Everything else the demo serves still comes
from the package. `apps/demo/test/site.test.ts` asserts both halves over HTTP:
the packaged post layout and the packaged stylesheet as the demo ships, and,
against a copy of the content with `"theme": "demo"` written in, the byline,
the reading time and the demo stylesheet. A stylesheet is the one
all-or-nothing override: assets resolve file by file the way templates do, so a
site's `style.css` is served instead of the packaged one, not after it.

`apps/demo/content/pages/contact.md` is the worked example of the other kind of
opt-in: `contact: true` puts the contact form under the page, and the demo's
`menus.primary` names it so the page is in the menu. Send it a message with the demo
running and the message is written to `data/contact/` before anything is
emailed, and is waiting on **Messages** in the admin. Where it is emailed is the
`contactEmail` setting in `content/_data/site.json`, which is read when the
submission arrives and reaches no template — `apps/demo/test/site.test.ts`
asserts that address is in none of the HTML the demo serves.

The demo's content directory also builds with Eleventy.
`apps/demo/eleventy.config.js` re-exports
[`packages/cms/docs/eleventy.config.example.js`](../packages/cms/docs/eleventy.config.example.js) —
a site of your own copies that file and owns the copy, but the demo re-exports
it so the two cannot drift — and `content/_includes/post.njk` and `page.njk`
are the layouts the directory data files name. `pnpm --filter demo build:11ty`
writes `_site/`, which is gitignored.

## Moving a `theme/` directory

Before named themes a site had one `theme/` directory, always on the search
path, pointed at by `themeDir` and `GEEKITY_THEME_DIR`. Both are gone and
neither is aliased, so a site carrying one moves it:

```sh
mkdir -p themes/mine
git mv theme/* themes/mine/
rmdir theme
```

Then write `themes/mine/theme.json` with a `name` and `"kind": "site"`, choose
it on **Appearance > Themes** (or put `"theme": "mine"` in
`content/_data/site.json`), and drop `themeDir` from `geekity.config.ts` and
`GEEKITY_THEME_DIR` from the environment — a config naming `themeDir` is now a
type error and the variable is ignored. Nothing inside the theme changes: the
layouts, partials, `mail/` and `static/` keep their names and their meaning.
Until it is chosen the site serves the packaged theme, so the move and the
choice belong in the same deploy.
