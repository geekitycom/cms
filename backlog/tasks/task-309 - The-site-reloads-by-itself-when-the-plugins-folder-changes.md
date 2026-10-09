---
id: TASK-309
title: The site reloads by itself when the plugins folder changes
status: To Do
assignee: []
created_date: '2026-10-09 14:12'
labels: []
dependencies: []
references:
  - packages/cms/src/supervisor/primary.ts
  - packages/cms/src/plugins/folder.ts
  - packages/cms/src/plugins/manage.ts
  - packages/cms/src/cli.ts
priority: medium
type: feature
ordinal: 269800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today a change to the plugins folder, from Admin > Plugins, `geekity plugin add|upgrade|remove` or a hand copy, needs a press of Reload on the Plugins screen. On 2026-10-09 Andrew asked for the site to pick up changes by itself: the supervisor watches the folder and reloads once it has been stable for about 5 seconds, and the admin and CLI, which know when they are done, trigger the reload at once. File-change events are unreliable on Docker bind mounts, so the watch compares the folder fingerprint (the one the Reload card already uses) on a short interval.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Under `geekity serve`, when the plugins folder fingerprint changes and then stays the same for 5 seconds, the supervisor reloads the site the same way the Reload button does (new worker, old one drains, no refused request); a folder that keeps changing (a slow hand copy) reloads only once it settles
- [ ] #2 Add, Update, Update all and Remove on Admin > Plugins reload as soon as the change is made, without waiting for the debounce, and the screen shows the outcome after the reload
- [ ] #3 `geekity plugin add`, `upgrade` and `remove` ask the running supervisor to reload as soon as they finish a change, and say so; when no supervised server can be reached they say the site will pick the change up within a few seconds, or to press Reload
- [ ] #4 A reload that fails (the new worker does not start) leaves the old worker serving, is shown on the Plugins screen with the reason as today, and is not retried in a loop: the watch waits for the folder to change again
- [ ] #5 The watch can be turned off with an environment variable (name it and document it), leaving the explicit triggers and the Reload button; the interval and the 5 second settle time are constants with tests driving them through the injected clock the supervisor already uses
- [ ] #6 Tests cover the debounce (a change mid-settle restarts the wait), an explicit trigger skipping it, a failed reload not looping, and the off switch; a real geekity serve run shows a hand-copied plugin loading by itself; the README and doc-1 describe it
<!-- AC:END -->
