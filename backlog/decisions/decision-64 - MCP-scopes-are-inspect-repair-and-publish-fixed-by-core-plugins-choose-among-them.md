---
id: decision-64
title: >-
  MCP scopes are inspect, repair and publish, fixed by core; plugins choose
  among them
date: '2026-10-25T14:02:00Z'
status: accepted
---
## Context

TASK-172 adds an MCP endpoint at `/_geekity/mcp`. Its tools go beyond Micropub: later tasks read operator data that holds other people's information (the inbox, deliveries, followers, webmentions), repair federation (resend a post, retry deliveries, refresh a remote actor), and publish. Micropub's scopes (`create`, `update`, `delete`, `media`) and the profile scopes (`profile`, `email`) do not cover reading or repairing, and an agent that reads untrusted pages can be steered by prompt injection, so making a post public needs its own scope. Plugins will add MCP tools too (TASK-503), and every tool needs exactly one scope the endpoint can check before it runs.

## Decision

**Three scopes join the list in `src/indieauth/request.ts`:**

- `inspect`: read the site's operator records: inbox activities, outbound deliveries and their errors, followers, relays, quote approvals, webmentions and the jobs queue. Read-only tools, a remote lookup included, need it.
- `repair`: act on federation: resend a post, retry failed deliveries, refresh a remote actor. Each runs through the queues.
- `publish`: make a draft public, or change a post that is already public, which federates an Update and sends webmentions. Creating and editing drafts stays with `create`, `update` and `media`.

**The MCP endpoint offers `profile`, `create`, `update`, `media`, `publish`, `inspect` and `repair`** (`MCP_SCOPES`). Its protected resource metadata lists them, so an MCP client asks for all of them and the person unticks on the consent screen what they do not want; each scope is its own checkbox. The site's own resource, for Micropub and its media endpoint, keeps `profile`, `email`, `create`, `update`, `delete` and `media` (`SITE_SCOPES`). The authorization server metadata lists every scope.

**Every tool declares exactly one scope from `MCP_SCOPES`, and the tool registry checks it before the tool runs.** A tool cannot skip the check, and a call without the scope is answered 403 with an `insufficient_scope` challenge naming the scopes the token holds plus the missing one, as the MCP authorization spec (2025-11-25) asks, with a JSON-RPC error naming the missing scope in the body. `whoami` needs `profile`.

**Core fixes the scope list. A plugin's tool picks one of the core scopes and cannot declare its own.** The consent screen and the connected apps screen then always show the same readable list, labelled by core, and a person approving a client knows what each box means whichever plugins are installed. A plugin that declares a scope outside the list fails at boot (TASK-503).

## Consequences

- Adding a scope is a core change with its own label, never a plugin's.
- A plugin's read-only tool over operator data, such as site analytics, uses `inspect`.
- A token created by hand on the connected apps screen is still bound to the site and offered only `SITE_SCOPES` until TASK-173 adds the choice of resource.
- A Micropub client asking for `inspect` is shown the box and may be granted it, but its token is bound to the site, where nothing reads that scope.
