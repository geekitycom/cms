---
id: TASK-423
title: 'A config file whose imports fail to resolve is an error, not an empty config'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-18 13:58'
updated_date: '2026-10-18 14:12'
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
- [x] #1 A config file that exists but imports a module that cannot be resolved makes loadConfig throw an error naming the config file and the module it could not find
- [x] #2 A directory with no config file still loads as an empty config, as before
- [x] #3 geekity commands that read the config report that error and exit non-zero instead of running on defaults
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. loadConfig picks the first config file that exists and returns {} only when none does.
2. Any failure importing that file propagates as 'Could not load <file>: <error>' with the original as cause.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced first: a geekity.config.mjs with port 4321 importing an unresolvable '@geekity/cms' loaded as {}. Fixed in config-loader.ts; isModuleNotFound is gone. Side effect: a config's own top-level error or syntax error now comes wrapped with the file name too. Tests in cli.test.ts: loadConfig rejects naming the file and the package; no config still gives {}; geekity settings list in such a site exits non-zero with both names on stderr. All three failed before the fix.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A config file that exists but cannot be imported, for example because a package it imports is not installed, now makes geekity fail with 'Could not load <file>: <reason>' instead of running on an empty config. A directory with no config file still loads as empty. Verified by three new tests that failed before the fix, and the full cms suite (6249 pass).
<!-- SECTION:FINAL_SUMMARY:END -->
