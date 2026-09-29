---
id: TASK-179
title: Connect Claude Code to a real site and debug federation end to end
status: To Do
assignee: []
created_date: '2026-09-29 02:14'
labels:
  - mcp
  - federation
  - docs
milestone: m-26
dependencies:
  - TASK-174
  - TASK-175
  - TASK-176
  - TASK-177
  - TASK-178
priority: medium
type: chore
ordinal: 203800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The point of the milestone: the owner adds their blog to Claude Code and uses it. Deploy, connect Claude Code to shll.me, and use the tools on a real problem (for example, confirm the me.dm quote Create in the inbox, and investigate the 403 me.dm's Cloudflare returned during resend --all), then draft and publish a post. Write the README section on connecting Claude Code and other MCP clients.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Claude Code is connected to the deployed site by OAuth or a personal token, and the steps are in the README
- [ ] #2 A real federation question is answered from the tools alone, and the transcript summary is noted on the task
- [ ] #3 A post is drafted by the agent, reviewed, and published through the tools
- [ ] #4 Anything that was awkward becomes a follow-up task
<!-- AC:END -->
