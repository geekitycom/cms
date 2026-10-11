# Taxonomy macros

`partials/tags.njk` holds one macro per taxonomy, and each renders nothing at
all for an empty list. Both are one `p.post-categories` of `p-category` links,
which is the shape the design prints in a feed item's meta line and under an
entry — `categories` marks each link `rel="category"` and `list` marks each
`rel="tag"`, so under an entry the two read as one line of what it is filed
under, categories first:

```njk
{% import "partials/tags.njk" as taxonomy with context %}
{{ taxonomy.categories(categories) }}
{{ taxonomy.list(tags) }}
```

`list` links to `/{{ site.tagBase }}/{tag}/`, the tag in lower case, and `categories` to
`/{{ site.categoryBase }}/{category}/`, which is where the CMS serves each
archive. Both bases are settings — `tag` and `category` until the settings
screen says otherwise — and they reach a template through `site`, which is why
the import above carries `with context`: a macro imported without it cannot see
`site` and would fall back to the defaults.
