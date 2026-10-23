# @geekity/md2gemini

Converts Markdown to gemtext, the text format of the
[Gemini protocol](https://geminiprotocol.net/docs/gemtext-specification.gmi).
Gemtext has no inline links, no emphasis, no tables and only three heading
levels, so each of those is rewritten into something gemtext can show.
[Geekity CMS](https://github.com/geekitycom/cms/blob/main/packages/cms/README.md)
uses it to serve its pages over Gemini, but the package has no dependency on
the CMS and works on any Markdown.

## Usage

```sh
pnpm add @geekity/md2gemini
```

```ts
import { convert } from '@geekity/md2gemini';

const gemtext = convert(markdown, {
  plain: true,
  rewriteLink: (url) => url.replace(/\.md$/, '.gmi'),
});
```

`convert` takes the Markdown as a string and returns the gemtext, which ends
with a newline unless it is empty. It parses with
[markdown-it](https://github.com/markdown-it/markdown-it), with HTML,
footnotes and bare URLs turned on.

## Options

| Option             | Default       | What it does                                                                           |
| ------------------ | ------------- | -------------------------------------------------------------------------------------- |
| `links`            | `'paragraph'` | Where each link's `=>` line goes. See below.                                           |
| `plain`            | `false`       | Removes emphasis, strong, strikethrough and inline code markup, and inline HTML.       |
| `stripHtml`        | `false`       | Removes inline and block HTML.                                                         |
| `stripFrontMatter` | `false`       | Removes YAML (`---`) or TOML (`+++`) front matter from the start of the document.      |
| `rewriteLink`      | none          | A function applied to the URL of every link and image, for example to point at `.gmi`. |
| `imageTag`         | `'[IMG]'`     | Written after an image's alt text on its `=>` line. An empty string leaves it out.     |
| `codeTag`          | `''`          | Alt text for a code block that names no language.                                      |
| `tableTag`         | `'table'`     | Alt text for a table's preformatted block. An empty string leaves it out.              |
| `indent`           | two spaces    | Written once for each level of a nested list item.                                     |
| `checklist`        | `true`        | Draws GFM `[ ]` and `[x]` list items as `☐` and `☑`. When false they stay as written.  |

## Link modes

Gemtext links are lines of their own, `=> url label`. The `links` option says
where those lines go. For this paragraph:

```markdown
Read the [guide](https://example.com/guide) first.
```

- `paragraph` numbers the link and lists it after the paragraph:

  ```
  Read the guide[1] first.

  => https://example.com/guide 1: https://example.com/guide
  ```

- `at-end` numbers links the same way and lists them all at the end of the
  document.
- `copy` leaves the text alone and lists the link after the paragraph, with
  the link text as its label: `=> https://example.com/guide guide`.
- `newline` breaks the paragraph and puts the link line where the link was:

  ```
  Read the
  => https://example.com/guide guide
  first.
  ```

- `off` keeps only the link text.

Link lines follow the whole top-level block the link sits in. The links of a
list, a blockquote, a heading or a table are listed after it, not between its
lines. Where a link line cannot stand on its own (a heading, a table cell or a
blockquote), `newline` keeps the link text and lists the link after the block,
as `copy` does.

## Lists of links

A list whose every item is one link, optionally with a date or a short note,
becomes plain `=>` lines with no numbers and no list markers. This holds in
every link mode except `off`, which gives an ordinary list. An archive or a
menu therefore reads as a Gemini link list:

```markdown
- [First post](/first/) 2026-10-01
- 2026-09-01 [Older post](/older/)
```

```
=> /first/ First post 2026-10-01
=> /older/ 2026-09-01 Older post
```

The label is the item's whole text, with the link text in place of the link.
A note may be up to 60 characters of text outside the link. An item with no
link, a second link, an image, a longer note or a nested block makes the list
an ordinary one.

A paragraph that is one link and nothing else becomes a single `=>` line
labelled with the link text, in every link mode except `off`. A byline such
as `[Written by Ada](/author/ada/)` reads `=> /author/ada/ Written by Ada`.

## Other elements

- Headings deeper than `###` become `###`.
- Tables become a preformatted block drawn with box-drawing characters, with
  each column aligned as the Markdown asks.
- Fenced code keeps its language as the preformatted block's alt text.
- Images become `=> url alt [IMG]` lines. An image inside a paragraph breaks
  it. A linked image gives two lines, the image and then the link.
- Blockquotes become `>` lines.
- Nested lists are flattened, each level indented by `indent`. Ordered items
  keep their numbers as text, because gemtext has no numbered list.
- Footnote references are written `[^1]`, and the notes are gathered at the
  end as `[^1]: text`.
- A thematic break becomes `---`.

## Relation to md2gemini

This package follows the options and behaviour that the Python
[md2gemini](https://github.com/makew0rld/md2gemini) documents, with a few
changes: `paragraph` is the default link mode, the list-of-links and
lone-link rules are new, and `rewriteLink` replaces md2gemini's `md_links`,
`base_url` and `link_func`.
Its code is written from scratch on markdown-it. It is not derived from
md2gemini's code, which is LGPL-3.0 and was archived in 2023. This package is
MIT licensed.
