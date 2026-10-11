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

Every template gets them as `menus`, keyed by the same names. Each menu is in
order, and each item says whether it is the current page:

```njk
{% for item in menus.footer %}
<a href="{{ item.url | url }}">{{ item.label }}</a>
{% endfor %}
```

To render any menu, including one the default theme does not use, loop over
the name the site stored it under.

## The areas a theme declares

`theme.json` lists where a theme renders a menu. The Navigation screen offers
only those areas. The default theme declares two:

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
the text the site owner sees when choosing an area. Without `label`, the screen
shows the name. If you declare a third area, the site owner can fill it in. If
you declare none, the theme renders no menu.

The declaration affects only the Navigation screen, not rendering. Every menu
the site stores is on the context, whether or not the theme declared an area
for it. A menu that no template loops over is not rendered, but the site keeps
it. So a site owner can write the menu a theme uses before switching to that
theme. If `areas` is missing or does not read, the theme has no areas. The
theme still loads.

## One item

Each item is `{ label, url, current }`, plus `rel` on a link that has `rel`
values.

| Field     | What it holds                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`   | The link text.                                                                                                                                            |
| `url`     | A site-root path, or an absolute URL for another site. Pass it through the `url` filter so that a site served from a subdirectory links correctly.        |
| `current` | `true` for the item whose path is the page being rendered. The comparison ignores the trailing slash. An item that points off the site is never current.  |
| `rel`     | One string with every value the item had, in lower case, each value once. Print it as the whole attribute, `rel="{{ item.rel }}"`. Do not build your own. |

`me` is the most common `rel` value. It is for the IndieWeb identity check.
Mastodon verifies a link on a profile by looking for a `rel="me"` link back. A
footer link to the profile, marked `me`, makes Mastodon show the verified tick.

## Where this theme prints them

`partials/menu.njk` holds the markup, as one macro:

```njk
{% import "partials/menu.njk" as nav %}
{{ nav.list(menus.footer, "Footer") }}
```

The second argument is the `aria-label`. It tells a screen reader user which
of the page's menus this is. The macro prints nothing for an empty menu.

### The site menu

The theme prints `menus.primary` once, in `header.global-header`, on every page
(TASK-105):

- At the root, the header is the site title with the tagline under it. The
  menu is on its own line under the tagline.
- On every other page, the header is the small link home. The stylesheet lays
  the header out as one line, with the menu beside the link.

The menu is in the same place on every page. A layout that overrides the
`content` block cannot drop the navigation.

### The footer links

The theme prints `menus.footer` in the `footer` block of `layouts/base.njk`,
under the copyright line. These are the only links in the footer, for example a
feed, a colophon, a webring, or a profile marked `me`. The footer reads nothing
from a user account. It used to print one `rel="me"` link for each entry of
`siteAuthor.links`. That showed one chosen user's links for the whole site and
no other user's.

### How menu links look

A link in any menu has the colour, the underline and the size of a link in the
page's prose, in the sans heading font of a `nav` (TASK-111). Menus are for
navigation, so no menu is smaller than the text around it. The same applies to
the `rel="me"` links that `partials/bio.njk` prints under a post. Two links look
like plain text: the site title and `a.header-link-home`. They show where the
visitor is, not a place to go. The stylesheet targets those two by name, not
every link in a `<header>`.

### Editing the menus

`menus.primary` is the complete site menu, in the order the Navigation screen
gives it. The default theme's `theme.json` declares both areas, which puts them
on `/admin/navigation` with those labels. A theme that renders a third menu
declares a third area. A page cannot add itself to a menu. To link a page,
including the page the site serves as its front page, type it into the box on
that screen, as `Home | /`.

The menus are in `site.json`, so an Eleventy build of the same content renders
the same menus. `docs/eleventy.config.example.js` builds them as
`collections.menus`.
