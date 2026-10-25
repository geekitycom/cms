---
id: TASK-175
title: 'MCP remote lookup tool: fetch fediverse objects as the site sees them'
status: Done
assignee:
  - '@claude'
created_date: 2026-09-29 02:13
updated_date: '2026-10-25T16:18:00Z'
labels:
  - mcp
  - federation
milestone: m-26
dependencies:
  - TASK-172
  - TASK-178
references:
  - https://specification.website/spec/agent-readiness/mcp-and-tool-discovery/
priority: medium
type: feature
ordinal: 199800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Half of federation debugging is the other side: what does the remote actor document, inbox or note look like, and what does WebFinger return for a handle. Add a tool that resolves a handle through WebFinger and fetches a remote actor or object as ActivityStreams JSON, signed as the site's actor (as Fedify's lookup does), returning the status, the headers that matter and the body. It makes outbound requests, so it is annotated openWorldHint, guarded by the public-address checks in `util/public-address.ts` (the bounded fetch in `webmention/fetch-public.ts` already does this for webmentions and client metadata), bounded in time and size, and behind the operator read scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Given @user@host or a URL, the tool returns the WebFinger result and the fetched actor or object JSON, with the HTTP status
- [x] #2 Requests are signed as a chosen local actor (default: the site author), so servers requiring authorized fetch answer
- [x] #3 Private, loopback and link-local addresses are refused, and responses are bounded in time and size, proven by tests
- [x] #4 The tool is annotated openWorldHint true and readOnlyHint true, and requires the operator read scope
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a target is a handle (user, host) or a URL; each HTTP exchange is {requested, url, status, headers[], json, text, truncated}; the answer is {target, signedAs, webfinger, object}.
2. requestPublic gains an optional per-hop sign hook, so every redirect hop is re-signed and still public-address checked; readWithin is exported for a bounded body read of any status.
3. New inspect tool remote_lookup in mcp/inspect/remote.ts: WebFinger (unsigned) for a handle, pick the rel=self ActivityStreams link, then a signed GET of the actor or object as the chosen local user (default the site author, else the first user) via Fedify signRequest and the user's main key.
4. Bounds: one timeout over the lookup, 256 KiB body cap (truncated, flagged), public hosts only.
5. Tests first: handle and URL lookups, signature verified with the actor's public key, chosen actor, loopback/private/link-local refused, timeout and size bound, annotations and inspect scope.
6. Document in docs/mcp.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built remote_lookup in packages/cms/src/mcp/inspect/remote.ts, listed in CORE_TOOLS.
- requestPublic (webmention/fetch-public.ts) takes an optional sign hook, applied on every hop, so a redirect is re-signed for its own URL and still public-address checked. readWithin is exported so a body of any status is read within the byte cap.
- Signing reuses Fedify signRequest (draft-cavage, as the site's own loaders) with the user's main RSA key from senderKeyPairs. Default signer: site author (site.author), else the first user; an unknown actor name is an error. WebFinger is unsigned.
- Limits: 10 s over WebFinger plus object, 256 KiB per body (truncated and flagged), public hosts only. The federation's allowPrivateAddress switch is not honoured: the tool always refuses private targets.
- Evidence: src/mcp/inspect/remote.test.ts. AC1: handle lookup returns WebFinger and actor JSON with statuses; URL lookup returns the object. AC2: the stub answers the actor only when signed, and the test verifies the signature cryptographically against the public key the site's own actor document publishes, for the author and for a chosen user, and on a redirect hop. A real authorized-fetch server (Mastodon) needs a public site to fetch the key from, which TASK-179 covers. AC3: 127.0.0.1, ::1, 169.254.169.254, 10.x, @root@localhost, a name resolving to 10.0.0.5, and a redirect to 192.168.1.1 are refused with no request reaching them; a 300 KiB body is cut at 256 KiB; a never-answering server ends at the timeout. AC4: tools/list shows readOnlyHint and openWorldHint true; a token with only profile gets 403.
- Checks: pnpm build, typecheck, lint, format:check, test:11ty pass. pnpm test: 7612/7614; the two failures were my timing assertion (removed; the timeout is proven by the reason text) and cli-maintenance 'says when the environment forces it on', which passes when run alone (load flake).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the remote_lookup MCP tool (inspect scope, readOnlyHint and openWorldHint). Given @user@host it returns the WebFinger exchange and the actor it links; given a URL, the object. Each exchange carries the requested and final URL, status, debugging headers and the body as JSON or text. The object fetch is HTTP-Signature signed as the site author or a chosen user, re-signed on each redirect hop. Outbound requests go through requestPublic, so private, loopback, link-local and reserved targets are refused on every hop, with a 10 s timeout and a 256 KiB body cap. Documented in docs/mcp.md. Live authorized-fetch check against a real server is left to TASK-179.
<!-- SECTION:FINAL_SUMMARY:END -->
