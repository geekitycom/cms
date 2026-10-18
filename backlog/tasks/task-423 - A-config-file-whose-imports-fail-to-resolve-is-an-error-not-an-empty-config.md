---
id: TASK-423
title: 'A config file whose imports fail to resolve is an error, not an empty config'
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-18 13:58'
labels:
  - config
  - cli
milestone: m-37
dependencies: []
references:
  - packages/cms/src/config-loader.ts
priority: high
type: bug
ordinal: 360800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
loadConfig (packages/cms/src/config-loader.ts) treats any ERR_MODULE_NOT_FOUND whose message contains the config file's path as 'there is no config file here' and returns {}. Node's error for a package the config imports, such as "Cannot find package '@geekity/cms' imported from /site/geekity.config.mjs", also contains that path. So a geekity.config.* that imports a package the site cannot resolve loads as an empty config, every value in it is dropped, and nothing says so. Reproduced on 2026-10-18: a geekity.config.mjs holding defineConfig({ port: 4321 }) and importing '@geekity/cms' in a directory with no node_modules loads as {}. isModuleNotFound must tell the config file itself being absent apart from a module the config imports.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A config file that exists but imports a module that cannot be resolved makes loadConfig throw an error naming the config file and the module it could not find
- [ ] #2 A directory with no config file still loads as an empty config, as before
- [ ] #3 geekity commands that read the config report that error and exit non-zero instead of running on defaults
<!-- AC:END -->
