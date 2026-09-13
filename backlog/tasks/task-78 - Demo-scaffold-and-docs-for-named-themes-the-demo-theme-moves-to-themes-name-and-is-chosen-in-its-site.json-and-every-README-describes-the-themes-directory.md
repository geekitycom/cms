---
id: TASK-78
title: >-
  Demo, scaffold and docs for named themes: the demo theme moves to
  themes/<name>/ and is chosen in its site.json, and every README describes the
  themes directory
status: To Do
assignee: []
created_date: '2026-09-13 12:49'
updated_date: '2026-09-13 12:56'
labels:
  - infra
  - docs
milestone: m-13
dependencies:
  - TASK-77
references:
  - apps/demo/theme/layouts/post.njk
  - apps/demo/test/site.test.ts
  - packages/cms/README.md
  - README.md
  - packages/cms/themes/default/README.md
  - packages/cms/templates/site/geekity.config.ts
  - >-
    backlog/decisions/decision-15 -
    Themes-are-named-and-site.json-chooses-one.md
type: chore
ordinal: 103800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With named themes in place (TASK-76, TASK-77), make the demo and the documentation match. The demo theme at apps/demo/theme/ (a post layout with a byline and reading time, and a stylesheet) moves to apps/demo/themes/<name>/ with a theme.json, its geekity.config.ts names themesDir, and its content/_data/site.json chooses that theme, so the demo proves the choice rather than the default; the demo site test asserts the override is visible when chosen and that the packaged default comes back when the setting is cleared. The init scaffold writes no themes directory, as it wrote no theme/, but its config and README say where one goes. The root README, the package README and themes/default/README.md describe the themes directory, the manifest, the setting, the Appearance screen and the search order, say that the admin is not themed, and stop describing theme/ and themeDir; the package README carries a short migration note for a site with a theme/ directory. decision-4 is annotated: its single theme/ directory is superseded by decision-15, its non-overridable admin stands. The pack-install smoke still boots a scratch site and gets 200s.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 apps/demo/themes/<name>/theme.json, layouts/post.njk and static/style.css exist, apps/demo/theme/ is gone, the demo config names themesDir and the demo site.json chooses the theme
- [ ] #2 apps/demo/test/site.test.ts proves the chosen theme renders the byline, reading time and demo stylesheet and that the packaged default serves when the setting is absent
- [ ] #3 The root README, the package README and themes/default/README.md describe themes/, theme.json, the theme setting, the Appearance screen and the search order, say the admin is not themed, and no longer present theme/ or themeDir as current behaviour; the package README carries a migration note
- [ ] #4 The init template config names themesDir and geekity init still produces a site the pack-install smoke boots with 200s
- [ ] #5 decision-4 carries a note that decision-15 supersedes its single theme/ directory and that its non-overridable admin still stands
<!-- AC:END -->
