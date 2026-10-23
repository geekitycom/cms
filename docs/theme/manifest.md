# The manifest

`theme.json` is what makes a directory a theme:

```json
{
  "name": "Default",
  "kind": "site",
  "description": "One line about the theme.",
  "colorScheme": "light dark",
  "themeColor": { "light": "#faf7f2", "dark": "#171412" },
  "schemes": [
    {
      "name": "paper",
      "label": "Paper",
      "themeColor": { "light": "#faf7f2", "dark": "#171412" }
    },
    {
      "name": "slate",
      "label": "Slate",
      "themeColor": { "light": "#f4f7fb", "dark": "#12161c" }
    }
  ]
}
```

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`        | The name a person sees.                                                                                                                          |
| `kind`        | `site`. It is the only kind. The field exists so that a later version can add another kind without changing the format.                          |
| `description` | Optional.                                                                                                                                        |
| `colorScheme` | One of `normal`, `light`, `dark`, `light dark`, `dark light` or `only light`, preferred scheme first.                                            |
| `themeColor`  | The colour of the browser around the page, one per scheme, as a three- or six-digit hex colour with no alpha. Make it the page's own background. |
| `schemes`     | Optional. The colour schemes the theme's stylesheet draws, default first. See [Colour schemes](#colour-schemes).                                 |

The directory name is the theme's id. A directory is not a theme if its
manifest is missing or unreadable, or if the manifest names a kind this CMS
does not have.

The head declares `colorScheme` and `themeColor` before the stylesheet loads
(see [The head](page-shell.md#the-head)). The CMS ignores a value outside the
allowed ones, and a value that a theme leaves out. Each ignored value falls
back to the default theme's value, the same way a missing template does.

## Colour schemes

`schemes` lists the colour schemes a site can choose between without writing a
theme. Each entry has these fields:

| Field        | Value                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `name`       | The value the page prints as `data-scheme` on `<html>`. Lower-case letters, digits and hyphens, starting with a letter. |
| `label`      | Optional. The name a person sees. Defaults to `name`.                                                                   |
| `themeColor` | Optional. The browser colour for this scheme, as `{ "light", "dark" }`. A value left out is the top-level one.          |

The first entry is the default. **Appearance > Look** lists the entries in this
order, by `label`. The CMS drops an entry that is not an object,
has no usable `name`, or repeats an earlier name. It keeps the rest.

The stylesheet must draw every scheme the manifest names. See
[Colours](page-shell.md#colours) for the selectors and the tokens.

A theme with no `schemes` loads as before. A site theme with no `schemes` that
ships no `static/style.css` of its own keeps the packaged stylesheet, so it
offers the packaged theme's schemes. A site theme with no `schemes` that ships
its own `static/style.css` offers none.

The packaged theme declares `paper`, `slate`, `forest`, `plum`, `ocean` and
`ink`. Paper is the default.
