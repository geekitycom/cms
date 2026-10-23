---
id: TASK-179
title: Connect Claude Code to a real site and debug federation end to end
status: To Do
assignee: []
created_date: '2026-09-29 02:14'
updated_date: '2026-10-23 16:56'
labels:
  - mcp
  - federation
  - docs
milestone: m-26
dependencies:
  - TASK-173
  - TASK-174
  - TASK-175
  - TASK-176
  - TASK-177
  - TASK-178
  - TASK-503
priority: medium
type: chore
ordinal: 203800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The point of the milestone: the owner adds their blog to Claude Code and uses it. Deploy, connect Claude Code to shll.me (the disposable test site; andrewshell.org is production), and use the tools on a real problem current at the time (for example a reply or quote that did not show, or an inbox that keeps failing), then draft and publish a post, and call the plugin-umami tool. Write the docs section on connecting Claude Code and other MCP clients.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Claude Code is connected to the deployed site by OAuth and by a personal token, and the steps are in docs/
- [ ] #2 A real federation question is answered from the tools alone, and the transcript summary is noted on the task
- [ ] #3 A post is drafted by the agent, reviewed, and published through the tools
- [ ] #4 The plugin-umami tool answers a stats question for a real post
- [ ] #5 Anything that was awkward becomes a follow-up task
<!-- AC:END -->
