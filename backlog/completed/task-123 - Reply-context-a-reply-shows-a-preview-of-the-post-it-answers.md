---
id: TASK-123
title: 'Reply context: a reply shows a preview of the post it answers'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-23 19:10'
updated_date: '2026-09-23 19:36'
labels: []
milestone: m-17
dependencies:
  - TASK-121
references:
  - 'https://indieweb.org/reply-context'
  - 'https://indieweb.org/h-cite'
  - packages/cms/src/content/post-type.ts
  - packages/cms/src/webmention/service.ts
type: feature
ordinal: 147800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-121 gives a reply a bare "In reply to" link. IndieWeb reply context (an embedded `h-cite` of the target) lets a reader see what is being answered without leaving the page, and lets parsers read the target's name, author and text. The target is on another site, so the preview needs data fetched from it. That fetch must never happen during a page request, and where the fetched context lives has to respect decision-1 (the files are the source of truth, the database is an index).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The post page of a reply renders the target as an embedded `u-in-reply-to h-cite` that always carries the target URL, in both the default theme and the demo theme
- [x] #2 When the target page publishes an `h-entry`, the preview shows its name or a short text excerpt, its author name, and its published date where present; when it has no `h-entry`, the preview falls back to the page title and description metadata
- [x] #3 Serving a reply page never makes a network request: the context is fetched outside the request (for example when the post is saved or synced) and stored, and where it is stored is recorded in a decision consistent with decision-1
- [x] #4 An unreachable, slow, oversized or unparseable target degrades to a link-only preview and never blocks or fails saving the post
- [x] #5 The fetch accepts only http and https, has a timeout and a response size limit, and refuses hosts that resolve to loopback, private or link-local addresses, reusing the webmention sender's guard if one exists
- [x] #6 Changing `in-reply-to` to a different URL refreshes the context, and clearing it removes the preview
- [x] #7 Text taken from the target is escaped when rendered, so markup on the target cannot inject HTML into the page
- [x] #8 Tests cover an h-entry target, a metadata-only target, an unreachable target, a refused private address, and the escaping
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Shared guard: move isPrivateHost out of webmention/receive.ts into webmention/public-address.ts, classify literal IPs with node:net BlockList (loopback, private, link-local, CGNAT, unique-local, mapped IPv4), and add publicHost(hostname, lookup) that resolves the name and refuses when any address is not public. The receiver keeps its synchronous literal check through the same module.
2. Fetch and parse: webmention/reply-context.ts. fetchReplyContext(target, {lookup}) accepts only http/https, checks every redirect hop's host, times out, refuses a body over the byte limit, and returns a result union. readReplyContext(html, target) reads the first h-entry through microformats.citedEntry (name only when named per Post Type Discovery, text excerpt, author name/url, published) and falls back to <title>/og:title and meta description. mf2 implied names follow the spec (none when an item has p-/e- properties or nested microformats).
3. Storage (decision-19): content/_data/replyContexts.json, a map keyed by target URL, written atomically. Files stay the truth (decision-1/9), the database gains no column, Eleventy can read the same file.
4. Service: createReplyContextService listens to index changes. It fetches when a reply's target changed (non-scan) or has nothing stored (any origin, so a rebuilt index fetches nothing new), forgets a target no live document replies to, and catchUp() at serve start fetches every target the file lacks. Queued, never awaited by a save.
5. Rendering: renderer reads the stored context per render (no network). New partials/reply-context.njk draws u-in-reply-to h-cite with u-url always, p-name/p-content/p-author h-card/dt-published when known; default post.njk and demo post.njk include it. Autoescaped.
6. Config hostLookup injection; the test harness defaults to resolveNothing and the tests that boot a CMS directly inject it, so no test resolves a real name.
7. Tests first for each AC, then docs (doc-7 section, doc-2 note), then full verification and curl against a local server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Guard: src/webmention/public-address.ts replaces the receiver's string-only isPrivateHost (which also wrongly refused any host starting with fc/fd, e.g. fcbarcelona.com). It classifies literals with node:net BlockList (0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4, ::, ::1, fc00::/7, fe80::/10, ff00::/8, IPv4-mapped). publicHost() resolves the name through the injected HostLookup and refuses if any address is private. The webmention sender had no guard to reuse; the receiver now uses the shared isPrivateHost. Limitation: the address is checked before connecting, not pinned, so DNS rebinding is not stopped (noted in doc-7 and the module comment).

Fetch: src/webmention/reply-context.ts. http/https only, redirect: manual with every hop checked (max 5), one 10 s AbortSignal over the whole exchange, a page over 1 MB (content-length or streamed) is refused rather than truncated, non-HTML and pages with nothing to show fail soft. First h-entry via new microformats.citedEntry(): name only when named per discoverPostType, ~40-word excerpt, author name and http(s) url, published. No h-entry: <title>/og:title and meta description/og:description.

Storage: decision-19, content/_data/replyContexts.json keyed by target URL, atomic writes via updateFileAtomically. src/webmention/reply-contexts.ts service: handle(change) fetches when the target changed (non-scan) or is not stored, forgets a target no live post replies to; catchUp() at serve start; read() parses the file only when its bytes change. Renderer gets replyContext(target) and puts replyContext on the reply page context (published as a Date). Themes: new partials/reply-context.njk (u-in-reply-to h-cite, always u-url), included by the default post.njk and the demo post.njk. The listing partial keeps its bare u-in-reply-to link.

Tests and no network: new config hostLookup (default system resolver). The sandbox harness defaults to resolveNothing, and feeds.test.ts, send.test.ts and federation/article.test.ts inject it. Proved by running the whole suite with systemHostLookup instrumented to log and throw: 0 calls after the fix (9 before). Fetch is stubbed on globalThis as the webmention tests do.

Validation: pnpm build, pnpm test (2260 + 30 eleventy pass), pnpm typecheck, pnpm lint, pnpm format:check all exit 0. Mutation checks: disabling the host guard or the size cap fails 5 unit tests; printing the name with | safe fails the escaping test; a no-op catchUp fails its test. Live run on port 4123 (scratch content, webmentionsSend false): boot catch-up fetched https://indieweb.org/reply-context and the page drew the h-cite with its excerpt in the default and demo themes; a reply to http://127.0.0.1:3987/ logged 'not a public address' and drew link-only; editing in-reply-to on disk replaced the stored entry, clearing it emptied the file and removed the h-cite. Server stopped; port 3987 untouched.

Out of scope, not done: an Eleventy build does not yet map replyContexts[inReplyTo] onto the page (the data file is there for it); previews are never refreshed on a schedule.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A reply's page now cites the post it answers as an embedded u-in-reply-to h-cite that always carries the target URL, filled in with the target's name or excerpt, author and date when the target said so (h-entry first, title and description metadata otherwise). The context is fetched when a reply is saved or synced, or at serve start for targets not yet held, never during a request, and is kept in content/_data/replyContexts.json keyed by target (decision-19). The fetch is http(s)-only, 10 s, 1 MB, checks every redirect hop, and refuses hosts that are or resolve to private addresses through a shared guard the webmention receiver now uses too. Anything that fails leaves a link-only preview and never touches the save. Verified by src/webmention/reply-context.test.ts and src/web/reply-context.test.ts (h-entry, metadata-only, unreachable, slow, oversized, non-HTML, private literal and resolved, redirect to private, escaping, change and clear, non-blocking admin save, demo theme, no fetch or lookup while serving), the full build/test/typecheck/lint/format run, and a live server fetching indieweb.org.
<!-- SECTION:FINAL_SUMMARY:END -->
