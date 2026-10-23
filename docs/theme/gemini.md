# The Gemini representation

Every page with a Markdown representation also has a gemtext one at its
`.gmi` URL. See [The gemtext](../public-site.md#the-gemtext) for what it
holds. The CMS writes the title, the `Published` line, the page's own words
and the rewriting of the site's links. The theme writes the header and the
footer, and the body of each status page, as it does for the Markdown.

A theme does not need Gemini templates. Where it has none, the CMS renders
its Markdown template and converts the result to gemtext. A theme that
changes its Markdown footer changes its Gemini footer too.

## Slots

| Gemini template                  | Markdown template                 | Where it goes                       |
| -------------------------------- | --------------------------------- | ----------------------------------- |
| `partials/gemini-header.gmi.njk` | `partials/markdown-header.md.njk` | Above the page's words.             |
| `partials/gemini-footer.gmi.njk` | `partials/markdown-footer.md.njk` | Below the page's words, at the end. |
| `layouts/404.gmi.njk`            | `layouts/404.md.njk`              | The body of the 404 page.           |
| `layouts/410.gmi.njk`            | `layouts/410.md.njk`              | The body of the 410 page.           |
| `layouts/500.gmi.njk`            | `layouts/500.md.njk`              | The body of the 500 page.           |
| `layouts/503.gmi.njk`            | `layouts/503.md.njk`              | The body of the maintenance page.   |

## Lookup order

Each slot is looked up in four places. The first file that exists is used:

1. The chosen theme's `.gmi.njk`, written as it is.
2. The chosen theme's `.md.njk`, rendered and converted.
3. The default theme's `.gmi.njk`, written as it is.
4. The default theme's `.md.njk`, rendered and converted.

A theme's Markdown template therefore beats the default theme's Gemini
template. A site theme that overrides `layouts/404.md.njk` gets that body in
Gemini as well, converted.

The default theme ships Gemini templates for the four status pages only.
Their Markdown ends with a sentence of two links, which converts to
`Go home[1], or search the site[2].` over two numbered link lines. The Gemini
templates write the sentence and then two link lines:

```
Content not found.

=> /index.gmi Home
=> /search/index.gmi Search the site
```

The default header and footer convert well, because the footer writes its
links as lists and the CMS converts a list of links to plain link lines. The
default theme has no Gemini header or footer.

## Writing gemtext

A Gemini template renders with autoescaping **off** and is written to the
page as it is. Gemtext has no inline markup, so text needs no escaping. Keep
each link on its own line, with the URL and then the label:

```njk
{% for item in navigation %}
=> {{ item.url | geminiUrl }} {{ item.label }}
{% endfor %}
```

The parts of the page that come from Markdown are converted in one pass. A
paragraph's links are numbered through the whole page, `[1]`, `[2]` and so
on, with a numbered link line after each paragraph. A Gemini template's own
link lines are not numbered, and do not take a number from that count.

## The geminiUrl filter

`geminiUrl` does for Gemini templates what `markdownUrl` does for Markdown
ones. It gives a URL that the site answers with a document or a listing its
root-relative `.gmi` URL, and keeps the search's query. It leaves any other
URL as it is, such as another site's page, an upload or a feed:

```njk
=> {{ "/about/" | geminiUrl }} About
=> {{ "https://elsewhere.example/" | geminiUrl }} Elsewhere
```

```
=> /about/index.gmi About
=> https://elsewhere.example/ Elsewhere
```

On a Gemini page, `markdownUrl` gives the `.gmi` URL too, so a Markdown
template converted for Gemini links to gemtext. On a Markdown page,
`geminiUrl` leaves every URL as it is.

## Context

A Gemini template gets the same context as its Markdown counterpart. The
header and footer get the keys listed in
[The Markdown representation](markdown.md#context), and a status page's body
gets the keys listed under [Status pages](markdown.md#status-pages). The
filters are the same as well: `escapeMarkdown`, `nest`, `quote`, `fileSize`
and `markdownUrl`, plus `geminiUrl`.

A listing's `archiveMonths` have no `description` on a Gemini page, so a
list of them converts to gemfeed lines, `=> url YYYY-MM-DD title`.

## A broken template

When the 500 or 503 Gemini template fails to render, the CMS writes a fixed
body in its place, converted from the fixed Markdown body. A broken header,
footer, 404 or 410 template fails the request, as its Markdown counterpart
does.
