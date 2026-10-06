---
id: TASK-285
title: >-
  @geekity/plugin-post-summary: editor actions that suggest a title and
  description
status: To Do
assignee: []
created_date: '2026-10-06 12:09'
updated_date: '2026-10-06 12:41'
labels:
  - plugins
  - llm
  - admin
milestone: m-30
dependencies:
  - TASK-284
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - packages/cms/admin/pages/documents/editor.njk
  - packages/cms/src/admin/preview.ts
  - packages/cms/src/admin/headers.ts
priority: medium
type: feature
ordinal: 241800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). Core gains editor actions: a plugin contributes a button beside an editor field (title, description, tags), a JSON endpoint under /admin/plugins/<name>/ behind the admin guard and CSRF, and a static script served from the plugin under the admin CSP (script-src self, connect-src self). First user: a new package, packages/plugin-post-summary (@geekity/plugin-post-summary), that requires llm. On a click it sends the draft title, body and kind to the server, which asks llm for a title and a description with a schema, and the editor shows the suggestions to accept or dismiss. Nothing is sent on save or publish. Each plugin package added here gets its release-please entry (include-component-in-tag true), its commitlint scope and CLAUDE.md scope row, CI lint, typecheck and tests, the shared bundle build, and a smoke test installing it against the packed @geekity/cms tarball.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An enabled plugin can add a button beside the title, description or tags field; a disabled plugin adds nothing and its endpoint answers 404
- [ ] #2 Plugin endpoints require a signed-in user and a valid CSRF token; plugin scripts load from the admin origin with no CSP change
- [ ] #3 Suggest title and Suggest description each show a suggestion the author accepts into the field or dismisses; accepting never saves the post
- [ ] #4 Untitled kinds (note, like, reply, photo) are not offered a title suggestion; the description suggestion respects the length the theme and feeds use
- [ ] #5 Every llm error is shown in plain words beside the button and the editor stays usable; with llm unconfigured the buttons explain how to configure it
- [ ] #6 The editor works unchanged with JavaScript off and with the plugin disabled
- [ ] #7 Verified in a real browser against a fake llm server: click, see the suggestion, accept it, save
- [ ] #8 The package has its release-please entry, commitlint scope, CLAUDE.md scope row, CI jobs, bundle build and packed-tarball smoke test
<!-- AC:END -->
