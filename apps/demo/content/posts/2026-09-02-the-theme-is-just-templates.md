---
title: The theme is just templates
date: '2026-09-02T15:05:00Z'
permalink: /2026/09/the-theme-is-just-templates/
tags:
  - web
  - theme
categories:
  - general
description: How a site overrides one layout and keeps the rest.
author: Andrew Shell
activitypub:
  published: '2026-09-02T15:05:00Z'
---

The default theme ships inside `@geekity/cms`. A site keeps its own themes in
`themes/`, one folder per theme, and wears the one it names in
`content/_data/site.json`. So a site that wants a different post layout writes
two files:

```
themes/demo/theme.json
themes/demo/layouts/post.njk
```

and sets `"theme": "demo"` — which is what pressing Activate on **Appearance >
Themes** in the admin writes. The manifest is what makes the folder a theme: a
`name` to show, a `kind` of `site`, and a line of `description` if it wants
one. The folder's own name is the id the setting holds.

That layout then wins. Every other template — the base layout, the archive, the
tag pages, the 404 — still comes from the package, and still gets updates when
the package does. A theme sitting in `themes/` that nothing names changes
nothing at all.

## The context

A layout receives what an Eleventy layout receives: `title`, `date`, `tags`,
`content`, `page.url`, and every front matter key the file carried. That is
deliberate, so a layout can move in either direction without a rewrite.

```njk
{% extends "layouts/base.njk" %}

{% block content %}
<h1>{{ title }}</h1>
<time datetime="{{ date | date("html") }}">{{ date | date }}</time>
{{ content | safe }}
{% endblock %}
```

Assets resolve the same way. `themes/demo/static/style.css` replaces the
packaged stylesheet at `/theme/style.css`, one file at a time.

The admin is not a theme. Its templates live in their own tree with their own
loader, off the search path entirely, so no theme can shadow the login form.
