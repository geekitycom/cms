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

| Field         | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`        | The name a person sees.                                                                                                                          |
| `kind`        | `site`. It is the only kind. The field exists so that a later version can add another kind without changing the format.                          |
| `description` | Optional.                                                                                                                                        |
| `colorScheme` | One of `normal`, `light`, `dark`, `light dark`, `dark light` or `only light`, preferred scheme first.                                            |
| `themeColor`  | The colour of the browser around the page, one per scheme, as a three- or six-digit hex colour with no alpha. Make it the page's own background. |

The directory name is the theme's id. A directory is not a theme if its
manifest is missing or unreadable, or if the manifest names a kind this CMS
does not have.

The head declares `colorScheme` and `themeColor` before the stylesheet loads
(see [The head](page-shell.md#the-head)). The CMS ignores a value outside the
allowed ones, and a value that a theme leaves out. Each ignored value falls
back to the default theme's value, the same way a missing template does.
