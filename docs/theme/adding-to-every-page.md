# Adding to every page

Analytics, a site verification tag or a chat widget goes on every page, and
none of them needs a layout copied. `layouts/base.njk` includes two partials
that this theme ships empty:

| Partial                 | Printed                                            |
| ----------------------- | -------------------------------------------------- |
| `partials/head-end.njk` | last in `<head>`, after the cards and the JSON-LD  |
| `partials/body-end.njk` | last in `<body>`, after the footer and the scripts |

A site theme that holds one of them, and nothing else but its `theme.json`,
adds that markup to every public HTML page: posts, pages, listings, search, the
front page, and the 404, 410, 500 and 503 pages. Every other template still
comes from the default theme, so the site keeps receiving updates to them, and
the two partial names stay as they are. The includes sit outside every block,
so a layout that overrides `head` or `scripts` without `super()` keeps them.

They are part of the HTML page and nothing else. The Markdown, plain text and
JSON representations of a page, the feeds, `llms.txt`, mail and the admin do
not print them. The editor's preview renders the post or page layout in the
admin, so the context there carries `editorPreview: true` and `layouts/base.njk`
leaves both partials out. A theme that replaces `layouts/base.njk` and includes
them itself should test the same key.

Umami and Google Analytics 4, in `themes/analytics/`:

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

The `if` keeps two kinds of visit out of the counts. `devMode` is true while
the site is in dev mode. A site built or migrated in dev mode keeps its
production identity, and dev mode cannot hold a pageview, because the reader's
browser sends it, not the site. `signedIn` is true when the reader is signed in
to the admin, so an author who reads their own site is not counted. Both keys
are described in [Template context](template-context.md).

Then wear the theme, either with Activate on **Appearance > Themes** or with
`"theme": "analytics"` in `content/_data/site.json`. A site that already wears
a theme of its own puts the partial in that theme instead.

The partial is a template, rendered with the page's context, so it can read a
value out of `site.json`, as in `data-website-id="{{ site.umamiId }}"`.

**In Docker.** The image reads themes from `/site/themes`. Mount the site's
`themes/` directory there, read-only, which is the commented line in
`deploy/compose.yaml`:

```yaml
volumes:
  - ./themes:/site/themes:ro
```

No custom image is needed. A change to the partial shows on the next request.

**Under a Content-Security-Policy.** The default headers set only
`frame-ancestors`, so they restrict nothing a page loads, and the inline gtag
configuration runs as it is. A site that sets a policy of its own with
`securityHeaders` must allow what the snippets load and where they send data:

| Directive     | Umami                      | Google Analytics 4                                                                             |
| ------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `script-src`  | `https://cloud.umami.is`   | `https://*.googletagmanager.com`, and the inline configuration (see below)                     |
| `connect-src` | `https://gateway.umami.is` | `https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com` |
| `img-src`     | none                       | `https://*.google-analytics.com https://*.googletagmanager.com`                                |

The inline `<script>` that configures gtag needs one of these:

- Move it to a file in the theme, `themes/analytics/static/gtag.js`, and load
  it with `<script src="{{ "gtag.js" | asset }}"></script>`. It is then served
  from the site, and `script-src 'self'` covers it.
- Allow its hash, `'sha256-…'`, in `script-src`. The hash covers every byte
  between the tags, so it changes when the measurement ID or the whitespace
  changes.
- Allow `'unsafe-inline'` in `script-src`. This also allows any injected
  inline script, so prefer one of the other two.
