---
id: TASK-179
title: Connect Claude Code to a real site and debug federation end to end
status: In Progress
assignee:
  - '@claude'
created_date: 2026-09-29 02:14
updated_date: '2026-10-28T12:35:00Z'
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
- [x] #2 A real federation question is answered from the tools alone, and the transcript summary is noted on the task
- [x] #3 A post is drafted by the agent, reviewed, and published through the tools
- [x] #4 The plugin-umami tool answers a stats question for a real post
- [x] #5 Anything that was awkward becomes a follow-up task
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Consolidate docs/mcp.md: one Connect section covering Claude Code by OAuth (claude mcp add, /mcp or claude mcp login), by a personal token (Users > Connected apps, Works with MCP, --header), checking the connection (claude mcp list, whoami), and other MCP clients (URL, transport, JSON config, OAuth discovery or a bearer header).
2. Add two walkthroughs with the real tool names: debugging federation (federation_status, post_federation, inbox_search, refresh_actor, retry_deliveries, post_federation) and authoring (upload_media, create_draft, get_post_source, update_post, publish_post), plus the plugin-umami post_stats call.
3. Check every command, scope and tool name against the code (CORE_TOOLS, MCP_SCOPES, the connected-apps form, plugin-umami input schema).
4. Prove the documented Claude Code steps against a local geekity serve with a throwaway CLAUDE_CONFIG_DIR: OAuth via claude mcp login --no-browser and a personal token via --header, claude mcp list shows Connected.
5. Leave AC#1-#5 unchecked: they need the branch deployed to shll.me. Record what remains in the notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-25, docs half of AC#1 and a local rehearsal. Nothing here ran against shll.me, so no criterion is checked.

Docs (docs/mcp.md): Connect a client now has Connect Claude Code by signing in (claude mcp add --transport http, then /mcp or claude mcp login --no-browser, untick scopes, Approve), Connect Claude Code with a token you create (Users > Connected apps, Works with MCP, --header 'Authorization: Bearer <token>'), Check the connection (claude mcp list, whoami), and Other MCP clients (URL, Streamable HTTP, OAuth with a client metadata document and S256 or a bearer header, the .mcp.json shape, no DCR, no stdio). New sections Debug federation from an agent (federation_status, post_federation, inbox_search, remote_lookup, refresh_actor, retry_deliveries, post_federation) and Write and publish a post from an agent (upload_media, create_draft, get_post_source, update_post, publish_post, then geekity_plugin_umami__post_stats). Tool names and arguments checked against CORE_TOOLS in src/mcp/endpoint.ts, each tool's inputSchema, MCP_SCOPES, the connected-apps form and the plugin-umami README.

Local rehearsal, not the deployed site: geekity init in a scratch dir, geekity user add, geekity serve on :4817 in dev mode, Claude Code 2.1.310 with a throwaway CLAUDE_CONFIG_DIR.
- OAuth: claude mcp add, then claude mcp list said Needs authentication. claude mcp login --no-browser driven by expect printed the authorize URL (CIMD client_id https://claude.ai/oauth/claude-code-client-metadata, S256, resource http://localhost:4817/_geekity/mcp, all seven scopes). The consent screen showed Claude Code with seven boxes. Approved with publish and repair unticked, pasted the callback URL back, got Authenticated, and claude mcp list said Connected.
- Personal token: created on /admin/users/apps with Works with MCP, scopes profile and inspect, badge For MCP. claude mcp add --header 'Authorization: Bearer ...' and claude mcp add-json with the documented JSON shape both listed Connected. whoami over curl named the token and its two scopes. create_draft with that token got the -32001 error naming the create scope.
- Walkthrough calls, over curl with a full-scope token: create_draft, get_post_source, update_post with the hash, upload_media of a PNG, publish_post, federation_status, post_federation, inbox_search, retry_deliveries and refresh_actor all answered as documented. No federation traffic: dev mode, no followers.
- Not rehearsed: a tool call from inside a Claude Code model session (the throwaway config is not logged in to a model), and geekity_plugin_umami__post_stats (needs the plugin and an Umami server).

What remains, all on shll.me after the branch is deployed (deploys need the owner):
1. AC#1: connect Claude Code to https://shll.me/_geekity/mcp by OAuth and by a personal token, following docs/mcp.md, and correct the docs if a step differs.
2. AC#2: answer a real federation question with the tools alone and note the transcript summary here.
3. AC#3: have the agent draft a post, review it, and publish it through the tools.
4. AC#4: call geekity_plugin_umami__post_stats for a real post.
5. AC#5: file a follow-up task for anything awkward.

2026-10-28, live run on shll.me through the claude.ai connector (OAuth via stateless dynamic client registration, TASK-520). whoami: user a, client Claude, all seven scopes. claude mcp list in Claude Code shows claude.ai Shll.me Connected at https://shll.me/_geekity/mcp.

AC#2, the federation question: does @andrewshell@me.dm, the only follower, get shll.me's posts, and why does hello-world show a failed Update? Tools only: federation_status (14 days) listed one failure, an Update of hello-world to https://me.dm/inbox on 2026-09-29, 403 with a Cloudflare 'Attention Required' page; queue empty, no retrying. followers: one follower, me.dm, shared inbox https://me.dm/inbox. post_federation hello-world filtered to that inbox: four Updates, one failed (the 403) and three still queued (2026-09-20, 10-08, 10-09). remote_lookup @andrewshell@me.dm, signed as a: WebFinger 200 and actor 200 through Cloudflare, so the block was transient and me.dm accepts signed requests from shll.me now. inbox_search by that actor: Follow, Likes, an Announce, QuoteRequests and Deletes arriving through 2026-10-03, so traffic flows both ways. Answer: the follower is reachable; the 403 was a one-off Cloudflare challenge; the three queued rows predate TASK-516 and will never settle (filed TASK-521). The new post below delivered its Create to me.dm as sent within a second, which confirms current deliveries settle.

AC#3: create_draft written-over-mcp (name, content, categories geekity and mcp, mp-slug); get_post_source read it back as a draft; on review the endpoint path and tool names were made code with update_post using the hash; publish_post published it at https://shll.me/2026/10/written-over-mcp/; post_federation showed the Create sent to https://me.dm/inbox.

AC#5: filed TASK-521 (pre-settlement queued delivery rows read as waiting forever) and TASK-522 (HTML error pages stored whole in delivery errors).

Still open:
- AC#1, the personal-token half and the claude mcp add OAuth path against shll.me: the token needs the owner on /admin/users/apps (no CLI creates one), and claude mcp login needs the owner's browser consent. Steps are in docs/mcp.md.
- AC#4: shll.me has no geekity_plugin_umami__post_stats tool: plugin-umami is not installed there (plugins: post-summary, tag-suggest, wordpress, llm). It needs plugin-umami installed and pointed at an Umami site on shll.me, or the check run against andrewshell.org.

2026-10-28, AC#4: plugin-umami is now on shll.me and the claude.ai Shll.me connector lists geekity_plugin_umami__post_stats. Called it for the post published in AC#3, path /2026/10/written-over-mcp/, days 7: answered 2026-10-22 to 2026-10-28 with the title 'Written and published over MCP', 0 views, 0 visitors, 0 visits, the previous span 0, no referrers. A 30-day call for / also answered all zeros. The zeros are real data, not a wiring fault: the client throws unauthorized on a 401/403 and not-found when the account cannot see the website ID, and neither happened. The published page carries the Umami Cloud tracker (cloud.umami.is/script.js, data-website-id 8257032a-..., data-domains shll.me, data-do-not-track true), so visits from now on will be counted. Only AC#1 remains open.
<!-- SECTION:NOTES:END -->
