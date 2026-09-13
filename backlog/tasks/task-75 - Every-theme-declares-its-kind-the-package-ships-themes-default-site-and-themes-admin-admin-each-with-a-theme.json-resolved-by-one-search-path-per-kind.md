---
id: TASK-75
title: >-
  Themes have a manifest: themes/default carries a theme.json, a reader
  validates one, and one resolver builds the site search path
status: To Do
assignee: []
created_date: '2026-09-13 12:48'
updated_date: '2026-09-13 12:56'
labels:
  - web
milestone: m-13
dependencies: []
references:
  - packages/cms/src/web/templates.ts
  - packages/cms/src/web/assets.ts
  - packages/cms/src/mail/templates.ts
  - packages/cms/src/web/render.ts
  - packages/cms/src/admin/templates.ts
  - packages/cms/src/admin/assets.ts
  - >-
    backlog/decisions/decision-15 -
    Themes-are-named-and-site.json-chooses-one.md
type: task
ordinal: 100800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The package ships one unnamed theme at themes/default. Three places build the same two-element search path from PACKAGED_THEME_DIR (the template environment, the /theme/ asset finder and the mail environment) and a fourth probes it per render for the optional front-page and posts-page layouts. This task gives a theme a manifest and puts the resolution in one place, without changing what a site sees: themeDir still works exactly as before and no config or setting changes yet. themes/default gains a theme.json (name, kind, optional description); kind is site and is the only kind there is, kept in the file so a later kind can slot in without a format change. A manifest module reads and validates a theme directory and is what later tasks list and choose by. The admin tree at admin/ is untouched: it stays its own structure with its own loader and is not overridable, as decision-4 says. This is the internal half of decision-15; the config break and the setting come in the next task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 themes/default/theme.json exists with name, kind site and a description, and a manifest reader validates a theme directory: a missing or unparseable theme.json, or a kind other than site, is reported as not a theme with the reason
- [ ] #2 One resolver builds the site theme search path and is used by the template environment, the /theme/ asset finder, the mail environment and the front-page and posts-page probe; there is no other literal path to the packaged theme
- [ ] #3 The admin tree, its loader and its asset finder are unchanged and still outside the site theme search path; the existing admin asset tests pass untouched
- [ ] #4 themeDir, GEEKITY_THEME_DIR and the site theme/ override behave exactly as before; every existing theme override test passes unchanged
<!-- AC:END -->
