# Overriding a template

A site keeps its themes under one directory, `themes/` by default and
`themesDir` in the config, with one folder per theme and a `theme.json` in
each. Which one it wears is one setting, `theme` in `content/_data/site.json`,
holding the folder's name:

```
themes/
  midnight/
    theme.json
    layouts/post.njk
    static/style.css
```

```json
{ "theme": "midnight" }
```

The setting is what **Appearance > Themes** in the admin writes: the screen
lists this theme and every folder under `themes/`, marks the one in use, and
Activate on another writes its name — or, on the packaged theme, takes the key
out again. A change takes effect on the next request, with no restart, and a
folder whose manifest will not read is listed under "Not themes" with the
reason rather than quietly left out.

Resolution order for any template is then that theme first, the default theme
second, one file at a time. The theme above replaces the post layout and keeps
receiving updates to every other template, and `static/style.css` replaces the
stylesheet the same way — assets under `/theme/` resolve in the same order.
Link a theme file with the `asset` filter rather than a literal `/theme/`
path: `{{ "style.css" | asset }}` puts a hash of the file in the URL, so a
reader's browser keeps it for a year and still fetches the new one the moment
it changes. The plain `/theme/style.css` keeps working, cached for an hour. A
site that has chosen no theme reads this one and nothing else, and a theme
sitting in `themes/` that the setting does not name is never on the path at
all. A `theme` naming a folder that is not there, or is not a theme, falls back
to this one with a warning in the log rather than a broken site.

The admin is not a theme and has no setting. Its templates live in their own
tree with a loader of their own, off this search path entirely, so no theme can
shadow the login form or the CSRF field inside it.

An override is a normal Nunjucks template, so it can extend or include the
packaged ones by name:

```njk
{% extends "layouts/base.njk" %}

{% block content %}
<article>
  <h1>{{ title }}</h1>
  {{ content | safe }}
</article>
{% endblock %}
```

`layouts/base.njk` defines the blocks `title`, `speculationRules`,
`viewTransitions`, `head`, `alternates`, `header`, `breadcrumbs`, `content`,
`footer` and `scripts`, so most sites never have to copy it.

Two layouts are named for the pages the Reading settings pick:

| Template                 | Rendered for                  | Shipped here | Falls back to      |
| ------------------------ | ----------------------------- | ------------ | ------------------ |
| `layouts/front-page.njk` | the page served at `/`        | yes          | `layouts/page.njk` |
| `layouts/posts-page.njk` | the listing on the posts page | no           | `layouts/home.njk` |

`layouts/front-page.njk` is a layout here rather than only an override point:
see [The front page](page-shell.md#the-front-page) for what it draws. Overriding it is how a
front page is laid out differently from every other page without overriding the
layout they all use, and the fallback above is reached only by a theme that
replaced it with nothing.

There is no posts page layout: a site that sets one gets the listing layout
until it writes one. On the posts page the page's own front matter and rendered
body are on the context beside the listing, so `{{ content | safe }}` prints its
words above the posts; `layouts/home.njk` already does.
