# Navigation

A site stores its menus by name in `content/_data/site.json`:

```json
{
  "menus": {
    "primary": [
      { "label": "Home", "url": "/" },
      { "label": "About", "url": "/about/" }
    ],
    "footer": [
      { "label": "Colophon", "url": "/colophon/" },
      { "label": "Mastodon", "url": "https://example.social/@me", "rel": "me" }
    ]
  }
}
```

Every template gets them as `menus`, keyed by the same names, already in order
and already knowing which item is the page being looked at:

```njk
{% for item in menus.footer %}
<a href="{{ item.url | url }}">{{ item.label }}</a>
{% endfor %}
```

That is the whole interface, so a theme renders a menu this one has never heard
of by looping over the name a site stored it under.

## The areas a theme declares

`theme.json` says where a theme renders a menu, so the Navigation screen can
offer those places and nowhere else. This theme declares two:

```json
{
  "name": "Default",
  "kind": "site",
  "areas": [
    { "name": "primary", "label": "Site menu" },
    { "name": "footer", "label": "Footer links" }
  ]
}
```

`name` is the key under `menus`, in `site.json` and on the context. `label` is
what a person choosing an area reads; leave it out and it falls back to the
name. Declare a third area and a site can fill it in; declare none and the
theme renders no menu.

The declaration is for the screen, not for the render. Every menu the site
stores is on the context whether or not a theme declared an area for it — a
menu nothing loops over is rendered nowhere and kept, which is what lets
somebody write the menu a theme will use before switching to that theme. An
`areas` that is missing, or that will not read, leaves the theme with none
rather than failing to load it.

## One item

Each item is `{ label, url, current }`, plus `rel` on a link that carries `rel`
values. `url` is a site-root path or an absolute URL for somewhere else, so put
it through the `url` filter and a site served from a subdirectory still links
correctly. `current` is true for the item whose path is the one being rendered,
comparing without the trailing slash; an item pointing off the site is never
current. `rel` is one string holding every value the line carried, already
lower case and each said once — print it as the whole attribute,
`rel="{{ item.rel }}"`, rather than building one of your own. `me` is the value
most menus have, for the IndieWeb's identity check: Mastodon verifies a link on
a profile by looking for a `rel="me"` link back, so a footer link to a profile
marked `me` is what makes the tick appear.

## Where this theme prints them

`partials/menu.njk` holds the markup, as one macro:

```njk
{% import "partials/menu.njk" as nav %}
{{ nav.list(menus.footer, "Footer") }}
```

The second argument is the `aria-label`, which is what tells a reader on a
screen reader which of a page's menus this one is. Nothing is printed for a
menu with nothing in it.

`menus.primary` is printed once, in `header.global-header`, on every page
(TASK-105). At the root, where the header is the site title with the tagline
under it, the menu is a line of its own under the tagline; everywhere else,
where the header is the small link home, the stylesheet lays the header out as
one line and the menu sits beside it. Nothing decides between two places any
more: a reader looks in the same spot whatever they are reading, and a layout
that overrides the `content` block cannot lose the navigation by not printing
a bio.

`menus.footer` is printed in the `footer` block of `layouts/base.njk`, under
the copyright line, and is the whole of what the footer links — a feed, a
colophon, a webring, a profile marked `me`. The footer reads nothing off an
account: it used to print one `rel="me"` link per entry of `siteAuthor.links`,
which meant one nominated user's links stood for the site and nobody else's
appeared at all.

Every menu reads the same: a link in one is the colour, the underline and the
size of a link in the page's prose, in the sans heading font a `nav` is set in
(TASK-111). A menu is navigation somebody is meant to use rather than a
footnote, so none of them is set smaller than the words around it, and the same
goes for the `rel="me"` links `partials/bio.njk` prints under a post. The two
links that read as plain text instead are the site title and
`a.header-link-home`, which are the page saying where it is rather than
somewhere to go, and the stylesheet names those two rather than reaching for
every link that happens to sit in a `<header>`.

`menus.primary` is the whole of the site menu, in the order the Navigation
screen names it. Both areas are declared in this theme's `theme.json`, which is
what puts them on `/admin/navigation` with those labels; a theme that renders a
third menu declares a third area. A page cannot put itself in a menu; a page
that should be linked — including the one a site serves as its front page,
typed `Home | /` — is typed into the box there.

Because the menus live in `site.json`, an Eleventy build of the same content
renders the same ones; `docs/eleventy.config.example.js` builds them as
`collections.menus`.
