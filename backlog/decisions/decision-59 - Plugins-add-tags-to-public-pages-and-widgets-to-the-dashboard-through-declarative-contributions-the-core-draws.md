---
id: decision-59
title: >-
  Plugins add tags to public pages and widgets to the dashboard through
  declarative contributions the core draws
date: '2026-10-20 21:09'
status: accepted
---
## Context

A plugin has no way to put anything on a public page or on the admin dashboard. Sites add an analytics snippet through the decision-37 hook partials (`partials/head-end.njk` and `partials/body-end.njk`), which needs a site theme and, on Docker, a themes volume. The dashboard is a fixed template in `admin/pages/dashboard/home.njk`. Plugin screens are already declarative (`paragraph` and `table` blocks): a plugin hands the core data and the core writes the markup. An Umami plugin needs both: the tracker tag on every page, and stats on the dashboard.

## Decision

**Page tags.** A plugin declares tags for the end of `<head>` or the end of `<body>` on public pages: a `script` with a `src` and attributes, a `link`, or a `meta`. It does not hand over raw HTML or an inline script. The core escapes every attribute and draws plugin tags before the site's own hook partial, in enabled-plugin order. The tags are left out of the editor preview, as the partials are. A tag can depend on the plugin's settings, so it is read when the page is drawn, and a plugin with unset settings declares none.

**Dashboard widgets.** A plugin declares widgets. A widget has an id, a title, a width (`full` or `half`), a refresh interval, and a `load()` that returns declarative blocks: stats (a value with an optional change from the previous period), a time series (one or more named series over days), a ranked list (label, value, optional link), a calendar of counts per day, a table, or a paragraph. The core draws charts as server-rendered SVG with DaisyUI colour tokens, with a text or table equivalent for screen readers. The admin ships no chart library and no client chart code.

The core's own dashboard cards go through the same widget path, so the API is exercised by the core before plugins depend on it. The stat tiles stay at the top. Core widgets come first, then plugin widgets in enabled-plugin order. There is no per-user reordering yet.

`load()` runs in parallel with the other widgets under a time limit. The core keeps the last good result in memory for the widget's refresh interval. When a load fails or runs out of time, the card shows the last good result marked as stale, or says the stats are unavailable, and the rest of the dashboard draws as normal. The failure is logged.

## Consequences

- `HOST_API_VERSION` goes up, and plugins built against the old host keep working.
- A site can still use the hook partials. Moving an analytics snippet into a plugin is optional.
- Raw HTML and inline scripts stay out of plugin reach, so a plugin cannot inject arbitrary markup into public pages or the admin.
- Charts that need history the store does not keep, such as follower count over time, need the core to record it first.
- A slow external API makes its own card stale or unavailable. It does not slow down the dashboard or break it.
