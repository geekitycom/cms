---
id: TASK-1
title: 'Scaffold pnpm workspace: packages/cms and apps/demo'
status: To Do
assignee: []
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 13:38'
labels:
  - infra
milestone: m-0
dependencies: []
references:
  - >-
    backlog/decisions/decision-6 -
    Ship-the-CMS-as-an-npm-package-in-a-pnpm-workspace-sites-are-separate-repos.md
type: chore
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the pnpm workspace that every other task builds on. See doc-1 (Architecture Overview) and decisions 2, 6.

Root: pnpm-workspace.yaml, pinned packageManager, tsconfig.base.json, root scripts that fan out (dev, build, lint, typecheck, test). packages/cms: package.json with name @geekity/cms, exports map, bin geekity, files whitelist, tsc build to dist/, a createCms(config) that returns a Hono app answering GET /, and a first node:test test. apps/demo: private package depending on @geekity/cms via workspace:*, a geekity.config.ts and server.ts that boot the CMS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm install at the root installs both workspace packages and links apps/demo to packages/cms
- [ ] #2 pnpm --filter demo dev starts the demo site and GET / answers 200
- [ ] #3 pnpm build compiles packages/cms to dist/ with type declarations, and pnpm pack produces a tarball containing only dist, themes, templates, README, and LICENSE
- [ ] #4 pnpm test runs at least one passing node:test test in packages/cms through tsx
- [ ] #5 Config (port, content dir, data dir, base URL) comes from geekity.config.ts with environment variable overrides and documented defaults
- [ ] #6 README documents the workspace layout and the dev, build, test, and start commands
<!-- AC:END -->
