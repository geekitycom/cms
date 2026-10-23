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
  ],
  "fonts": {
    "heading": { "label": "Headings", "fallback": "Georgia, serif" },
    "body": { "label": "Body text", "fallback": "Georgia, serif" }
  }
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
| `fonts`       | Optional. The font roles the theme's stylesheet reads, by role. See [Font roles](#font-roles).                                                   |

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

## Font roles

`fonts` names the places a site can set a font without writing a theme
(decision-61). It is an object keyed by role. Each value has these fields:

| Field      | Value                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`    | Optional. The name a person sees. Defaults to the role.                                                                                       |
| `fallback` | The `font-family` list the role uses when the site sets no font, such as `'Iowan Old Style', Georgia, serif`. Each family is plain or quoted. |

The role is lower-case letters, digits and hyphens, starting with a letter.
The stylesheet reads each role from the custom property `--font-<role>`. A
page that sets a font for a role sets that property to the family followed by
the fallback, for example `--font-heading: "Fraunces", Georgia, serif`.

The CMS drops a role whose name is not usable, that has no `fallback`, or whose
fallback holds anything other than family names separated by commas: no `;`,
braces, angle brackets or backslashes, and no quote left open. It keeps the
rest, in the order the manifest lists them.

The stylesheet must give `--font-<role>` its fallback on `:root` and read
every role it declares. See [Fonts](page-shell.md#fonts).

A theme with no `fonts` loads as before. Font roles follow the same rule as
schemes: a site theme with no `fonts` that ships no `static/style.css` of its
own offers the packaged theme's roles, and one that ships its own stylesheet
offers none.

The packaged theme declares `heading` (Headings) and `body` (Body text). Both
fall back to the serif stack
`'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif`.
