# Adding to every page

To add analytics, a site verification tag or a chat widget to every page, you
do not need to copy a layout. `layouts/base.njk` includes two partials that the
default theme ships empty:

| Partial                 | Printed                                            |
| ----------------------- | -------------------------------------------------- |
| `partials/head-end.njk` | last in `<head>`, after the cards and the JSON-LD  |
| `partials/body-end.njk` | last in `<body>`, after the footer and the scripts |

A site theme can hold one of these partials and only its `theme.json`. The
partial's markup then goes on every public HTML page: posts, pages, listings,
search, the front page, and the 404, 410, 500 and 503 pages. Every other
template still comes from the default theme, so the site still gets updates to
them. Keep the two partial names as they are. The includes are outside every
block, so a layout that overrides `head` or `scripts` without `super()` still
prints them.

Only the HTML page prints the partials. These do not:

- the Markdown, plain text and JSON representations of a page
- the feeds
- `llms.txt`
- mail
- the admin

The editor's preview renders the post or page layout in the admin. Its context
has `editorPreview: true`, and `layouts/base.njk` leaves both partials out. If
your theme replaces `layouts/base.njk` and includes the partials itself, test
the same key.

A plugin can also add a `script`, `link` or `meta` tag to every page with
`host.pageTags`. The default theme draws plugin tags just before each partial,
as `{{ pluginTags.headEnd }}` and `{{ pluginTags.bodyEnd }}`, inside the same
`editorPreview` test. A theme that replaces `layouts/base.njk` prints both
itself. [Plugins](../plugins.md) describes page tags.

### Example: Umami and Google Analytics 4

For Umami alone, the [`@geekity/plugin-umami`](../../packages/plugin-umami/README.md)
plugin draws the tracker from its settings, with no theme. When a site moves
to the plugin, delete the Umami `<script>` from its partial, or each visit is
counted twice.

This theme is in `themes/analytics/`:

```
themes/analytics/
  theme.json
  partials/head-end.njk
```

```json
{ "name": "Analytics", "kind": "site" }
```

```njk
{% if not devMode and not signedIn %}
<script defer src="https://cloud.umami.is/script.js" data-website-id="your-website-id"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
{% endif %}
```

The `if` keeps two kinds of visit out of the counts:

- `devMode` is true while the site is in dev mode. A site built or migrated in
  dev mode keeps its production identity. Dev mode cannot block a pageview,
  because the visitor's browser sends it, not the server.
- `signedIn` is true when the visitor is signed in to the admin. An author who
  reads their own site is not counted.

[Template context](template-context.md) describes both keys.

To use the theme, click Activate on **Appearance > Themes**, or set
`"theme": "analytics"` in `content/_data/site.json`. If the site already uses
a theme of its own, put the partial in that theme instead.

The partial is a template, rendered with the page's context. It can read a
value from `site.json`, as in `data-website-id="{{ site.umamiId }}"`.

### In Docker

The image reads themes from `/site/themes`. Mount the site's `themes/`
directory there, read-only. The commented line in `deploy/compose.yaml` does
this:

```yaml
volumes:
  - ./themes:/site/themes:ro
```

You do not need a custom image. A change to the partial shows on the next
request.

### Under a Content-Security-Policy

The default headers set only `frame-ancestors`. They do not restrict what a
page loads, and the inline gtag configuration runs unchanged. If you set your
own policy with `securityHeaders`, allow what the snippets load and where they
send data:

| Directive     | Umami                      | Google Analytics 4                                                                             |
| ------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `script-src`  | `https://cloud.umami.is`   | `https://*.googletagmanager.com`, and the inline configuration (see below)                     |
| `connect-src` | `https://gateway.umami.is` | `https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com` |
| `img-src`     | none                       | `https://*.google-analytics.com https://*.googletagmanager.com`                                |

The inline `<script>` that configures gtag needs one of these:

- Move it to a file in the theme, `themes/analytics/static/gtag.js`, and load
  it with `<script src="{{ "gtag.js" | asset }}"></script>`. The site then
  serves it, and `script-src 'self'` covers it.
- Allow its hash, `'sha256-…'`, in `script-src`. The hash covers every byte
  between the tags. It changes when the measurement ID or the whitespace
  changes.
- Allow `'unsafe-inline'` in `script-src`. This also allows any injected
  inline script, so prefer one of the other two.
