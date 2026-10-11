# Taxonomy macros

`partials/tags.njk` holds one macro per taxonomy. Each macro renders nothing
for an empty list. Each renders one `p.post-categories` of `p-category` links.
The design prints this shape in a feed item's meta line and under an entry.

- `categories` marks each link `rel="category"`.
- `list` marks each link `rel="tag"`.

Under an entry, the two read as one line of what the entry is filed under,
categories first:

```njk
{% import "partials/tags.njk" as taxonomy with context %}
{{ taxonomy.categories(categories) }}
{{ taxonomy.list(tags) }}
```

`list` links to `/{{ site.tagBase }}/{tag}/`, with the tag in lower case.
`categories` links to `/{{ site.categoryBase }}/{category}/`. The CMS serves
each archive at these URLs. Both bases are settings. They default to `tag` and
`category` until the settings screen changes them. They reach a template
through `site`, so the import above uses `with context`. A macro imported
without it cannot see `site` and falls back to the defaults.
