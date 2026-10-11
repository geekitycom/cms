# The manifest

`theme.json` is what makes a directory a theme:

```json
{
  "name": "Default",
  "kind": "site",
  "description": "One line about the theme.",
  "colorScheme": "light dark",
  "themeColor": { "light": "#faf7f2", "dark": "#171412" }
}
```

`name` is what a person sees, `kind` is `site` — the only kind there is, and
the field exists so another can be added later without the format changing —
and `description` is optional. The directory name is the theme's id. A
directory without a readable manifest, or one naming a kind this CMS does not
have, is not a theme.

`colorScheme` and `themeColor` are the colours the head declares before the
stylesheet loads (see [The head](page-shell.md#the-head)). `colorScheme` is one of `normal`,
`light`, `dark`, `light dark`, `dark light` or `only light`, preferred scheme
first. `themeColor` is the colour of the browser around the page, one per
scheme, as a three- or six-digit hex colour with no alpha. Make it the page's
own background. A value outside those is ignored, and so is one a theme leaves
out: each falls back to this theme's, just as a template does.
