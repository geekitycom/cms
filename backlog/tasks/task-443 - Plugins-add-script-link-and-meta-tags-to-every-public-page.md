---
id: TASK-443
title: 'Plugins add script, link and meta tags to every public page'
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
labels:
  - plugins
  - themes
milestone: m-41
dependencies: []
references:
  - >-
    backlog/decisions/decision-59 -
    Plugins-add-tags-to-public-pages-and-widgets-to-the-dashboard-through-declarative-contributions-the-core-draws.md
  - packages/cms/src/plugin.ts
  - packages/cms/themes/default/layouts/base.njk
priority: medium
ordinal: 380800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision-59, a plugin can declare tags for the end of <head> or the end of <body> on public pages: a script with a src and attributes, a link, or a meta. This replaces the need for a site theme override (decision-37 hook partials) to add an analytics snippet. Tags are read when the page is drawn so they can follow the plugin settings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A plugin declares head-end and body-end tags in register, and an enabled plugin tags appear on every public page
- [ ] #2 Every attribute value is escaped, and a plugin cannot hand over raw HTML or an inline script
- [ ] #3 Plugin tags draw before the site own head-end and body-end partials, in enabled-plugin order, and the partials keep working
- [ ] #4 Tags are left out of the editor preview, and a disabled plugin adds none
- [ ] #5 A tag function can read the plugin settings and declare no tags while they are unset
- [ ] #6 HOST_API_VERSION goes up, plugins built against the previous version still load, and docs/plugins.md documents page tags with an example
<!-- AC:END -->
