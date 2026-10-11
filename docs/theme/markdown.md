# The Markdown representation

Every post, page and listing has a Markdown representation at its `.md` URL.
See [The Markdown](../public-site.md#the-markdown) for what it holds. The CMS
writes the front matter, the page's own Markdown and the rewriting of the
site's links. The theme writes the header and the footer.

| Template                          | Where it goes                                       |
| --------------------------------- | --------------------------------------------------- |
| `partials/markdown-header.md.njk` | After the front matter, before the page's Markdown. |
| `partials/markdown-footer.md.njk` | After the page's Markdown, at the end of the file.  |

Both resolve like every other template. For example, a
`partials/markdown-footer.md.njk` in the site's theme replaces the footer. The
header still comes from the package. See
[Overriding a template](overriding-a-template.md).

## Escaping

The two partials render with autoescaping **off**, because Markdown is not
HTML. An `&` stays an `&`. Print text through the `escapeMarkdown` filter.
It puts the text on one line and escapes the characters that would start
emphasis, code, a link or raw HTML, so a label prints as written:

```njk
- [{{ item.label | escapeMarkdown }}]({{ item.url | markdownUrl }})
```

## Links

Every link in the context is data: a `label` and the canonical `url` of what
it names, never a `.md` URL. Write a link through the `markdownUrl` filter.
It gives a URL that the site answers with a document or a listing its
root-relative `.md` URL. It leaves any other URL as it is, such as another
site's page or `/search/`. The data stays the same for a renderer of another
format, such as a Gemini page:

```njk
{% for item in navigation %}
=> {{ item.url | markdownUrl }} {{ item.label }}
{% endfor %}
```

## Context

| Key           | What it is                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `site`        | `content/_data/site.json`.                                                                                                 |
| `url`         | The path the page is served at.                                                                                            |
| `title`       | The heading to write. Absent when the page has no title, or when its body opens with a level-one heading of its own.       |
| `home`        | A link to the homepage.                                                                                                    |
| `previous`    | A post's older neighbour, or a listing's newer page. Absent when there is none.                                            |
| `next`        | A post's newer neighbour, or a listing's older page. Absent when there is none.                                            |
| `byline`      | On a post whose author is a user: the author's display name and the URL of their archive.                                  |
| `bio`         | On an author archive, and on the homepage of a site whose author is a user: `name`, `url`, `note` (their bio) and `links`. |
| `navigation`  | Every item of every menu the site stores, each URL once, in the order the menus are stored.                                |
| `menus`       | The same menus by name, as the HTML has them. See [Navigation](navigation.md).                                             |
| `soloAuthor`  | The site's author, on a site whose author is a user. The same object the HTML has.                                         |
| `newestPosts` | On the homepage, when it is a page: the function the front page layout has. See [Template context](template-context.md).   |

`home`, `previous`, `next` and `byline` are each a `label` and a `url`. So is
each of `bio.links` and each `navigation` item. The front matter carries
`home`, `previous` and `next` already, for a Markdown browser.

## The default partials

The default header writes `title` as a level-one heading, then the bio's note
and its links as a list.

The default footer writes nothing when there is no byline and no navigation.
Otherwise it writes the site's title as a level-two heading, the byline as a
link line, and the navigation as a list:

```markdown
## Field Notes

[Written by Ada Lovelace](/author/ada/index.md)

- [Home](/index.md)
- [About](/about/index.md)
- [Search](/search/)
- [Mastodon](https://mastodon.example/@ada)
```

Each link is on a line of its own with its own label, so the same data
maps onto Gemini link lines.
