---
id: TASK-25
title: >-
  Public API and geekity CLI: createCms, defineConfig, serve, init, sync, user
  add
status: To Do
assignee: []
created_date: '2026-09-02 13:38'
labels:
  - infra
  - web
milestone: m-0
dependencies:
  - TASK-5
  - TASK-9
references:
  - backlog/docs/doc-1 - Architecture-Overview.md
type: feature
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Finalise the package surface described in doc-1 and decision-6. createCms(config) returns { app, serve, sync, close }; defineConfig gives typed config files; the geekity bin offers serve (boots from geekity.config.ts), init (copies packages/cms/templates/site into a new directory and writes package.json depending on the current published version), sync (one-shot index rebuild), and user add (create an admin without the setup screen). Hooks onDocumentChange and onPublish are exposed and documented. Write the package README as the site-author guide.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 geekity init my-site produces a directory that, after pnpm install and pnpm dev, serves a sample post at its permalink
- [ ] #2 A site with only server.ts, geekity.config.ts, and content/ runs without a theme directory
- [ ] #3 A site entry file can add its own Hono route alongside the CMS routes
- [ ] #4 geekity sync rebuilds the index and exits 0; geekity user add creates a user that can log in
- [ ] #5 Package README documents config options, CLI commands, theme overrides, hooks, and the upgrade command
- [ ] #6 Type declarations are published and a site written in TypeScript typechecks against them
<!-- AC:END -->
