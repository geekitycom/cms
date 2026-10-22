# The default theme

The default theme's templates ship in
[`packages/cms/themes/default/`](../../packages/cms/themes/default/), inside the
published package. Every site gets them without copying any files.

```
themes/default/
  theme.json     the manifest: name, kind, description and colours
  layouts/
    base.njk     the page every other layout extends
    home.njk     the post archive, paginated
    front-page.njk  the page the Reading setting serves at /
    post.njk     one post
    page.njk     one page
    tag.njk      a tag archive, paginated
    category.njk a category archive, paginated
    author.njk   one person's archive, paginated
    search.njk   the search form and what it found, paginated
    404.njk      nothing at this URL
    410.njk      what was at this URL was deleted
    500.njk      the request failed on the server
    503.njk      the site is in maintenance mode
    404.md.njk   the 404 page's Markdown body, and likewise 410, 500 and 503
    comment.njk  a native comment on a page of its own
  partials/
    post-list.njk     the h-feed a listing is made of
    pagination.njk    previous/next pager
    tags.njk          macros for tag and category links
    kicker.njk        the line above an entry naming its kind and date
    reply-context.njk the citation of what a reply answers
    event.njk         when and where an event is
    citations.njk     the citation of what a like, repost or bookmark cites
    cited-page.njk    the name and author both citations print
    bio.njk           who an entry is by, as an h-card
    menu.njk          one named menu, as a nav of links
    feeds.njk         macros for the feed links in <head>
    conversation.njk  the replies, likes and boosts under a post or an open page
    comment.njk       one reply and its answers, as the thread and a comment page print it
    comment-form.njk  the form under a post or page that is taking comments
    contact-form.njk  the form on a page whose front matter says contact: true
    archive.njk       every post by month, on a page that says archive: true
    backlinks.njk     the site's own posts and pages that link to this one
    search-form.njk   the search box, on the search page
    head-end.njk      empty: what a site adds to the end of every <head>
    body-end.njk      empty: what a site adds to the end of every <body>
    markdown-header.md.njk  the top of every page's Markdown
    markdown-footer.md.njk  the end of every page's Markdown
  mail/
    test.*.njk              the Send test email message
    password-reset.*.njk    the forgot-password link
    password-changed.*.njk  the notice sent once a password has been set
    comment-pending.*.njk   the moderation notice
    comment-digest.*.njk    the hourly or daily digest of what is waiting
    comment-reply.*.njk     the notice a commenter gets about a reply
    contact-message.*.njk   a message from a page's contact form
  src/
    style.css    the stylesheet's source, compiled with Tailwind
  static/
    style.css    the compiled stylesheet, served at /theme/style.css
    highlight.js the code highlighter
```

The theme is plain Nunjucks templates and one stylesheet. The stylesheet
source is Tailwind v4 (`src/style.css`). The package build compiles it to
`static/style.css`:

- `static/style.css` is a build product and is gitignored in this repository.
- `pnpm build` writes it. The root `prepare` script runs `pnpm build` after an
  install and before a publish.
- The package ships it like every other file here.

The compile runs once, on the machine that builds the package. A visitor's
browser gets one plain CSS file and makes no script, web font or CDN request
for it.

The design is Paper (doc-9, decision-22): one warm column, serif throughout,
sans for small labels, and a kicker above every entry that names its kind.

### Rebuild the stylesheet

After you edit `src/style.css`, run:

```
pnpm --filter @geekity/cms build:theme
```

Tailwind scans only this theme's `layouts/` and `partials/`. A utility class in
a template here is compiled in, and Tailwind reads nothing outside the theme.
The templates use the semantic class names that these pages list. The styles
for those classes are in `src/style.css`, through `@apply`.

### A site theme does not need Tailwind

A site theme's own `static/style.css` replaces this one completely. Any CSS
that uses the class names in these pages works. The demo theme's stylesheet is
plain CSS. To change only the colours, override the `--color-*` custom
properties. See [Colours](page-shell.md#colours).

## Contents

- [The manifest](manifest.md). The `theme.json` that makes a folder a theme.
- [Overriding a template](overriding-a-template.md). Replace one template and keep the rest.
- [Adding to every page](adding-to-every-page.md). The head-end and body-end partials, analytics and scripts.
- [The page shell](page-shell.md). The base layout, entries, listings, the head, colours, code and video.
- [Mail templates](mail-templates.md). The messages the site sends, and how to override them.
- [The Markdown representation](markdown.md). The header and footer of every page's Markdown.
- [Template context](template-context.md). Every key a template is handed.
- [Bylines and author archives](bylines.md). Who an entry is by, and the author pages.
- [Navigation](navigation.md). Menu areas and how the theme prints them.
- [Feeds](feeds.md). The feed links a theme prints.
- [The conversation](conversation.md). Replies, likes and boosts under a post.
- [The comment form](comment-form.md). The form, its refusals, and a signed-in commenter.
- [The contact form](contact-form.md). The form on a page that asks for one.
- [Taxonomy macros](taxonomy-macros.md). The tag and category link macros.
- [Filters](filters.md). Every filter a template can use.
