---
id: decision-2
title: 'Runtime and framework: Node 22+, TypeScript, Hono'
date: '2026-09-02 13:21'
status: accepted
---
## Context

Fedify supports Node 22+, Deno, and Bun, with first-party adapters for Hono and Express. The existing Geekity site is an Eleventy 3 project on Node. The developer machine runs Node 24 and pnpm 10.

## Decision

- Runtime: Node 22 or newer, ESM, TypeScript compiled with `tsc` and run with `tsx` in development.
- Package manager: pnpm, with a workspace (see decision-6). `packageManager` is pinned in the root package.json so Corepack picks the same version everywhere.
- HTTP: Hono. It is Web-standard Request/Response, which is what Fedify's `@fedify/hono` middleware expects, and its router makes content negotiation straightforward.
- Database: SQLite through `better-sqlite3`, synchronous and simple for a single-process CMS.
- Markdown: `gray-matter` for front matter, `markdown-it` for rendering, the same libraries Eleventy uses.
- Watching: `chokidar`.
- Tests: `node:test` with `tsx`.

## Consequences

- Single process, single machine. Horizontal scaling is out of scope; the design allows swapping SQLite and the in-process queue later.
- `better-sqlite3` is a native module; site installs need prebuilt binaries for their platform. `node:sqlite` is a fallback if that becomes painful.
- Web-standard request handling means the same code could later run on Bun or Deno with little change.
