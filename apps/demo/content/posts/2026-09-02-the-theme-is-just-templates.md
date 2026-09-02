---
title: The theme is just templates
date: '2026-09-02T10:05:00-05:00'
permalink: /2026/09/the-theme-is-just-templates/
tags:
  - web
  - theme
description: How a site overrides one layout and keeps the rest.
author: Andrew Shell
---

The default theme ships inside `@geekity/cms`. A site that wants a different
post layout writes one file:

```
theme/layouts/post.njk
```

That file wins. Every other template — the base layout, the archive, the tag
pages, the 404 — still comes from the package, and still gets updates when the
package does.

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

Assets resolve the same way. `theme/static/style.css` replaces the packaged
stylesheet at `/theme/style.css`, one file at a time.
