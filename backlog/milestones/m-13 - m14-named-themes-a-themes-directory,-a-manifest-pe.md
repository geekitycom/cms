---
id: m-13
title: "M14 Named themes: a themes directory, a manifest per theme, and a choice in the admin"
---

## Description

Today the package ships one unnamed theme at themes/default and a site may add one theme/ directory that overrides it file by file. That is fine for one site but not for a distribution: a site cannot carry more than one look and cannot switch between them. This milestone gives every theme a name and a manifest. The package's default theme gains a theme.json; a site has a themes/ directory with one folder per theme, each with the same manifest and only the files it overrides. site.json names the chosen theme; the packaged default is chosen unless the admin says otherwise, and only a chosen theme is put on the search path. An Appearance > Themes screen lists what is available and activates one. The admin keeps its own template tree and is not themed. themeDir and GEEKITY_THEME_DIR go away, so the milestone is feat(cms)!.
