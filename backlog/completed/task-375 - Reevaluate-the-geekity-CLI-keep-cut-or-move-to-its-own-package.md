---
id: TASK-375
title: 'Reevaluate the geekity CLI: keep, cut, or move to its own package'
status: Done
assignee: []
created_date: '2026-10-12 17:52'
updated_date: '2026-10-18 12:51'
labels: []
milestone: m-37
dependencies: []
priority: medium
type: spike
ordinal: 334800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sites mostly run in Docker, so using a geekity command on a live site means SSHing into the server and running it through docker compose exec, which is a pain. The CLI (packages/cms/src/cli.ts, about 1,400 lines, with commands such as init, serve, dev-mode, maintenance, sync, rebuild, resend, strip-metadata, user, plugin add/remove/upgrade and import) is also where the slowest tests are: the suites that spawn it are the top of the pnpm test timings (see TASK-374). This spike decides what to do with it. No decision has been made.

Options to weigh, per command:
- Keep in core: what the container itself needs to run (serve, the supervisor) and nothing else.
- Move to the admin UI or the HTTP/MCP surface (see milestone M27 MCP), so an operator never needs a shell.
- Move to a separate package, like WP-CLI, that a site adds if it wants it and that is tested on its own.
- Cut it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision record lists every current geekity command with who uses it (operator in Docker, local development, CI, the Docker image itself), how often, and the chosen fate: keep, move to the admin or HTTP/MCP surface, move to a separate CLI package, or cut
- [ ] #2 The record weighs the cost of each command in test time and code size against its use, with measured numbers
- [ ] #3 The record says what a separate CLI package would depend on (only the public API and @geekity/cms/plugin, or more) and how it would be released
- [ ] #4 Follow-up tasks are filed for the chosen changes; nothing is removed or moved in this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Discussion on 2026-10-12/13 widened this into decision-52 and milestone m-38 (M39 Foundational systems). Chosen fates so far: CLI commands all stay for now. Maintenance and dev mode get admin switches through the settings registry (TASK-383). Strip-metadata and resend get admin actions through the job queue (TASK-380). The plugin commands are already covered by Admin > Plugins.

2026-10-18: closed by the user's call to keep the CLI for now. Every command stays in core. The admin equivalents already chosen (maintenance and dev mode switches, strip-metadata and resend actions, Admin > Plugins) are built or tracked separately. The per-command decision record in AC #1 to #3 was not written, and no follow-up tasks are needed (AC #4). TASK-374 takes on the test-time cost that started this spike.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Decision: keep the geekity CLI in core for now, with no commands cut or moved to a separate package. The criteria asking for a measured per-command record were not met, by choice: the user decided without it. The test cost is handled by TASK-374.
<!-- SECTION:FINAL_SUMMARY:END -->
