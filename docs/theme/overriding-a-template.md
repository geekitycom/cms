# Overriding a template

A site keeps its themes in one directory, `themes/` by default. The
`themesDir` config option changes it. Each theme is a folder with a
`theme.json` in it. The `theme` setting in `content/_data/site.json` names the
folder the site uses:

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

**Appearance > Themes** in the admin writes this setting. The screen lists the
default theme and every folder under `themes/`, and marks the one in use.
Activate on another theme writes its name. Activate on the packaged theme
removes the key. A change takes effect on the next request, with no restart. A
folder whose manifest does not read is listed under "Not themes" with the
reason.

### Resolution order

The CMS resolves each template one file at a time:

1. The chosen theme.
2. The default theme.

The theme above replaces the post layout. It still gets updates to every other
template. Its `static/style.css` replaces the stylesheet in the same way.
Assets under `/theme/` resolve in the same order.

Link a theme file with the `asset` filter, not a literal `/theme/` path.
`{{ "style.css" | asset }}` puts a hash of the file in the URL. A visitor's
browser caches the file for a year and fetches the new one as soon as it
changes. The plain `/theme/style.css` URL still works and is cached for an
hour.

- A site that has chosen no theme uses only the default theme.
- A theme in `themes/` that the setting does not name is not on the search
  path.
- If `theme` names a folder that is missing or is not a theme, the CMS uses the
  default theme and logs a warning.

The admin is not a theme and has no setting. Its templates are in a separate
tree with a separate loader, outside this search path. No theme can override
the login form or the CSRF field in it.

### Extend a packaged template

An override is a normal Nunjucks template. It can extend or include the
packaged templates by name:

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
`footer` and `scripts`. Most sites do not need to copy it.

Two layouts are named for the pages the Reading settings pick:

| Template                 | Rendered for                  | Shipped here | Falls back to      |
| ------------------------ | ----------------------------- | ------------ | ------------------ |
| `layouts/front-page.njk` | the page served at `/`        | yes          | `layouts/page.njk` |
| `layouts/posts-page.njk` | the listing on the posts page | no           | `layouts/home.njk` |

The default theme ships `layouts/front-page.njk` as a full layout. See
[The front page](page-shell.md#the-front-page) for what it draws. Override it
to lay out the front page differently without overriding the layout that every
other page uses. The fallback to `layouts/page.njk` applies only when no theme
on the search path has `layouts/front-page.njk`.

The default theme has no posts page layout. A site that sets a posts page gets
the listing layout until the theme adds `layouts/posts-page.njk`. On the posts
page, the context holds the page's own front matter and rendered body next to
the listing. `{{ content | safe }}` prints the page's text above the posts.
`layouts/home.njk` already does this.
