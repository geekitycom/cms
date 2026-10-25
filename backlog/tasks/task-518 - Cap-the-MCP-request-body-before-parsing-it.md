---
id: TASK-518
title: Cap the MCP request body before parsing it
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25T16:59:00Z'
updated_date: '2026-10-25T17:19:00Z'
labels:
  - mcp
  - security
milestone: m-26
dependencies: []
priority: medium
type: bug
ordinal: 420800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The MCP endpoint (packages/cms/src/mcp/endpoint.ts) calls c.req.json() with no size cap, so upload_media refuses oversize data only after the whole JSON body is parsed. Add a content-length and streamed-size guard like the one Micropub uses (requireSiteToken / its body limit), sized from largestUploadLimit plus base64 overhead, and answer an oversize body with 413 before parsing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A request body over the cap gets 413 and is not parsed
- [x] #2 A body without content-length is cut off at the cap while streaming
- [x] #3 An upload_media call at the largest allowed file size still succeeds
- [x] #4 docs/mcp.md states the limit
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: one number, the MCP body cap = base64 length of largestUploadLimit + UPLOAD_ENVELOPE_BYTES (the same 8 KiB slack Micropub and the admin upload guard allow).
1. Reuse readWithin (webmention/fetch-public.ts), which already refuses a declared content-length over the cap and cancels a stream that crosses it; widen its parameter from Response to the headers+body both Request and Response have.
2. In the MCP POST handler, replace c.req.json() with readWithin(c.req.raw, cap, 'refuse') then JSON.parse; over the cap answers 413 with a JSON-RPC invalid-request error. It runs after sameOriginOnly, requireMcpToken and the protocol-version check, so 401/403/400 answer as before and an unauthenticated body is never read.
3. Share base64Length from upload.ts with the endpoint so the tool check and the body cap agree.
4. Tests (endpoint.test.ts / authoring.test.ts): oversize invalid JSON with content-length gets 413 not 400; an endless stream without content-length gets 413; unauthenticated oversize still 401; upload_media of a file exactly at the largest limit succeeds.
5. docs/mcp.md: state the body limit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reused readWithin from webmention/fetch-public.ts rather than adding a new reader: it already refuses a declared Content-Length over the cap without touching the body and cancels a stream that crosses it. Its parameter is widened from Response to Pick<Response, 'headers' | 'body'> so a Request fits. Micropub's requireSiteToken and the admin's refuseOversizedUpload only check Content-Length, so neither covers a chunked body.

Cap: base64Length(largestUploadLimit) + UPLOAD_ENVELOPE_BYTES (8 KiB, the slack the other upload endpoints allow). base64Length is now exported from authoring/upload.ts so the tool's check and the body cap agree. Default limits give about 267 MiB.

Placement: the read happens in the POST handler, after sameOriginOnly, requireMcpToken and the protocol-version check, so 403 / 401 / 400 answer as before and an unauthenticated body is never read. Over the cap answers 413 with a JSON-RPC invalid-request error naming the byte limit.

Tests: endpoint.test.ts 'a request body over the limit' (declared length over the cap gets 413 with zero bytes pulled; an endless stream with no length gets 413 after at most cap + one chunk; no token gets 401 with zero bytes pulled; a body exactly at the cap is answered). Before the change the endless-stream test ran the process out of memory. authoring.test.ts 'stores a file at the largest size the site takes' (40 000-byte file plus 1 000-byte alt). Mutation check: dropping the 8 KiB slack fails the at-limit tests.

Live check over real HTTP (node-server, uploads capped at 3000 bytes, cap 12192): ping 200; 20 000-byte body 413; 50 MB chunked body 413; oversize with no token 401; bad MCP-Protocol-Version 400; other Origin 403; non-JSON 400.

pnpm build, test (cms 7670 pass), test:11ty, typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The MCP endpoint now caps the request body before it parses it. It reads the body through the existing readWithin helper, sized at the base64 length of the largest upload limit plus 8 KiB, and answers 413 when the declared Content-Length is over the cap or when a body with no length streams past it. The read comes after the Origin, bearer and protocol-version checks, so those answer as before and an unauthenticated body is never read. docs/mcp.md states the limit. Proven by endpoint and authoring tests (including an upload exactly at the largest limit) and by curl against a live server.
<!-- SECTION:FINAL_SUMMARY:END -->
