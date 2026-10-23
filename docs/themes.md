# Themes

## Choosing a theme

Each theme is a directory under `themesDir` (`themes/` by default). Each
directory holds a `theme.json` that names the theme:

```json
{
  "name": "Midnight",
  "kind": "site",
  "description": "Dark, quiet, mostly type."
}
```

| Field         | Meaning                                     |
| ------------- | ------------------------------------------- |
| `name`        | The name shown to people.                   |
| `kind`        | Always `site`.                              |
| `description` | Optional. A short description of the theme. |

`site` is the only kind. The field exists so that another kind can be added
later without a format change. The directory name is the theme's id.

The `theme` setting in `content/_data/site.json` holds the id of the active
theme:

```json
{ "theme": "midnight" }
```

Choose the theme on **Appearance > Themes** in the admin. The screen lists the
theme inside this package and every folder under `themesDir`, with each one's
name and description, and marks the one in use.

- **Activate** on another theme writes the `theme` setting.
- **Activate** on the packaged theme removes the `theme` key from `site.json`.
  A site that uses the packaged theme has no `theme` key, not an empty one.
- A folder whose `theme.json` is missing, unparseable or names another kind is
  listed under "Not themes" with the reason. A typo in a manifest shows up on
  this screen.

The change takes effect on the next request, with no restart. Editing the
setting by hand has the same effect. Nothing creates `themes/` for you. A site
has the directory only after you add a theme to it.

The renderer looks up each template in the active theme first, then in the
theme that ships inside this package. The lookup is per file. A site can
override one template and still receive package updates to the rest. Files
under `/theme/` resolve the same way, so `themes/midnight/static/style.css`
replaces the packaged stylesheet. The [email messages](email.md#messages)
under `mail/` resolve the same way too.

A layout links a theme file with `{{ "style.css" | asset }}`. The filter writes
a URL that holds a hash of the file's bytes. That URL is cached for a year as
`immutable`. The plain `/theme/style.css` is cached for an hour.

Image variants and icons under `/uploads/_/` work the same way. The page links
them with a hash of the original upload's bytes as `v`. If you delete a picture
and upload a new one under the same name, it gets new URLs. A request with a
matching `v` is cached for a year as `immutable`. A request with no `v`, or a
stale one, still gets the file, cached for a day.

Neither the setting nor `themesDir` has to exist. A site that names no theme
serves every page, the 404 and the stylesheet from the packaged theme. A theme
in `themes/` that is not chosen changes nothing. If `theme` names a directory
that does not exist, or one whose manifest does not parse, the site falls back
to the packaged theme and logs a warning.

A theme that ships only

```
themes/midnight/layouts/post.njk
```

replaces the post layout. The base layout, the archive, the tag pages and the
404 still come from the package. Templates are Nunjucks, and an override can
extend a packaged template by name:

```njk
{% extends "layouts/base.njk" %}

{% block content %}
<h1>{{ title }}</h1>
{{ content | safe }}
{% endblock %}
```

The admin is not themed (decision-4, decision-15). Its templates and static
files live in a separate tree with a separate loader, outside this search path.
No theme can shadow the login form or the CSRF field inside it.

Analytics and other markup for every page need no layout. The packaged
`layouts/base.njk` includes `partials/head-end.njk` last in `<head>` and
`partials/body-end.njk` last in `<body>`. Both are empty in the package. A
theme made of `theme.json` and a `partials/head-end.njk` that holds the Umami
or Google Analytics snippet adds the snippet to every public HTML page and keeps
every other packaged template. Neither partial is printed in a feed, a
Markdown, text or JSON representation, mail, the admin or the editor's preview.
[Adding to every page](theme/adding-to-every-page.md) has the Umami and GA4
example, the Docker volume, and what a Content-Security-Policy must allow for
them.

## The packaged theme

Templates are Nunjucks (decision-4). The default theme lives in
`packages/cms/themes/default` and ships inside the package:

- `layouts/` holds the base layout, home, post, page, tag archive and 404.
- `partials/` holds the post list, the pager, the bio and the tag macros.
- `static/style.css` is served at `/theme/style.css`.

`pnpm build` compiles that stylesheet from `src/style.css` with Tailwind v4
(decision-22). The output is a build product. It is gitignored and shipped in
the package. A visitor's browser loads one plain CSS file, with no script or
CDN. A site that chooses a Google Fonts family on Appearance > Look also loads
that family's files from the site itself (see
[Heading and body fonts](settings.md#heading-and-body-fonts)). `pnpm --filter @geekity/cms build:theme` recompiles the stylesheet
alone. The package's `pretest` runs it before the test suites read the file.

The packaged theme is the Paper design (doc-9) on the andrewshell.org shell
(decision-16). A site theme's own `static/style.css` replaces the stylesheet
completely and needs no Tailwind. Every colour is a `--color-*` custom property
that a site can override.

`base.njk` is the shell. It contains:

- a skip link
- a `.global-wrapper` that carries `data-is-root-path="true"` at `/` only
- a header. On the front page it shows the site title and tagline. On every
  other page it shows a small link home. `menus.primary` is inside the header on
  every page.
- `<main id="main">`
- a footer with the copyright year, the site author's display name (the site
  title on a site with several authors), the colophon and `menus.footer`

The footer reads nothing from an account. It used to print an RSS link and one
`rel="me"` link for each link on the site author's profile. A site that wants
either adds it to its footer menu. The footer holds nothing specific to one
site. Put webrings and badges in a site theme's `footer` block.

The head carries:

- a description
- Open Graph and Twitter card tags
- icons derived from the site's avatar
- one JSON-LD `@graph` from `partials/jsonld.njk`

That partial is the only structured data the theme emits. There is no
Microdata. To emit a different graph, a site replaces that one file.

The stylesheet sets:

- serif body text and headings at an 18px root, read through the `heading` and
  `body` font roles, with sans for small labels
- one column at 42rem
- warm paper with a rust primary and a blue secondary
- six colour schemes (Paper, Slate, Forest, Plum, Ocean and Ink), each with a
  light and a dark set of the same `--color-*` tokens

Choose the scheme and the mode on **Appearance > Look** in the admin. The screen
shows each scheme of the theme in use as a card with its page, text, accent and
secondary colours in light and dark, read from the theme's compiled
stylesheet.

`packages/cms/src/web/theme-colors.test.ts` reads the `--color-*` custom
properties from the compiled stylesheet. It checks that every run of text in
every scheme, in both modes, meets 7:1 contrast and every border a visitor
relies on meets 3:1. A colour change that breaks either ratio fails the build.

The kicker above each entry names its kind. Only an article has a headline, so
a note or a reply shows just its words. The bio under an entry shows the person
who wrote it and nothing else.

## Template context

The context mirrors what an Eleventy layout receives. It has `title`, `date`,
`tags`, `categories`, `content`, `page.url` and every front matter key in the
file. It also has `site`, which is `content/_data/site.json`. A layout can move
between an Eleventy build and the CMS with few edits. The context, the blocks
and the filter set (`date`, `plural`, `url`, `asset`, `absoluteUrl`, `fediverseHandle`, `host`) are part of the
semver contract.

`author` is the one key that is not the front matter's own string. It is the
person the file names, resolved against the site's users. `author.name` is the
name to print. `author.url` is their archive at `/author/{username}/`, present
when the name matches a user.

`siteAuthor` is the same kind of object. It names who the current page is by:

- on a document, the entry's author
- on an author archive, the archive's person
- everywhere else, the profile behind the site's `author` setting

The bio, the `rel="me"` links and any structured data a theme emits all read
this one profile. The full table of context keys, blocks and filters is in
[The default theme](theme/README.md).

## Rendering without a request

You can call the renderer without a request:

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

`apps/demo/themes/demo/` is the worked example. The demo ships with the
packaged theme active, so `pnpm dev` shows what a new site gets. The demo theme
is one Appearance screen away. Beside its `theme.json` it holds two files:

- `layouts/post.njk` extends the packaged base layout and adds its own byline
  and a reading time.
- `static/style.css` replaces the packaged stylesheet at `/theme/style.css`.

Everything else the demo serves comes from the package.
`apps/demo/test/site.test.ts` checks both cases over HTTP. As the demo ships,
it asserts the packaged post layout and the packaged stylesheet. Against a copy
of the content with `"theme": "demo"` set, it asserts the byline, the reading
time and the demo stylesheet.

A stylesheet is the one all-or-nothing override. Assets resolve file by file,
the same as templates, so the server sends a site's `style.css` instead of the
packaged one, not after it.

`apps/demo/content/pages/contact.md` is the worked example of the contact form.
`contact: true` puts the contact form under the page, and the demo's
`menus.primary` lists the page so it appears in the menu. With the demo
running, a message sent through the form is written to `data/contact/` before
any email goes out, and it appears on **Messages** in the admin. The
`contactEmail` setting in `content/_data/site.json` sets where the message is
emailed. The server reads it when a submission arrives, and no template sees
it. `apps/demo/test/site.test.ts` asserts that the address appears in none of
the HTML the demo serves.

The demo's content directory also builds with Eleventy.
`apps/demo/eleventy.config.js` re-exports
[`packages/cms/docs/eleventy.config.example.js`](../packages/cms/docs/eleventy.config.example.js).
Your own site copies that file and owns the copy. The demo re-exports it so the
two cannot drift. `content/_includes/post.njk` and `page.njk` are the layouts
the directory data files name. `pnpm --filter demo build:11ty` writes `_site/`,
which is gitignored.

## Moving a `theme/` directory

Before named themes, a site had one `theme/` directory, always on the search
path, set by `themeDir` and `GEEKITY_THEME_DIR`. Both are gone and neither has
an alias. To move a site's `theme/` directory:

```sh
mkdir -p themes/mine
git mv theme/* themes/mine/
rmdir theme
```

Then:

1. Write `themes/mine/theme.json` with a `name` and `"kind": "site"`.
2. Choose the theme on **Appearance > Themes**, or put `"theme": "mine"` in
   `content/_data/site.json`.
3. Remove `themeDir` from `geekity.config.ts` and `GEEKITY_THEME_DIR` from the
   environment.

A config that names `themeDir` is now a type error, and the server ignores the
variable. Nothing inside the theme changes. The layouts, partials, `mail/` and
`static/` keep their names and their meaning. Until you choose the theme, the
site serves the packaged theme. Ship the move and the choice in the same
deploy.
