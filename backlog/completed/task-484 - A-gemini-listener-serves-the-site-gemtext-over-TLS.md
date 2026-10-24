---
id: TASK-484
title: 'A gemini:// listener serves the site gemtext over TLS'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 12:07'
updated_date: '2026-10-23 17:55'
labels:
  - gemini
  - public-site
milestone: m-45
dependencies:
  - TASK-481
  - TASK-483
references:
  - 'https://geminiprotocol.net/docs/protocol-specification.gmi'
  - packages/cms/src/cms/create.ts
  - packages/cms/src/supervisor/primary.ts
  - packages/cms/src/web/throttle.ts
ordinal: 409800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Serve the gemini representation over the Gemini protocol (decision-60): a TLS listener in the CMS process next to the HTTP one, on a configurable port (default 1965), off until enabled. It maps requests onto the same documents, listings and redirects as HTTP and answers with Gemini status codes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A setting enables Gemini; when on, Cms.serve() starts a TLS listener on GEEKITY_GEMINI_PORT (default 1965) with the certificate from the certificate task, and close() closes it
- [x] #2 The listener survives a supervised reload the way the HTTP port does, with no window where 1965 refuses connections
- [x] #3 Requests follow the Gemini spec: one absolute URL of at most 1024 bytes ending CRLF, read under a timeout; a malformed request gets 59, and a request for another host or scheme gets 53
- [x] #4 gemini://host/path answers 20 text/gemini with the same body as /path index.gmi over HTTP; links in it are gemini-relative
- [x] #5 Redirects map to 31 (permanent) and 30 (temporary); 404 to 51; 410 to 52; maintenance to 41 with its back-by time; a server error to 40
- [x] #6 /search/ answers 10 with a prompt and runs the query sent back as the URL query string
- [x] #7 Uploads and their image variants are served with 20 and their media type
- [x] #8 Connections are throttled per client address like HTTP, and the access log records Gemini requests
- [x] #9 Integration tests drive a real TLS client against the listener
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Config: geminiPort (GEEKITY_GEMINI_PORT, PORT kind, default 1965) in ENV_SETTINGS/GeekityConfig/ResolvedConfig; docs/configuration.md row.
2. src/gemini/request.ts (pure): read one request line (<=1024 bytes, CRLF), parse to a URL; 59 for malformed/userinfo/fragment/too long, 53 for another scheme or host; route a gemini URL to an HTTP path (dir -> index.gmi, search with no q -> 10 prompt, raw input -> q=), and map an HTTP response to a Gemini header (2xx 20 + media type, 301/308 31, 302/303/307 30, 404 51, 410 52, 503 41 + back-by time, 429 44, 5xx 40, own-origin Locations made root-relative).
3. src/gemini/listener.ts: tls.Server (TLS >= 1.2, handshake timeout) whose one handler takes (socket, client address) so TASK-485's PROXY header can set the address; per-connection request limit (createRequestLimit beside createLoginThrottle in web/throttle.ts) answering 44; request read under a timeout; answer by an internal app.fetch of the mapped HTTP URL (no second rendering path), streaming the body; access-log line through the same writer and field order as HTTP, with the internal fetch kept off the HTTP log by a module-private env marker.
4. Cms.serve(): start the listener when site.gemini is on and the certificate is usable (replacing the bare warning), resolve with geminiPort; settings.watch(SITE.gemini) starts/stops it while serving; close() closes it. Under geekity serve the cluster primary holds the shared listening handle for the TLS port exactly as for HTTP, so reload keeps it open; print the Gemini port.
5. Tests first per AC: unit tests for request/response mapping; integration tests with a real tls.connect client against createCms (on/off/toggle/close, statuses, body equals HTTP index.gmi, search 10, uploads+variants, throttle 44, access log); cli-reload test running Gemini traffic through a supervised reload with no refused connection.
6. Run pnpm build/test/test:11ty/typecheck/lint/format:check; drive a real server with openssl s_client.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Approach: a gemini:// request is answered by an internal app.fetch of the HTTP URL (no second rendering path), so a page, redirect or status cannot read differently than at its .gmi URL. A directory asks /path/index.gmi first and then /path/ itself on a 404, so links in the chrome to routes without gemtext (the feeds) answer 20 with their own media type instead of 51. The search treats /search/ and /search/index.gmi with no query as 10; a query without q= is the reader's input (q=decoded input), a query with q= is the page's own pager link.

Throttle: HTTP has no per-address rate limit for reads, only createLoginThrottle, whose lockout grows and whose count never resets for a client that keeps coming back within the window, so a steady crawler or feed reader would be locked out. Added createRequestLimit beside it in web/throttle.ts: fixed windows, 60 requests a minute per address, 44 with the seconds left.

Client address seam: listener.ts answer(socket, address) takes the address as an argument; it is socket.remoteAddress today, and TASK-485 can hand it the PROXY header's address (it will need a net.Server in front that reads the header before TLS).

Access log: same writer and field order as HTTP (accessLine exported from access-log.ts), method GEMINI, path+query or - when unreadable. The internal fetch carries LOGGED_ELSEWHERE_ENV (a module-private symbol in c.env, unforgeable over HTTP) so the HTTP log skips it: one request, one line.

Supervised reload: the TLS server listens inside the worker like the HTTP one, so node:cluster's primary holds the shared handle and the old worker keeps answering until the new one is ready; nothing supervisor-side changed. Cms.serve() starts the listener after HTTP and before resolving, so the worker says ready only once both listen. Two listen(0) calls in one worker get distinct ports (checked under geekity serve).

Toggle: settings.watch(SITE.gemini) registered in serve() starts/stops the listener, serialized; services.ts keeps its own watch that generates the certificate and warns, so the listener's toggle path does not warn twice. serve() resolves { port, geminiPort }; geekity serve prints 'Gemini is on port N for host'.

Verified by hand against geekity serve (ports 43123/43965) with openssl s_client: 20 home gemtext, 10 search prompt, 20 search results, 53 other host and https scheme, 51 missing, 31 /about -> /about/, feed 20 application/rss+xml, post body byte-identical to curl of /2026/01/hello-world/index.gmi, TLS 1.1 refused (protocol version alert), GEMINI log lines with address and no duplicate GET line; server stopped by PID.

Layering: listener and request mapping live in web/ (gemini-listener.ts, gemini-request.ts) because gemini/ is a services layer and may not import web/throttle or the log; the shared line format is web/access-line.ts. Validation: pnpm build, pnpm test (cms 7454 pass, all packages 0 fail), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. AC2 proof: cli-reload.test.ts runs 4 Gemini clients against geekity serve through a Plugins-screen reload: 0 failed connections, only 20 and 44 answers, and pages answered by the new worker afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the gemini:// listener. While site.gemini is on, Cms.serve() starts a TLS (>= 1.2) server on GEEKITY_GEMINI_PORT / geminiPort (default 1965) with the site certificate, starts and stops it when the setting changes, and close() closes it; geekity serve prints its port and keeps it open through a supervised reload because node:cluster shares the listening handle as it does for HTTP. Each request line is read under a 10 s timeout (59 when malformed, over 1024 bytes, with userinfo or fragment; 53 for another host or scheme) and answered by an internal app.fetch of the same HTTP URL: a directory is its index.gmi (then the path itself, so feed links work), uploads and image variants stream with their media type, redirects become 31/30 within the capsule, 404 51, 410 52, maintenance 41 with its back-by time, errors 40, and /search/ asks with 10 and runs the reply. Connections are limited to 60 a minute per client address (44 with the wait) through createRequestLimit in web/throttle.ts, and each request gets one GEMINI access-log line in the HTTP log's format. Docs: configuration.md (geminiPort row, The Gemini listener, Gemini log lines). Verified with unit tests, real-TLS integration tests against createCms, a supervised-reload test under load, the full pnpm build/test/test:11ty/typecheck/lint/format:check run, and openssl s_client against a running geekity serve.
<!-- SECTION:FINAL_SUMMARY:END -->
